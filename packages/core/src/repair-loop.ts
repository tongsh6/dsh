import type { DeepSeekClient } from "@dsh/provider";
import type { TaskState } from "./task-state.js";
import { transition, writeTaskState } from "./task-state.js";
import { buildDynamicContext } from "./context-builder.js";
import { buildMessages } from "./prompt-builder.js";
import { parsePatch, applyPatch } from "./patch-parser.js";
import { runVerify, isAllPassed, formatResults } from "./verifier.js";
import { buildUserMessage } from "./prompt-builder.js";
import type { ContextLayers } from "./context-builder.js";

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

    const messages = buildMessages({
      context: { ...config.contextLayers, dynamic },
      taskDescription: `The previous patch failed verification. Analyze the errors and fix the code.\n\nOriginal task: ${current.task.description}`,
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
      const parsed = parsePatch(content);
      patchText = parsed.patchText;
      const applyResult = applyPatch(config.cwd, patchText, false);
      patched = applyResult.success;
      filesChanged = applyResult.files;
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
