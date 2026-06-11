import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DeepSeekClient, DeepSeekMessage, RouteTarget } from "@dsh/provider";
import type { TaskState, PatchRecord } from "./task-state.js";
import { transition, writeTaskState } from "./task-state.js";
import { buildDynamicContext } from "./context-builder.js";
import { buildMessages } from "./prompt-builder.js";
import { parseChanges, applyChanges } from "./patch-parser.js";
import { recoverDsmlWrappedChange } from "./dsml-recovery.js";
import { buildPlanFileContract } from "./plan-file-contract.js";
import { validatePatchCoverage } from "./patch-coverage.js";
import {
  runVerify,
  runVerifyAssertions,
  parseAssertion,
  isAllPassed,
  formatResults,
  buildFailedAssertionDiagnostics,
  buildSemanticRepairHints,
  failedAssertionTargetFiles,
  formatSemanticRepairHints,
} from "./verifier.js";
import type { VerifyAssertion } from "./verifier.js";
import type { ContextLayers } from "./context-builder.js";
import {
  detectFailures,
  buildRepairHints,
  detectSignatureChanges,
  findCallSites,
  formatCallSiteContext,
} from "./failure-detector.js";
import { ALL_TOOL_DEFINITIONS } from "./tool-definitions.js";
import {
  executeToolCallsForPolicy,
  filterToolsForPolicy,
  getToolPolicy,
} from "./agent-turn-loop.js";
import { detectRenameIntent, formatRenameIntentGuidance } from "./rename-intent.js";
import { buildRenameReferenceRepair } from "./reference-repair.js";
import { buildDeterministicAssertionRepair } from "./repair-rules/index.js";
import { recordDeepSeekUsage } from "./deepseek-usage.js";
import { isGitRepo, createCheckpoint, applyRollback, assembleIntelligence, moduleRoots } from "@dsh/repo";

export interface RepairConfig {
  client: DeepSeekClient;
  cwd: string;
  maxRounds: number;
  contextLayers: ContextLayers;
  target: RouteTarget;
  onRound?: (round: number, result: RepairRoundResult) => void;
}

export interface RepairRoundResult {
  round: number;
  patched: boolean;
  verified: boolean;
  patchText: string | null;
  verifyOutput: string | null;
  error: string | null;
}

function grepForErrorIdentifiers(
  cwd: string,
  verifyOutput: string,
  changedFiles: string[],
  maxResults = 15,
): string | null {
  const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const readLineWindow = (file: string, line: number, before = 0, after = 6): string[] => {
    try {
      const content = fs.readFileSync(path.join(cwd, file), "utf-8");
      const lines = content.split(/\r?\n/);
      const start = Math.max(1, line - before);
      const end = Math.min(lines.length, line + after);
      const out: string[] = [];
      for (let n = start; n <= end; n++) {
        out.push(`${file}:${n}: ${lines[n - 1] ?? ""}`.slice(0, 220));
      }
      return out;
    } catch {
      return [];
    }
  };

  const patterns: RegExp[] = [
    /\b([a-z_][a-z0-9_]{3,})\b/gi,
    /\b([A-Z][a-zA-Z0-9]{3,})\b/g,
    /(?:in|from)\s+['"]?([\w./-]+\/[\w./-]+)['"]?/g,
    /File\s+"([^"]+)"/g,
  ];

  const identifiers = new Map<string, string>();
  const stopWords = new Set(["the", "and", "but", "not", "are", "was", "were", "this", "that", "with", "from", "have", "been", "will"]);

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(verifyOutput)) !== null) {
      const rawId = match[1] ?? match[2];
      const id = rawId?.trim();
      const key = id?.toLowerCase();
      if (id && key && id.length >= 4 && !stopWords.has(key) && !/^\d+$/.test(id)) {
        identifiers.set(key, id);
      }
    }
  }

  if (identifiers.size === 0) return null;

  const topIds = [...identifiers.values()]
    .sort((a, b) => b.length - a.length)
    .slice(0, 20);

  const excludeSet = new Set(changedFiles.map((f) => path.basename(f)));
  const results: string[] = [];

  for (const id of topIds) {
    if (results.length >= maxResults) break;
    try {
      const output = execSync(
        `grep -rn "${id}" . --include="*.py" --include="*.ts" --include="*.tsx" --include="*.java" 2>/dev/null`,
        {
          cwd,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
          maxBuffer: 512 * 1024,
        },
      ).trim();

      for (const line of output.split(/\r?\n/)) {
        if (results.length >= maxResults) break;
        const m = line.match(/^\.?\/?(.+?):(\d+):(.*)$/);
        if (!m) continue;
        const file = m[1]!;
        const lineNum = Number(m[2]);
        const content = (m[3] ?? "").trim();
        if (excludeSet.has(path.basename(file))) continue;
        if (file.includes("node_modules/") || file.includes(".dsh/") || file.includes("dist/") || file.includes("__pycache__/")) continue;
        if (content.startsWith("#") || content.startsWith("//")) continue;
        results.push(`${file}:${m[2]}: ${content.slice(0, 150)}`);
        if (
          file.endsWith(".java") &&
          new RegExp(`\\b(?:class|interface|enum|record)\\s+${escapeRegExp(id)}\\b`).test(content)
        ) {
          for (const nearby of readLineWindow(file, lineNum, 0, 8).slice(1)) {
            if (results.length >= maxResults) break;
            results.push(nearby);
          }
        }
      }
    } catch {
      // no matches for this identifier
    }
  }

  if (results.length === 0) return null;

  return [
    "## Codebase Search Results",
    `Found ${results.length} references to identifiers from verification errors:`,
    "```",
    ...results.slice(0, maxResults),
    "```",
    "Review these locations — they may reveal why the verification failed (e.g., actual function signatures, import paths, indentation).",
  ].join("\n");
}

