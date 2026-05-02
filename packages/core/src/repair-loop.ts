import { execSync } from "node:child_process";
import * as path from "node:path";
import type { DeepSeekClient } from "@dsh/provider";
import type { TaskState } from "./task-state.js";
import { transition, writeTaskState } from "./task-state.js";
import { buildDynamicContext } from "./context-builder.js";
import { buildMessages } from "./prompt-builder.js";
import { parseChanges, applyChanges } from "./patch-parser.js";
import { runVerify, isAllPassed, formatResults } from "./verifier.js";
import type { ContextLayers } from "./context-builder.js";
import {
  detectFailures,
  buildRepairHints,
  detectSignatureChanges,
  findCallSites,
  formatCallSiteContext,
} from "./failure-detector.js";

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
  const patterns: RegExp[] = [
    /\b([a-z_][a-z0-9_]{3,})\b/gi,
    /\b([A-Z][a-zA-Z0-9]{3,})\b/g,
    /(?:in|from)\s+['"]?([\w./-]+\/[\w./-]+)['"]?/g,
    /File\s+"([^"]+)"/g,
  ];

  const identifiers = new Set<string>();
  const stopWords = new Set(["the", "and", "but", "not", "are", "was", "were", "this", "that", "with", "from", "have", "been", "will"]);

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(verifyOutput)) !== null) {
      const id = (match[1] ?? match[2])?.toLowerCase();
      if (id && id.length >= 4 && !stopWords.has(id) && !/^\d+$/.test(id)) {
        identifiers.add(id);
      }
    }
  }

  if (identifiers.size === 0) return null;

  const topIds = [...identifiers]
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);

  const excludeSet = new Set(changedFiles.map((f) => path.basename(f)));
  const results: string[] = [];

  for (const id of topIds) {
    if (results.length >= maxResults) break;
    try {
      const output = execSync(
        `grep -rn "${id}" . --include="*.py" --include="*.ts" --include="*.tsx" 2>/dev/null`,
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
        const content = (m[3] ?? "").trim();
        if (excludeSet.has(path.basename(file))) continue;
        if (file.includes("node_modules/") || file.includes(".dsh/") || file.includes("dist/") || file.includes("__pycache__/")) continue;
        if (content.startsWith("#") || content.startsWith("//")) continue;
        results.push(`${file}:${m[2]}: ${content.slice(0, 150)}`);
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

export async function runRepairLoop(
  state: TaskState,
  config: RepairConfig,
): Promise<TaskState> {
  let current = transition(state, "repairing");

  for (let round = 1; round <= config.maxRounds; round++) {
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
      const detections = detectFailures({
        response: prevPatch?.patch ?? "",
        planFiles: current.plan?.files ?? [],
        actualChangedFiles: prevPatch?.files_changed ?? [],
        verifyOutput,
        patchApplyError: prevPatch?.apply_status === "failed" ? prevPatch.patch : null,
      });
      failureHints = buildRepairHints(detections);
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
    if (prevVerifyOutput) {
      searchContext = grepForErrorIdentifiers(
        config.cwd,
        prevVerifyOutput,
        prevPatch?.files_changed ?? [],
        15,
      );
    }

    const repairConstraints = [
      "CRITICAL REPAIR RULES:",
      "1. Make the SMALLEST possible change to fix the failure — change as few lines as possible.",
      "2. NEVER delete or modify existing imports unless they are directly causing the test failure.",
      "3. NEVER add new functions, classes, or variables that were not part of the original task.",
      "4. NEVER restructure or reformat code that is unrelated to the failure.",
      "5. ONLY fix the specific error in the verify output. Do not make additional improvements.",
      "6. If the original patch was wrong, revert to the original code and try a different minimal approach.",
      "7. Preserve ALL existing code that is not related to the error. Every deleted line must be justified by the verify failure output.",
      "8. If unified diff failed to apply in the previous round, use <PATCH type=\"search\" file=\"path\"> with SEARCH/REPLACE blocks instead. Copy the SEARCH block EXACTLY from the file content — this avoids line-number errors.",
      "9. If you changed a function signature (parameters or return type), check ALL callers — they likely need updating, or you should revert the signature change.",
    ].join("\n");

    const taskDescription = [
      repairConstraints,
      "",
      failureHints ?? "The previous patch failed verification. Analyze the errors and fix the code.",
      "",
      callSiteContext ?? "",
      "",
      searchContext ?? "",
      "",
      "Original task: " + current.task.description,
    ].join("\n");

    const messages = buildMessages({
      context: { ...config.contextLayers, dynamic },
      taskDescription,
      phase: "repair",
    });

    // Route to Pro + thinking for repair
    const target = { model: "deepseek-v4-pro", thinking: true };
    const response = await config.client.chat({
      model: target.model,
      messages,
      thinking: target.thinking,
    });

    const content = response.choices[0]?.message.content ?? "";

    // Parse and apply the repair patch
    let patchText: string | null = null;
    let applyError: string | null = null;
    let patched = false;
    let filesChanged: string[] = [];

    try {
      const changes = parseChanges(content);
      patchText = [
        ...changes.creates.map((c) => `<CREATE path="${c.path}">\n${c.content}\n</CREATE>`),
        ...changes.renames.map((r) => `<RENAME from="${r.from}" to="${r.to}" />`),
        ...changes.deletePaths.map((p) => `<DELETE path="${p}" />`),
        changes.patchText ?? "",
      ].filter(Boolean).join("\n\n") || null;
      const applyResult = applyChanges(config.cwd, changes, false);
      patched = applyResult.success;
      filesChanged = [...applyResult.createdFiles, ...applyResult.renamedFiles, ...applyResult.patchedFiles, ...applyResult.deletedFiles];
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
    });

    // Run verification
    let verified = false;
    let verifyOutput: string | null = null;

    if (patched) {
      current = transition(current, "patched");

      const verifyCommands = current.plan?.verify_commands ?? [];
      if (verifyCommands.length > 0) {
        const results = runVerify(verifyCommands, config.cwd);
        verified = isAllPassed(results);
        verifyOutput = formatResults(results);
        current.verify_results.push({ round, results });
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
  }

  if (current.status === "verification_failed" || current.status === "repairing") {
    current = transition(current, "repair_exhausted");
  }

  writeTaskState(config.cwd, current);
  return current;
}
