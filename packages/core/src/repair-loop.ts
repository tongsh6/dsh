import type { DeepSeekClient } from "@dsh/provider";
import type { TaskState } from "./task-state.js";
import { transition, writeTaskState } from "./task-state.js";
import { buildDynamicContext } from "./context-builder.js";
import { buildMessages } from "./prompt-builder.js";
import { parseChanges, applyChanges } from "./patch-parser.js";
import { runVerify, isAllPassed, formatResults } from "./verifier.js";
import { buildUserMessage } from "./prompt-builder.js";
import type { ContextLayers } from "./context-builder.js";
import { detectFailures, buildRepairHints } from "./failure-detector.js";

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

    const repairConstraints = [
      "CRITICAL REPAIR RULES:",
      "1. Make the SMALLEST possible change to fix the failure — change as few lines as possible.",
      "2. NEVER delete or modify existing imports unless they are directly causing the test failure.",
      "3. NEVER add new functions, classes, or variables that were not part of the original task.",
      "4. NEVER restructure or reformat code that is unrelated to the failure.",
      "5. ONLY fix the specific error in the verify output. Do not make additional improvements.",
      "6. If the original patch was wrong, revert to the original code and try a different minimal approach.",
      "7. Preserve ALL existing code that is not related to the error. Every deleted line must be justified by the verify failure output.",
    ].join("\n");

    const taskDescription = [
      repairConstraints,
      "",
      failureHints ?? "The previous patch failed verification. Analyze the errors and fix the code.",
      "",
      "Original task: " + current.task.description,
    ].join("\n");

    const messages = buildMessages({
      context: { ...config.contextLayers, dynamic },
      taskDescription,
      phase: "patch",
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