interface FailureSourceLocation {
  file: string;
  line: number;
  col?: number;
  message: string;
}

function isEmptyPatchText(patch: string | null | undefined): boolean {
  const trimmed = (patch ?? "").trim();
  return trimmed === "" || trimmed === "<empty>";
}

function formatParsedChangesAsPatchText(changes: ReturnType<typeof parseChanges>): string | null {
  return [
    ...changes.creates.map((c) => `<CREATE path="${c.path}">\n${c.content}\n</CREATE>`),
    ...changes.renames.map((r) => `<RENAME from="${r.from}" to="${r.to}" />`),
    ...changes.deletePaths.map((p) => `<DELETE path="${p}" />`),
    ...changes.searchReplaceBlocks.map((s) => `<PATCH type="search" file="${s.filePath}">\n<<<<<<< SEARCH\n${s.search}\n=======\n${s.replace}\n>>>>>>> REPLACE\n</PATCH>`),
    changes.patchText ? `<PATCH>\n${changes.patchText}\n</PATCH>` : "",
  ].filter(Boolean).join("\n\n") || null;
}

function buildRenameRepairGuidance(taskDescription: string | null | undefined): string | null {
  return formatRenameIntentGuidance(taskDescription);
}

function formatRepairTargetFiles(files: string[]): string | null {
  if (files.length === 0) return null;
  return [
    "## FAILED ASSERTION TARGET FILES",
    `The failed structured assertions still target: ${files.join(", ")}`,
    "The verification contract authorizes repair edits to these files even if the original plan omitted them.",
    "Primary repair target: emit a concrete change block that touches these files unless a later verification result already proves the assertion passes.",
  ].join("\n");
}

function repairTargetFilesForPrompt(prevPatch: PatchRecord | undefined): string[] {
  return prevPatch?.missing_required_files?.length
    ? prevPatch.missing_required_files
    : (prevPatch?.repair_target_files ?? []);
}

function mergePromptTargetFiles(
  prevPatch: PatchRecord | undefined,
  activeTargetFiles: string[] = [],
): string[] {
  const targets = repairTargetFilesForPrompt(prevPatch);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const file of [...targets, ...activeTargetFiles]) {
    if (seen.has(file)) continue;
    seen.add(file);
    merged.push(file);
  }
  return merged;
}

export function buildRepairStallHint(
  prevPatch: PatchRecord | undefined,
  taskDescription?: string,
): string | null {
  if (!prevPatch?.repair_stall_reason) return null;

  const missing = repairTargetFilesForPrompt(prevPatch);
  const missingLine = missing.length > 0
    ? `Files that still require repair attention: ${missing.join(", ")}`
    : "No explicit missing required file list is available; use the failed verification and previous patch record.";
  const targetAuthorization = missing.length > 0
    ? "These files are repair-authorized by missing required coverage or failed structured assertions, even if the original plan omitted them."
    : null;

  const reason =
    prevPatch.repair_stall_reason === "empty_patch"
      ? "The previous repair round emitted no usable change block."
      : prevPatch.repair_stall_reason === "no_required_coverage_progress"
        ? "The previous repair round changed code but did not cover any new required target file."
        : "The previous repair round left required files uncovered.";

  return [
    "## REPAIR STALL DETECTED",
    reason,
    missingLine,
    targetAuthorization ?? "",
    "Do not spend another round only exploring. Use the evidence already available and emit a concrete change block that covers the missing target.",
    "If you need one file, output one change block for that file. If several files remain, output one change block per missing file.",
    buildRenameRepairGuidance(taskDescription) ?? "",
    "An empty patch, prose-only answer, or <DONE/> will be treated as no progress.",
  ].filter(Boolean).join("\n");
}

export function buildFinalRepairRequest(
  prevPatch: PatchRecord | undefined,
  taskDescription?: string,
  activeTargetFiles: string[] = [],
): string {
  const missing = mergePromptTargetFiles(prevPatch, activeTargetFiles);
  return [
    "## SYSTEM: REPAIR TOOL ACCESS PAUSED",
    "You have used the available repair tool budget for this round.",
    missing.length > 0
      ? [
          `Files that still require repair attention: ${missing.join(", ")}`,
          "These files are repair-authorized by missing required coverage or failed structured assertions, even if the original plan omitted them.",
          "Emit at least one concrete change block that touches one of these files.",
        ].join("\n")
      : "Use the verification failure and previous patch evidence already in context.",
    buildRenameRepairGuidance(taskDescription) ?? "",
    "Now emit the final repair change block. Do not call tools. Do not answer with prose only. Do not output <DONE/>.",
  ].filter(Boolean).join("\n");
}

function isNoChangeRepairParseError(error: unknown): boolean {
  return error instanceof Error
    && error.message.includes("No <CREATE>, <RENAME>, <PATCH>, <DELETE>, <PATCH type=\"search\">, or <INSERT> blocks found");
}

export function buildNoChangeRepairRequest(
  prevPatch: PatchRecord | undefined,
  taskDescription?: string,
  activeTargetFiles: string[] = [],
): string {
  return [
    "## SYSTEM: PREVIOUS REPAIR RESPONSE HAD NO CHANGE BLOCK",
    "Your previous repair response did not contain any actionable change block, so it made no progress.",
    buildFinalRepairRequest(prevPatch, taskDescription, activeTargetFiles),
  ].join("\n");
}

