import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DeepSeekClient, DeepSeekMessage } from "@dsh/provider";
import type { TaskState } from "./task-state.js";
import { transition, writeTaskState } from "./task-state.js";
import { buildDynamicContext } from "./context-builder.js";
import { buildMessages } from "./prompt-builder.js";
import { parseChanges, applyChanges } from "./patch-parser.js";
import { runVerify, runVerifyAssertions, parseAssertion, isAllPassed, formatResults } from "./verifier.js";
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
import { executeTool, formatToolResult, normalizeToolArguments } from "./tool-executor.js";
import type { ToolName } from "./tool-definitions.js";
import { isGitRepo, createCheckpoint, applyRollback, assembleIntelligence, moduleRoots } from "@dsh/repo";

export interface RepairConfig {
  client: DeepSeekClient;
  cwd: string;
  maxRounds: number;
  contextLayers: ContextLayers;
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
    const incompleteHint = prevPatch?.patch_incomplete_reason
      ? [
          "## PATCH INCOMPLETE",
          `Previous patch round did not cover all plan.files. Detail: ${prevPatch.patch_incomplete_reason}`,
          `Files already modified (do NOT re-modify): ${prevPatch.files_changed.join(", ") || "(none)"}`,
          "PRIMARY REPAIR TASK: emit change blocks for the uncovered files. Do not duplicate edits to already-modified files.",
        ].join("\n")
      : null;

    const isCompilationError = failureHints?.includes("COMPILATION ERRORS") || failureHints?.includes("signature-mismatch") || false;
    const isCompletionMode = incompleteHint !== null;

    const completionConstraints = [
      "CRITICAL TASK COMPLETION RULES:",
      "1. Your PRIMARY goal is to COMPLETE the original task — the previous attempt was INCOMPLETE.",
      "2. Focus on the uncovered files listed above. Read each one, understand what change is needed, then produce the change block.",
      "3. You MAY add new functions, classes, imports, or variables as needed to complete the task.",
      "4. Do NOT re-modify files that were already changed — only fill in what's missing.",
      "5. Produce one change block per uncovered file. Cover every file listed in the PATCH INCOMPLETE section.",
      "6. If you're unsure what a file needs, use read_file to inspect it first.",
      "7. After producing all change blocks, output <DONE/>.",
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
      isCompletionMode ? completionConstraints : repairConstraints,
      "",
      incompleteHint ?? "",
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
    const repairToolRounds: import("./task-state.js").ToolRoundRecord[] = [];

    for (let tr = 0; tr <= MAX_REPAIR_TOOL_ROUNDS; tr++) {
      const response = await config.client.chat({
        model: "deepseek-v4-pro",
        messages,
        thinking: true,
        tools: ALL_TOOL_DEFINITIONS as unknown as Record<string, unknown>[],
      });

      const choice = response.choices[0];
      if (!choice) break;
      content = choice.message.content;
      const toolCalls = choice.message.tool_calls;

      if (toolCalls && toolCalls.length > 0 && tr < MAX_REPAIR_TOOL_ROUNDS) {
        const assistantMsg: DeepSeekMessage = { role: "assistant", content, tool_calls: toolCalls };
        if (choice.message.reasoning_content) assistantMsg.reasoning_content = choice.message.reasoning_content;
        messages.push(assistantMsg);
        
        const callRecords: import("./task-state.js").ToolCallRecord[] = [];
        for (const tc of toolCalls) {
          let rawArgs: unknown = {};
          try { rawArgs = JSON.parse(tc.function.arguments); } catch { /* keep empty */ }
          const args = normalizeToolArguments(rawArgs);
          const result = executeTool(tc.function.name as ToolName, args, config.cwd, tc.id);
          const formatted = formatToolResult(tc.function.name as ToolName, args, result);
          messages.push({ role: "tool", content: formatted, tool_call_id: tc.id });
          callRecords.push({
            name: tc.function.name,
            arguments: args,
            status: result.status,
            summary: result.status === "success" ? result.content.slice(0, 200) : (result.error ?? "").slice(0, 200),
          });
        }
        repairToolRounds.push({ round: tr + 1, calls: callRecords });
        continue;
      }
      break;
    }

    // Parse and apply the repair patch
    let patchText: string | null = null;
    let applyError: string | null = null;
    let patched = false;
    let filesChanged: string[] = [];
    let rolledBack = false;

    // ---- Checkpoint (PHASE-3-D) ----
    if (isGitRepo(config.cwd)) {
      createCheckpoint(config.cwd, `dsh-checkpoint-repair-round-${round}`);
    }

    try {
      const changes = parseChanges(content);
      patchText = [
        ...changes.creates.map((c) => `<CREATE path="${c.path}">\n${c.content}\n</CREATE>`),
        ...changes.renames.map((r) => `<RENAME from="${r.from}" to="${r.to}" />`),
        ...changes.deletePaths.map((p) => `<DELETE path="${p}" />`),
        ...changes.searchReplaceBlocks.map((s) => `<PATCH type="search" file="${s.filePath}">\n<<<<<<< SEARCH\n${s.search}\n=======\n${s.replace}\n>>>>>>> REPLACE\n</PATCH>`),
        changes.patchText ? `<PATCH>\n${changes.patchText}\n</PATCH>` : "",
      ].filter(Boolean).join("\n\n") || null;
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
    } catch (e) {
      applyError = e instanceof Error ? e.message : String(e);
    }

    // Record the patch attempt
    current.repair_rounds = round;
    current.patches.push({
      round,
      patch: patchText ?? "",
      apply_status: patched ? "ok" : "failed",
      files_changed: filesChanged,
      tool_rounds: repairToolRounds.length > 0 ? repairToolRounds : undefined,
    });

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