function classifyRepairProgress(args: {
  patchText: string | null;
  patched: boolean;
  filesChanged: string[];
  previousCoveredRequiredFiles: string[];
  coveredRequiredFiles: string[];
  missingRequiredFiles: string[];
}): {
  repairProgress: NonNullable<PatchRecord["repair_progress"]>;
  repairStallReason?: NonNullable<PatchRecord["repair_stall_reason"]>;
} {
  if (isEmptyPatchText(args.patchText)) {
    return { repairProgress: "empty_patch", repairStallReason: "empty_patch" };
  }
  if (!args.patched) {
    return { repairProgress: "apply_failed" };
  }

  const previousCovered = new Set(args.previousCoveredRequiredFiles);
  const addedRequiredCoverage = args.coveredRequiredFiles.some((file) => !previousCovered.has(file));
  if (addedRequiredCoverage) {
    return { repairProgress: "advanced_required_coverage" };
  }

  if (args.missingRequiredFiles.length > 0) {
    return {
      repairProgress: "no_required_coverage_progress",
      repairStallReason: "no_required_coverage_progress",
    };
  }

  return {
    repairProgress: args.filesChanged.length > 0 ? "changed_non_required_files" : "empty_patch",
    ...(args.filesChanged.length > 0 ? {} : { repairStallReason: "empty_patch" as const }),
  };
}

function isInsideDir(baseDir: string, targetPath: string): boolean {
  const rel = path.relative(baseDir, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function extractFailureSourceLocations(verifyOutput: string): FailureSourceLocation[] {
  const locations: FailureSourceLocation[] = [];
  const seen = new Set<string>();
  const patterns: RegExp[] = [
    /\[ERROR\]\s+(.+?\.java):\[(\d+),(\d+)\]\s+([^\r\n]*)/g,
    /^(.+?\.(?:ts|tsx|js|jsx))\((\d+),(\d+)\):\s+error\s+(?:TS\d+:)?\s*([^\r\n]*)/gm,
    /^(.+?\.\w{1,6}):(\d+):(\d+):\s+error:\s+([^\r\n]*)/gm,
    /File\s+"([^"]+\.py)",\s+line\s+(\d+)(?:,\s+in\s+([^\r\n]*))?/g,
    /\bat\s+[\w.$]+\(([^():]+\.java):(\d+)\)/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(verifyOutput)) !== null) {
      const file = match[1];
      const line = Number(match[2]);
      if (!file || !Number.isFinite(line) || line <= 0) continue;
      const colValue = match[3] && /^\d+$/.test(match[3]) ? Number(match[3]) : undefined;
      const message = colValue !== undefined ? (match[4] ?? "") : (match[3] ?? "");
      const key = `${file}:${line}:${colValue ?? ""}:${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      locations.push({
        file,
        line,
        ...(colValue !== undefined ? { col: colValue } : {}),
        message: message.trim(),
      });
      if (locations.length >= 5) return locations;
    }
  }

  return locations;
}

function resolveSourcePath(
  cwd: string,
  rawFile: string,
  knownFiles: string[],
  projectRoots: string[],
): { absPath: string; displayPath: string } | null {
  const root = path.resolve(cwd);
  const normalizedRaw = rawFile.replace(/\\/g, "/");
  const candidates: Array<{ absPath: string; displayPath: string }> = [];

  if (path.isAbsolute(rawFile)) {
    const absPath = path.resolve(rawFile);
    if (isInsideDir(root, absPath)) {
      candidates.push({ absPath, displayPath: path.relative(root, absPath) });
    }
  } else {
    candidates.push({ absPath: path.resolve(root, rawFile), displayPath: normalizedRaw });
  }

  // Project-root markers come from assembleIntelligence (moduleRoots view).
  // Empty list → fall through to basename matching only.
  const markers = projectRoots.filter((r) => r && r !== ".").map((r) => `/${r}/`);
  for (const marker of markers) {
    const idx = normalizedRaw.lastIndexOf(marker);
    if (idx === -1) continue;
    const rel = normalizedRaw.slice(idx + 1);
    candidates.push({ absPath: path.resolve(root, rel), displayPath: rel });
  }

  const rawBase = path.basename(normalizedRaw);
  for (const known of knownFiles) {
    const normalizedKnown = known.replace(/\\/g, "/");
    if (
      normalizedKnown === normalizedRaw ||
      normalizedKnown.endsWith(normalizedRaw) ||
      normalizedKnown.endsWith(rawBase)
    ) {
      candidates.push({ absPath: path.resolve(root, known), displayPath: normalizedKnown });
    }
  }

  for (const candidate of candidates) {
    if (!isInsideDir(root, candidate.absPath)) continue;
    try {
      const stat = fs.statSync(candidate.absPath);
      if (stat.isFile()) return candidate;
    } catch {
      // try next candidate
    }
  }

  return null;
}

function buildSourceWindow(absPath: string, line: number, col?: number): string | null {
  let content: string;
  try {
    content = fs.readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split(/\r?\n/);
  if (line < 1 || line > lines.length) return null;

  const start = Math.max(1, line - 5);
  const end = Math.min(lines.length, line + 5);
  const width = String(end).length;
  const output: string[] = [];
  for (let n = start; n <= end; n++) {
    const marker = n === line ? ">" : " ";
    output.push(`${marker} ${String(n).padStart(width, " ")} | ${lines[n - 1] ?? ""}`);
    if (n === line && col && col > 0) {
      output.push(`  ${" ".repeat(width)} | ${" ".repeat(Math.max(0, col - 1))}^`);
    }
  }
  return output.join("\n");
}

function buildFailureSourceContext(
  cwd: string,
  verifyOutput: string,
  knownFiles: string[],
  projectRoots: string[],
): string | null {
  const locations = extractFailureSourceLocations(verifyOutput);
  if (locations.length === 0) return null;

  const parts: string[] = [
    "## Verification Failure Source Context",
    "Compiler-reported locations with current source lines. Use these exact lines when writing the repair patch.",
  ];

  let included = 0;
  const seenFiles = new Set<string>();
  for (const location of locations) {
    const resolved = resolveSourcePath(cwd, location.file, knownFiles, projectRoots);
    if (!resolved) continue;
    const window = buildSourceWindow(resolved.absPath, location.line, location.col);
    if (!window) continue;
    const headingKey = `${resolved.displayPath}:${location.line}:${location.col ?? ""}`;
    if (seenFiles.has(headingKey)) continue;
    seenFiles.add(headingKey);

    parts.push("");
    parts.push(`### ${resolved.displayPath}`);
    parts.push(`Error location: line ${location.line}${location.col ? `, column ${location.col}` : ""}${location.message ? ` - ${location.message}` : ""}`);
    parts.push("```");
    parts.push(window);
    parts.push("```");
    included++;
  }

  return included > 0 ? parts.join("\n") : null;
}

export async function runRepairLoop(
  state: TaskState,
  config: RepairConfig,
): Promise<TaskState> {
  let current = transition(state, "repairing");
  let round = 1;

  while (round <= config.maxRounds) {
    // Re-enter repairing state for rounds 2+
    if (current.status === "verification_failed") {
      current = transition(current, "repairing");
    }

    // Build context with previous failure info
    const dynamic = buildDynamicContext(
      current.patches,
      current.verify_results,
      2,
    );

    // Detect failure patterns from previous round
    const prevPatch = current.patches.at(-1);
    const prevVerify = current.verify_results.at(-1);
    let failureHints: string | null = null;

    if (prevPatch || prevVerify) {
      const verifyOutput =
        prevVerify?.results.map((r) => r.output).join("\n") ?? null;
      
      const beforeLastVerify = current.verify_results.at(-2);
      const prevVerifyOutput = beforeLastVerify?.results.map((r) => r.output).join("\n") ?? null;

      const detections = detectFailures({
        response: prevPatch?.patch ?? "",
        planFiles: current.plan?.files ?? [],
        actualChangedFiles: prevPatch?.files_changed ?? [],
        verifyOutput,
        patchApplyError: prevPatch?.apply_status === "failed" ? prevPatch.patch : null,
        prevVerifyOutput,
        moduleRoots: moduleRoots(assembleIntelligence(config.cwd)),
      });

      // Detect if stuck on same error
      if (verifyOutput && prevVerifyOutput && verifyOutput.slice(0, 500) === prevVerifyOutput.slice(0, 500)) {
        detections.push({
          mode: "stuck-on-error",
          description: "修复停滞——连续两轮出现相同的报错",
          confidence: "high",
          evidence: "验证输出内容与上一轮完全一致",
          repairHint: [
            "CRITICAL: Your last attempt did NOT change the error output.",
            "This usually means you are modifying the wrong line or the wrong file.",
            "ACTION REQUIRED:",
            "1. Use `read_file` on the ENTIRE file to confirm your assumptions about line numbers.",
            "2. Use `grep_files` to ensure you are modifying the correct class/function.",
            "3. If you are unsure, REVERT your last change and try a completely different approach.",
          ].join("\n"),
        });
      }

      failureHints = buildRepairHints(detections);

      if (prevPatch?.rolled_back) {
        const rollbackHint = [
          "### 🚨 PHYSICAL ROLLBACK EXECUTED",
          `**Your change in Round ${prevPatch.round} was PHYSICALLY ROLLED BACK because it caused a ${(prevPatch.rollback_reason ?? "unknown error").toUpperCase()}.**`,
          "The codebase has been restored to the clean state BEFORE that change. The buggy code is GONE.",
          "",
          "**MANDATORY ACTION:**",
          "1. **Analyze why your last logic was flawed.** Do not simply retry a variation of the same code.",
          "2. **Read the relevant files again** using `read_file` to verify the restored state.",
          "3. **Take a different approach.** If you caused a regression, your assumptions about the code structure or dependencies were likely wrong.",
          "4. In your Root Cause Analysis, explain specifically why the previous approach failed and how the new approach avoids the same pitfall.",
        ].join("\n");
        failureHints = failureHints ? failureHints + "\n\n" + rollbackHint : rollbackHint;
      }
    }

    // Detect signature changes and inject caller context
    let callSiteContext: string | null = null;
    if (prevPatch?.apply_status === "ok" && prevPatch.files_changed.length > 0) {
      const sigChanges = detectSignatureChanges(config.cwd, prevPatch.files_changed);
      if (sigChanges.length > 0) {
        const changedNames = [...new Set(sigChanges.map((c) => c.name))];
        const callSites = findCallSites(config.cwd, changedNames, prevPatch.files_changed, 20);
        callSiteContext = formatCallSiteContext(sigChanges, callSites);
      }
    }

    // Search codebase for identifiers from verify errors
    let searchContext: string | null = null;
    const prevVerifyOutput = prevVerify?.results.map((r) => r.output).join("\n") ?? null;
    let failureSourceContext: string | null = null;
    if (prevVerifyOutput) {
      searchContext = grepForErrorIdentifiers(
        config.cwd,
        prevVerifyOutput,
        prevPatch?.files_changed ?? [],
        15,
      );
      failureSourceContext = buildFailureSourceContext(
        config.cwd,
        prevVerifyOutput,
        [...(current.plan?.files ?? []), ...(prevPatch?.files_changed ?? [])],
        moduleRoots(assembleIntelligence(config.cwd)),
      );
    }

    // Structured signal from patch stage: if patch was marked incomplete
    // (plan.files not fully covered), surface the missing file list at the
    // top of repair task so the model treats "补全缺失文件" as the primary task.
    // (spec docs/specs/2026-05-07-patch-completeness.md §3.4)
    // The patch coverage state machine v2 carries an authoritative
    // missing_required_files list (spec docs/specs/2026-05-19 §4.8); prefer it
    // and fall back to the legacy patch_incomplete_reason string.
    const missingRequired = prevPatch?.missing_required_files ?? [];
    const incompleteDetail = missingRequired.length > 0
      ? `required target files still uncovered: ${missingRequired.join(", ")}`
      : prevPatch?.patch_incomplete_reason ?? null;
    const incompleteHint = incompleteDetail
      ? [
          "## PATCH INCOMPLETE",
          `Previous patch round did not cover all required target files. Detail: ${incompleteDetail}`,
          `Files already modified: ${(prevPatch?.files_changed ?? []).join(", ") || "(none)"}`,
          "PRIMARY REPAIR TASK: emit change blocks for the uncovered files. Avoid duplicating edits to already-modified files unless a failed verification assertion still targets that file or the previous change is wrong.",
        ].join("\n")
      : null;
    const repairStallHint = buildRepairStallHint(prevPatch, current.task.description);

    const rawRepairAssertions = (current.plan?.verify_assertions ?? []) as unknown[];
    const parsedRepairAssertions = rawRepairAssertions
      .map((raw) => parseAssertion(raw))
      .filter((a): a is VerifyAssertion => a !== null);
    const failedAssertionDiagnostics =
      prevVerify && parsedRepairAssertions.length > 0
        ? buildFailedAssertionDiagnostics(parsedRepairAssertions, prevVerify.results)
        : null;
    const semanticRepairHints =
      prevVerify && parsedRepairAssertions.length > 0
        ? buildSemanticRepairHints(parsedRepairAssertions, prevVerify.results)
        : [];
    const repairTargetFiles =
      prevVerify && parsedRepairAssertions.length > 0
        ? failedAssertionTargetFiles(parsedRepairAssertions, prevVerify.results)
        : [];
    const semanticRepairHintBlock = formatSemanticRepairHints(semanticRepairHints);
    const repairTargetFileBlock = formatRepairTargetFiles(repairTargetFiles);

    const isCompilationError = failureHints?.includes("COMPILATION ERRORS") || failureHints?.includes("signature-mismatch") || false;
    const isCompletionMode = incompleteHint !== null;
    const isFailedAssertionTargetMode = !isCompletionMode && repairTargetFiles.length > 0;

    const completionConstraints = [
      "CRITICAL TASK COMPLETION RULES:",
      "1. Your PRIMARY goal is to COMPLETE the original task — the previous attempt was INCOMPLETE.",
      "2. Focus on the uncovered files listed above. Read each one, understand what change is needed, then produce the change block.",
      "3. You MAY add new functions, classes, imports, or variables as needed to complete the task.",
      "4. Avoid re-modifying files that were already changed unless a failed verification assertion still targets that file or the previous change is wrong.",
      "5. Produce one change block per uncovered file. Cover every file listed in the PATCH INCOMPLETE section.",
      "6. If you're unsure what a file needs, use read_file to inspect it first.",
      "7. After producing all change blocks, output <DONE/>.",
    ].join("\n");

    const failedAssertionTargetConstraints = [
      "CRITICAL VERIFICATION-TARGET REPAIR RULES:",
      "1. The failed structured verification assertions are authoritative for this repair round.",
      `2. You MAY modify these failed assertion target files even if they were absent from the original plan's <FILES>: ${repairTargetFiles.join(", ")}`,
      "3. Your PRIMARY task is to emit concrete change blocks that touch the failed assertion target files and make those assertions pass through a task-correct implementation.",
      "4. You MAY add imports, functions, classes, or variables when required by the original task or failed verification contract; keep the change minimal and scoped.",
      "5. Do not mark repair complete, output <DONE/>, or return prose-only while any failed assertion target remains unfixed.",
      "6. Read each target file before writing SEARCH/REPLACE blocks.",
    ].join("\n");

    const repairConstraints = [
      "CRITICAL REPAIR RULES:",
      isCompilationError 
        ? "1. Fix the compilation errors. You MAY need to modify multiple files (callers, interfaces, imports) to ensure type safety."
        : "1. Make the SMALLEST possible change to fix the failure — change as few lines as possible.",
      "2. NEVER delete or modify existing imports unless they are directly causing the test failure.",
      "3. NEVER add new functions, classes, or variables that were not part of the original task.",
      "4. NEVER restructure or reformat code that is unrelated to the failure.",
      isCompilationError
        ? "5. Ensure all cross-file dependencies are resolved. If you changed a signature, update ALL callers."
        : "5. ONLY fix the specific error in the verify output. Do not make additional improvements.",
      "6. If the original patch was wrong, revert to the original code and try a different minimal approach.",
      "7. Preserve ALL existing code that is not related to the error. Every deleted line must be justified by the verify failure output.",
      "8. If unified diff failed to apply in the previous round, use <PATCH type=\"search\" file=\"path\"> with SEARCH/REPLACE blocks instead. Copy the SEARCH block EXACTLY from the file content — this avoids line-number errors.",
      "9. If you changed a function signature (parameters or return type), check ALL callers — they likely need updating, or you should revert the signature change.",
    ].join("\n");

    const taskDescription = [
      isCompletionMode
        ? completionConstraints
        : isFailedAssertionTargetMode
          ? failedAssertionTargetConstraints
          : repairConstraints,
      "",
      failedAssertionDiagnostics ?? "",
      "",
      semanticRepairHintBlock ?? "",
      "",
      repairTargetFileBlock ?? "",
      "",
      incompleteHint ?? "",
      "",
      repairStallHint ?? "",
      "",
      failureHints ?? (!isCompletionMode ? "The previous patch failed verification. Analyze the errors and fix the code." : ""),
      "",
      callSiteContext ?? "",
      "",
      failureSourceContext ?? "",
      "",
      searchContext ?? "",
      "",
      "Original task: " + current.task.description,
    ].join("\n");

    const messages: DeepSeekMessage[] = buildMessages({
      context: { ...config.contextLayers, dynamic },
      taskDescription,
      phase: "repair",
    });

    // Tool call loop for repair (max 5 rounds — diagnosis then fix)
    const MAX_REPAIR_TOOL_ROUNDS = 5;
    let content = "";
    // route Y / Bug A telemetry: true if any inner-loop response went through
    // DSML salvage. Surfaced on PatchRecord.dsml_salvage_applied.
    let dsmlSalvageApplied = false;
    const repairToolRounds: import("./task-state.js").ToolRoundRecord[] = [];
    const repairToolPolicy = getToolPolicy("repair");
    const repairTools = filterToolsForPolicy(ALL_TOOL_DEFINITIONS, repairToolPolicy);

    for (let tr = 0; tr <= MAX_REPAIR_TOOL_ROUNDS; tr++) {
      const startedAt = Date.now();
      const response = await config.client.chat({
        model: config.target.model,
        messages,
        thinking: config.target.thinking,
        tools: repairTools as unknown as Record<string, unknown>[],
      });
      recordDeepSeekUsage(current, {
        phase: "repair",
        model: config.target.model,
        thinking: config.target.thinking,
        durationMs: Date.now() - startedAt,
        response,
      });

      const choice = response.choices[0];
      if (!choice) break;
      // route Y / Bug A: salvage DSML-wrapped change before downstream parsing
      // / message echoing. See docs/plans/2026-05-20-dsml-recovery.md.
      const _salvage = recoverDsmlWrappedChange(choice.message.content);
      content = _salvage.content;
      if (_salvage.recovered) dsmlSalvageApplied = true;
      const toolCalls = choice.message.tool_calls;

      if (toolCalls && toolCalls.length > 0) {
        if (tr < MAX_REPAIR_TOOL_ROUNDS) {
          const assistantMsg: DeepSeekMessage = { role: "assistant", content, tool_calls: toolCalls };
          if (choice.message.reasoning_content) assistantMsg.reasoning_content = choice.message.reasoning_content;
          messages.push(assistantMsg);

          const toolResult = await executeToolCallsForPolicy({
            toolCalls,
            toolPolicy: repairToolPolicy,
            tools: ALL_TOOL_DEFINITIONS,
            cwd: config.cwd,
          });
          messages.push(...toolResult.messages);
          repairToolRounds.push({ round: tr + 1, calls: toolResult.records });
          continue;
        }

        messages.push({
          role: "user",
          content: buildFinalRepairRequest(
            current.patches.at(-1),
            current.task.description,
            repairTargetFiles,
          ),
        });
        const finalStartedAt = Date.now();
        const finalResponse = await config.client.chat({
          model: config.target.model,
          messages,
          thinking: config.target.thinking,
        });
        recordDeepSeekUsage(current, {
          phase: "repair",
          model: config.target.model,
          thinking: config.target.thinking,
          durationMs: Date.now() - finalStartedAt,
          response: finalResponse,
        });

        const finalChoice = finalResponse.choices[0];
        if (finalChoice) {
          const finalSalvage = recoverDsmlWrappedChange(finalChoice.message.content);
          content = finalSalvage.content;
          if (finalSalvage.recovered) dsmlSalvageApplied = true;
        }
      }
      break;
    }

    // Parse and apply the repair patch
    let patchText: string | null = null;
    let applyError: string | null = null;
    let patched = false;
    let filesChanged: string[] = [];
    let rolledBack = false;
    let deterministicReferenceRepairApplied = false;
    let deterministicAssertionRepairApplied = false;
    let deterministicReferenceRepairHints: string[] = [];

    // ---- Checkpoint (PHASE-3-D) ----
    if (isGitRepo(config.cwd)) {
      createCheckpoint(config.cwd, `dsh-checkpoint-repair-round-${round}`);
    }

    const applyRepairContent = (rawContent: string): void => {
      const changes = parseChanges(rawContent);
      patchText = formatParsedChangesAsPatchText(changes);
      const applyResult = applyChanges(config.cwd, changes, false);
      patched = applyResult.success;
      filesChanged = [...applyResult.createdFiles, ...applyResult.renamedFiles, ...applyResult.patchedFiles, ...applyResult.deletedFiles];

      // ---- Track managed files (PHASE-3-D) ----
      if (patched && filesChanged.length > 0) {
        const currentManaged = new Set(current.managed_files);
        for (const f of filesChanged) currentManaged.add(f);
        current.managed_files = [...currentManaged];
      }

      if (!applyResult.success) {
        applyError = applyResult.error ?? "unknown apply error";
      }
    };

    try {
      applyRepairContent(content);
    } catch (e) {
      const firstApplyError = e instanceof Error ? e.message : String(e);

      if (isNoChangeRepairParseError(e) && repairTargetFiles.length > 0) {
        messages.push({ role: "assistant", content });
        messages.push({
          role: "user",
          content: buildNoChangeRepairRequest(
            current.patches.at(-1),
            current.task.description,
            repairTargetFiles,
          ),
        });
        const retryStartedAt = Date.now();
        const retryResponse = await config.client.chat({
          model: config.target.model,
          messages,
          thinking: config.target.thinking,
        });
        recordDeepSeekUsage(current, {
          phase: "repair",
          model: config.target.model,
          thinking: config.target.thinking,
          durationMs: Date.now() - retryStartedAt,
          response: retryResponse,
        });

        const retryChoice = retryResponse.choices[0];
        if (retryChoice) {
          const retrySalvage = recoverDsmlWrappedChange(retryChoice.message.content);
          content = retrySalvage.content;
          if (retrySalvage.recovered) dsmlSalvageApplied = true;
          try {
            applyRepairContent(content);
          } catch (retryError) {
            applyError = [
              firstApplyError,
              `no-change repair retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
            ].join("; ");
          }
        } else {
          applyError = `${firstApplyError}; no-change repair retry returned no choice`;
        }
      }

      if (!patched && applyError === null) {
        const deterministicRenameRepair =
          prevVerify && parsedRepairAssertions.length > 0
            ? buildRenameReferenceRepair({
                cwd: config.cwd,
                taskDescription: current.task.description,
                assertions: parsedRepairAssertions,
                results: prevVerify.results,
              })
            : null;
        const deterministicAssertionRepair =
          !deterministicRenameRepair && prevVerify && parsedRepairAssertions.length > 0
            ? buildDeterministicAssertionRepair({
                cwd: config.cwd,
                assertions: parsedRepairAssertions,
                results: prevVerify.results,
              })
            : null;
        const deterministicRepair = deterministicRenameRepair ?? deterministicAssertionRepair;

        if (deterministicRepair) {
          try {
            content = deterministicRepair.content;
            deterministicReferenceRepairApplied = deterministicRenameRepair !== null;
            deterministicAssertionRepairApplied = deterministicAssertionRepair !== null;
            deterministicReferenceRepairHints = deterministicRepair.hints;
            applyRepairContent(content);
          } catch (deterministicError) {
            applyError = [
              firstApplyError,
              `deterministic reference repair failed: ${deterministicError instanceof Error ? deterministicError.message : String(deterministicError)}`,
            ].join("; ");
          }
        } else {
          applyError = firstApplyError;
        }
      }
    }

    // Record the patch attempt. Re-stamp required-file coverage onto this
    // repair round's record so the missing-file signal survives into the next
    // repair round — which reads patches.at(-1). Without this, repair round 2+
    // reads its own prior record (which would lack it) and loses the structured
    // completion signal (spec docs/specs/2026-05-19 §4.8).
    current.repair_rounds = round;
    const repairContract = buildPlanFileContract(current.plan);
    const previousCoveredRequiredFiles = current.patches.at(-1)?.covered_required_files ?? [];
    const cumulativeChanged = [
      ...current.patches.flatMap((p) => p.files_changed),
      ...filesChanged,
    ];
    const repairCoverage = validatePatchCoverage({
      contract: repairContract,
      appliedChangedFiles: cumulativeChanged,
    });
    const renameIntentDetected = detectRenameIntent(current.task.description);
    const repairSemanticHints = [
      ...(renameIntentDetected ? ["rename_intent"] : []),
      ...semanticRepairHints,
      ...deterministicReferenceRepairHints,
    ];
    const blockedWriteShellGuidance = repairToolRounds.some((toolRound) =>
      toolRound.calls.some((call) =>
        call.name === "exec_shell"
        && call.status === "error"
        && call.summary.includes("exec_shell is read-only")));
    const repairPatchRecord: PatchRecord = {
      round,
      phase: "repair",
      patch: patchText ?? "",
      apply_status: patched ? "ok" : "failed",
      files_changed: filesChanged,
      tool_rounds: repairToolRounds.length > 0 ? repairToolRounds : undefined,
      ...(dsmlSalvageApplied ? { dsml_salvage_applied: true } : {}),
      ...(blockedWriteShellGuidance ? { blocked_write_shell_guidance: true } : {}),
      ...(renameIntentDetected ? { rename_intent_detected: true } : {}),
      ...(deterministicReferenceRepairApplied ? { deterministic_reference_repair: true } : {}),
      ...(deterministicAssertionRepairApplied ? { deterministic_assertion_repair: true } : {}),
      ...(repairTargetFiles.length > 0 ? { repair_target_files: repairTargetFiles } : {}),
      ...(repairSemanticHints.length > 0 ? { repair_semantic_hints: repairSemanticHints } : {}),
    };
    if (repairContract.requiredTargetFiles.length > 0) {
      repairPatchRecord.coverage = repairCoverage.fullRequiredCoverage ? "full" : "partial";
      repairPatchRecord.covered_required_files = repairCoverage.coveredRequiredFiles;
      repairPatchRecord.missing_required_files = repairCoverage.missingRequiredFiles;
    }
    const repairProgress = classifyRepairProgress({
      patchText,
      patched,
      filesChanged,
      previousCoveredRequiredFiles,
      coveredRequiredFiles: repairCoverage.coveredRequiredFiles,
      missingRequiredFiles: repairCoverage.missingRequiredFiles,
    });
    repairPatchRecord.repair_progress = repairProgress.repairProgress;
    if (repairProgress.repairStallReason) {
      repairPatchRecord.repair_stall_reason = repairProgress.repairStallReason;
    }
    current.patches.push(repairPatchRecord);

    // Run verification
    let verified = false;
    let verifyOutput: string | null = null;

    if (patched) {
      current = transition(current, "patched");

      // Prefer structured assertions when populated by runRepair; fall back
      // to legacy shell-only commands for backward compat.
      // (spec 2026-05-08-verify-protocol-structured §3.5)
      const rawAssertions = (current.plan?.verify_assertions ?? []) as unknown[];
      const parsedAssertions = rawAssertions
        .map((raw) => parseAssertion(raw))
        .filter((a): a is VerifyAssertion => a !== null);

      let results: ReturnType<typeof runVerifyAssertions> = [];
      if (parsedAssertions.length > 0) {
        results = runVerifyAssertions(parsedAssertions, config.cwd);
      } else {
        const verifyCommands = current.plan?.verify_commands ?? [];
        if (verifyCommands.length > 0) {
          results = runVerify(verifyCommands, config.cwd);
        }
      }

      if (results.length > 0) {
        verified = isAllPassed(results);
        verifyOutput = formatResults(results);
        current.verify_results.push({ round, results });

        if (!verified && parsedAssertions.length > 0) {
          const deterministicPostVerifyRepair = buildDeterministicAssertionRepair({
            cwd: config.cwd,
            assertions: parsedAssertions,
            results,
          });

          if (deterministicPostVerifyRepair) {
            const deterministicTargetFiles = failedAssertionTargetFiles(parsedAssertions, results);
            const deterministicChanges = parseChanges(deterministicPostVerifyRepair.content);
            const deterministicPatchText = formatParsedChangesAsPatchText(deterministicChanges);
            const deterministicApplyResult = applyChanges(config.cwd, deterministicChanges, false);
            const deterministicFilesChanged = [
              ...deterministicApplyResult.createdFiles,
              ...deterministicApplyResult.renamedFiles,
              ...deterministicApplyResult.patchedFiles,
              ...deterministicApplyResult.deletedFiles,
            ];

            if (deterministicApplyResult.success && deterministicFilesChanged.length > 0) {
              const currentManaged = new Set(current.managed_files);
              for (const f of deterministicFilesChanged) currentManaged.add(f);
              current.managed_files = [...currentManaged];
            }

            const deterministicCumulativeChanged = [
              ...current.patches.flatMap((p) => p.files_changed),
              ...deterministicFilesChanged,
            ];
            const deterministicCoverage = validatePatchCoverage({
              contract: repairContract,
              appliedChangedFiles: deterministicCumulativeChanged,
            });
            const deterministicPatchRecord: PatchRecord = {
              round,
              phase: "repair",
              patch: deterministicPatchText ?? "",
              apply_status: deterministicApplyResult.success ? "ok" : "failed",
              files_changed: deterministicFilesChanged,
              deterministic_assertion_repair: true,
              ...(deterministicTargetFiles.length > 0 ? { repair_target_files: deterministicTargetFiles } : {}),
              repair_semantic_hints: deterministicApplyResult.success
                ? deterministicPostVerifyRepair.hints
                : [
                    ...deterministicPostVerifyRepair.hints,
                    `deterministic_assertion_repair_failed: ${deterministicApplyResult.error ?? "unknown apply error"}`,
                  ],
            };
            if (repairContract.requiredTargetFiles.length > 0) {
              deterministicPatchRecord.coverage = deterministicCoverage.fullRequiredCoverage ? "full" : "partial";
              deterministicPatchRecord.covered_required_files = deterministicCoverage.coveredRequiredFiles;
              deterministicPatchRecord.missing_required_files = deterministicCoverage.missingRequiredFiles;
            }
            const deterministicProgress = classifyRepairProgress({
              patchText: deterministicPatchText,
              patched: deterministicApplyResult.success,
              filesChanged: deterministicFilesChanged,
              previousCoveredRequiredFiles: current.patches.at(-1)?.covered_required_files ?? [],
              coveredRequiredFiles: deterministicCoverage.coveredRequiredFiles,
              missingRequiredFiles: deterministicCoverage.missingRequiredFiles,
            });
            deterministicPatchRecord.repair_progress = deterministicProgress.repairProgress;
            if (deterministicProgress.repairStallReason) {
              deterministicPatchRecord.repair_stall_reason = deterministicProgress.repairStallReason;
            }
            current.patches.push(deterministicPatchRecord);

            if (deterministicApplyResult.success) {
              patchText = [patchText, deterministicPatchText].filter(Boolean).join("\n\n") || null;
              filesChanged = [...new Set([...filesChanged, ...deterministicFilesChanged])];
              const postVerifyResults = runVerifyAssertions(parsedAssertions, config.cwd);
              verified = isAllPassed(postVerifyResults);
              verifyOutput = formatResults(postVerifyResults);
              current.verify_results.push({ round, results: postVerifyResults });
            } else {
              applyError = [
                applyError,
                `deterministic assertion repair failed: ${deterministicApplyResult.error ?? "unknown apply error"}`,
              ].filter(Boolean).join("; ");
            }
          }
        }

        // ---- Regression Detection & Rollback (PHASE-3-D) ----
        if (!verified && isGitRepo(config.cwd)) {
          const prevVerify = current.verify_results.at(-2) ?? current.preflight_results.at(-1);
          const prevVerifyOutput = prevVerify?.results.map((r) => r.output).join("\n") ?? null;

          const detections = detectFailures({
            response: patchText ?? "",
            planFiles: current.plan?.files ?? [],
            actualChangedFiles: filesChanged,
            verifyOutput,
            patchApplyError: null,
            prevVerifyOutput,
            moduleRoots: moduleRoots(assembleIntelligence(config.cwd)),
          });

          const hasRegression = detections.some((d) => d.mode === "compilation-error" && d.evidence.includes("REGRESSION"));
          const isStagnant = verifyOutput && prevVerifyOutput && verifyOutput.slice(0, 500) === prevVerifyOutput.slice(0, 500);

          if (hasRegression || isStagnant) {
            const reason = hasRegression ? "regression" : "stagnation";
            applyRollback(config.cwd);
            rolledBack = true;
            const last = current.patches.at(-1);
            if (last) {
              last.rolled_back = true;
              last.rollback_reason = reason;
            }
          }
        }

        current = transition(
          current,
          verified ? "verified" : "verification_failed",
        );
      }
    }

    const roundResult: RepairRoundResult = {
      round,
      patched,
      verified,
      patchText,
      verifyOutput,
      error: applyError,
    };

    config.onRound?.(round, roundResult);

    // Write intermediate state
    writeTaskState(config.cwd, current);

    if (verified) break;
    
    // Only increment effective round if we didn't roll back (physical regression/stagnation)
    if (!rolledBack) {
      round++;
    }
  }

  if (current.status === "verification_failed" || current.status === "repairing") {
    current = transition(current, "repair_exhausted");
  }

  writeTaskState(config.cwd, current);
  return current;
}
