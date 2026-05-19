// Patch coverage state machine v2 — contract-first, validator-driven,
// repair-aware patch stage. Replaces the legacy "big while + many exits" loop
// when PATCH_STATE_MACHINE_V2 is enabled. The patch stage's exit is bound to
// *required target file coverage* (PatchCoverageValidator) rather than to
// model-behaviour signals (done / invalid / tools-only / rounds).
//
// Phases: patch_explore -> coverage_finalization -> patch_validate -> decide.
// See spec docs/specs/2026-05-19-patch-pipeline-coverage-state-machine.md.

import type { DeepSeekClient, DeepSeekMessage } from "@dsh/provider";
import {
  isGitRepo,
  createCheckpoint,
  applyRollback,
  createFileCheckpoint,
  applyFileRollback,
} from "@dsh/repo";
import type { TaskState, PatchRoundRecord, PatchRecord } from "./task-state.js";
import { transition, writeTaskState } from "./task-state.js";
import { parsePatchTurn } from "./patch-parser.js";
import { applySingleChange } from "./pipeline.js";
import { ALL_TOOL_DEFINITIONS } from "./tool-definitions.js";
import {
  executeToolCallsForPolicy,
  filterToolsForPolicy,
  getToolPolicy,
} from "./agent-turn-loop.js";
import { recordDeepSeekUsage } from "./deepseek-usage.js";
import { buildPlanFileContract, normalizePath } from "./plan-file-contract.js";
import type { PlanFileContract } from "./plan-file-contract.js";
import { validatePatchCoverage, computeCoverageDelta } from "./patch-coverage.js";

// ---- Tunable thresholds (spec §4.5) ----

const MAX_PATCH_ROUNDS = 30;
const MAX_CONSECUTIVE_INVALID = 3;
// Tool-only turns before the first change: analysis-paralysis guard pauses tools.
const MAX_INITIAL_TOOLS_ONLY = 10;
const MAX_ROUNDS_WITHOUT_COVERAGE_PROGRESS = 5;
const MAX_VALID_CHANGES_WITHOUT_PROGRESS = 2;
const MAX_TOOLS_ONLY_AFTER_PATCH = 8;
const TRIGGER_WHEN_ROUNDS_LEFT_LTE = 3;

// ---- Feature flags (Commit 3 reads env; Commit 5 wires .dsh/config.yml) ----

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return raw !== "false" && raw !== "0";
}

export function isPatchStateMachineV2Enabled(): boolean {
  return envFlag("PATCH_STATE_MACHINE_V2", true);
}

export function isStrictRequiredCoverageEnabled(): boolean {
  return envFlag("STRICT_REQUIRED_TARGET_COVERAGE", false);
}

// ---- State ----

export interface PatchLoopState {
  round: number;
  maxRounds: number;
  hasStartedPatching: boolean;
  coveredRequiredFiles: Set<string>;
  missingRequiredFiles: Set<string>;
  invalidStreak: number;
  consecutiveToolsOnly: number;
  roundsSinceCoverageProgress: number;
  validChangesWithoutCoverageProgress: number;
  coverageFinalizationAttempted: boolean;
  modelSaidDoneWithMissing: boolean;
}

export type ExploreExitReason =
  | "covered"
  | "model_done_missing"
  | "needs_finalization"
  | "invalid_streak"
  | "max_rounds";

export interface ExploreResult {
  appliedChangedFiles: string[];
  loop: PatchLoopState;
  modelSaidDone: boolean;
  exitReason: ExploreExitReason;
}

export interface FinalizationResult {
  appliedChangedFiles: string[];
  attempted: boolean;
  succeeded: boolean;
}

export interface PatchDecision {
  status: "patched" | "patch_partial" | "patch_failed";
  coverage: "full" | "partial";
  reason: string;
}

interface ModelTarget {
  model: string;
  thinking: boolean;
}

// ---- Pure decision helpers (deterministic, unit-tested) ----

// Whether the explore loop is stalling — the model is no longer making
// coverage progress. This drives loop termination regardless of whether
// required coverage is already complete (a covered-but-not-DONE model must
// still be stopped). The counters are coverage-aware: only a change that
// covers a new required file resets them, so dripping off-plan or repeat
// changes cannot keep the loop alive (spec §4.4).
function isExploreStalled(loop: PatchLoopState): boolean {
  if (!loop.hasStartedPatching) return false;
  const roundsLeft = loop.maxRounds - loop.round;
  return (
    loop.roundsSinceCoverageProgress >= MAX_ROUNDS_WITHOUT_COVERAGE_PROGRESS ||
    loop.validChangesWithoutCoverageProgress >= MAX_VALID_CHANGES_WITHOUT_PROGRESS ||
    loop.consecutiveToolsOnly >= MAX_TOOLS_ONLY_AFTER_PATCH ||
    roundsLeft <= TRIGGER_WHEN_ROUNDS_LEFT_LTE ||
    loop.invalidStreak >= MAX_CONSECUTIVE_INVALID
  );
}

// Whether the patch stage should hand off to coverage_finalization: required
// coverage is incomplete, finalization has not been attempted, and the model
// has either declared DONE or stalled. Used by maybeRunCoverageFinalization.
export function shouldEnterCoverageFinalization(loop: PatchLoopState): boolean {
  if (loop.coverageFinalizationAttempted) return false;
  if (loop.missingRequiredFiles.size === 0) return false;
  return loop.modelSaidDoneWithMissing || isExploreStalled(loop);
}

// Map a coverage validation result to a patch outcome. <DONE/> never bypasses
// this — it is always routed through validatePatchCoverage first (spec §4.7).
export function decidePatchStatus(args: {
  hasOkChanges: boolean;
  fullRequiredCoverage: boolean;
  missingRequiredFiles: string[];
  strictFailureEligible: boolean;
  strictGateEnabled: boolean;
  coverageFinalizationAttempted: boolean;
}): PatchDecision {
  if (!args.hasOkChanges) {
    return {
      status: "patch_failed",
      coverage: "partial",
      reason: "no_successful_change_applied",
    };
  }
  if (args.fullRequiredCoverage) {
    return {
      status: "patched",
      coverage: "full",
      reason: "all_required_target_files_covered",
    };
  }

  // Required coverage incomplete. A strict hard gate fails the patch only when
  // every required entry is explicit_v2 high confidence AND the gate flag is on
  // AND finalization has already had its chance — legacy contracts never
  // qualify (spec §4.9 / §5 D4), so they always route to patch_partial.
  const strictHardGate =
    args.strictGateEnabled &&
    args.strictFailureEligible &&
    args.coverageFinalizationAttempted &&
    args.missingRequiredFiles.length > 0;
  if (strictHardGate) {
    return {
      status: "patch_failed",
      coverage: "partial",
      reason: `strict_required_coverage_gate: missing [${args.missingRequiredFiles.join(", ")}]`,
    };
  }

  return {
    status: "patch_partial",
    coverage: "partial",
    reason: args.coverageFinalizationAttempted
      ? `done_with_missing_required_files_after_finalization: [${args.missingRequiredFiles.join(", ")}]`
      : `missing_required_files: [${args.missingRequiredFiles.join(", ")}]`,
  };
}

// ---- Checkpoint helpers (transactional safety, PHASE-3-D) ----

function performCheckpoint(cwd: string, id: string, managedFiles: string[]): boolean {
  return isGitRepo(cwd) ? createCheckpoint(cwd, id) : createFileCheckpoint(cwd, id, managedFiles);
}

function performRollback(cwd: string, id: string): boolean {
  return isGitRepo(cwd) ? applyRollback(cwd) : applyFileRollback(cwd, id);
}

// ---- patch_explore ----

function buildCoverageProgressMessage(
  applyOk: boolean,
  applyError: string | undefined,
  changeFile: string,
  op: string,
  loop: PatchLoopState,
): string {
  const base = applyOk
    ? `✓ change applied: ${changeFile} (op=${op})`
    : `✗ change failed: ${applyError ?? "unknown error"}`;
  const required = loop.coveredRequiredFiles.size + loop.missingRequiredFiles.size;
  if (required === 0) return base;
  if (loop.missingRequiredFiles.size === 0) {
    return `${base}\n进度: required target 已全部覆盖 (${loop.coveredRequiredFiles.size}/${required})，可输出 <DONE/>。`;
  }
  return (
    `${base}\n进度: required target 覆盖 ${loop.coveredRequiredFiles.size}/${required}，` +
    `仍未修改: [${[...loop.missingRequiredFiles].join(", ")}]。请优先对这些文件输出 change block。`
  );
}

async function runPatchExplore(args: {
  state: TaskState;
  cwd: string;
  client: DeepSeekClient;
  dryRun: boolean;
  messages: DeepSeekMessage[];
  target: ModelTarget;
  contract: PlanFileContract;
}): Promise<ExploreResult> {
  const { state, cwd, client, dryRun, messages, target, contract } = args;
  const toolPolicy = getToolPolicy("patch");
  const tools = filterToolsForPolicy(ALL_TOOL_DEFINITIONS, toolPolicy);

  const loop: PatchLoopState = {
    round: 0,
    maxRounds: MAX_PATCH_ROUNDS,
    hasStartedPatching: false,
    coveredRequiredFiles: new Set(),
    missingRequiredFiles: new Set(contract.requiredTargetFiles.map((e) => e.path)),
    invalidStreak: 0,
    consecutiveToolsOnly: 0,
    roundsSinceCoverageProgress: 0,
    validChangesWithoutCoverageProgress: 0,
    coverageFinalizationAttempted: false,
    modelSaidDoneWithMissing: false,
  };
  const appliedChangedFiles: string[] = [];
  let modelSaidDone = false;
  let exitReason: ExploreExitReason = "max_rounds";

  while (loop.round < loop.maxRounds) {
    loop.round++;

    const toolsPaused =
      !loop.hasStartedPatching && loop.consecutiveToolsOnly >= MAX_INITIAL_TOOLS_ONLY;
    const startedAt = Date.now();
    const response = await client.chat({
      model: target.model,
      messages,
      thinking: target.thinking,
      ...(toolsPaused ? {} : { tools: tools as unknown as Record<string, unknown>[] }),
    });
    recordDeepSeekUsage(state, {
      phase: "patch",
      model: target.model,
      thinking: target.thinking,
      durationMs: Date.now() - startedAt,
      response,
    });

    const choice = response.choices[0];
    if (!choice) throw new Error("DeepSeek API 返回空响应");
    const content = choice.message.content ?? "";
    const toolCalls = choice.message.tool_calls;
    const hasToolCalls = (toolCalls?.length ?? 0) > 0;

    let action = toolsPaused && hasToolCalls
      ? { kind: "invalid" as const, reason: "tool calls are paused after analysis paralysis; output one change block" }
      : parsePatchTurn(content, hasToolCalls);
    if (action.kind === "invalid" && hasToolCalls && !toolsPaused) {
      action = { kind: "tools" };
    }

    const record: PatchRoundRecord = {
      round: loop.round,
      action: action.kind,
      duration_ms: Date.now() - startedAt,
    };

    if (action.kind === "tools") {
      const assistantMsg: DeepSeekMessage = { role: "assistant", content, tool_calls: toolCalls ?? undefined };
      if (choice.message.reasoning_content) assistantMsg.reasoning_content = choice.message.reasoning_content;
      messages.push(assistantMsg);
      const toolResult = await executeToolCallsForPolicy({
        toolCalls: toolCalls ?? [],
        toolPolicy,
        tools: ALL_TOOL_DEFINITIONS,
        cwd,
      });
      messages.push(...toolResult.messages);
      record.tool_calls = toolResult.records;
      loop.invalidStreak = 0;
      loop.consecutiveToolsOnly++;
      if (loop.hasStartedPatching) loop.roundsSinceCoverageProgress++;
      state.patch_rounds.push(record);
      writeTaskState(cwd, state);
    } else if (action.kind === "change") {
      loop.consecutiveToolsOnly = 0;
      loop.invalidStreak = 0;
      loop.hasStartedPatching = true;
      if (choice.message.reasoning_content) {
        record.reasoning_excerpt = choice.message.reasoning_content.slice(0, 500);
      }

      const checkpointId = `dsh-checkpoint-patch-round-${loop.round}`;
      if (!dryRun) performCheckpoint(cwd, checkpointId, state.managed_files);
      const result = applySingleChange(cwd, action.change, dryRun);
      if (!result.ok && !dryRun) performRollback(cwd, checkpointId);

      record.change = {
        op: action.change.op,
        file: action.change.file,
        apply_status: result.ok ? "ok" : "failed",
        apply_error: result.error,
        raw_block: action.change.raw_block,
      };

      let coverageDelta = new Set<string>();
      if (result.ok && result.files_changed.length > 0) {
        const managed = new Set(state.managed_files);
        for (const f of result.files_changed) managed.add(f);
        state.managed_files = [...managed];
        appliedChangedFiles.push(...result.files_changed);
        coverageDelta = computeCoverageDelta(result.files_changed, loop.missingRequiredFiles);
      }

      // Coverage progress: ONLY a change that covers a previously-missing
      // required file resets the stall counters. Re-editing a covered file or
      // touching an off-plan file is not progress (spec §4.4).
      if (coverageDelta.size > 0) {
        for (const f of coverageDelta) {
          loop.coveredRequiredFiles.add(f);
          loop.missingRequiredFiles.delete(f);
        }
        loop.roundsSinceCoverageProgress = 0;
        loop.validChangesWithoutCoverageProgress = 0;
      } else {
        loop.roundsSinceCoverageProgress++;
        if (result.ok) loop.validChangesWithoutCoverageProgress++;
      }

      messages.push({
        role: "user",
        content: buildCoverageProgressMessage(
          result.ok,
          result.error,
          action.change.file,
          action.change.op,
          loop,
        ),
      });
      state.patch_rounds.push(record);
      writeTaskState(cwd, state);
    } else if (action.kind === "done") {
      if (!loop.hasStartedPatching) {
        // <DONE/> before any change — reject and ask for at least one change.
        record.action = "invalid";
        record.invalid_reason = "done_with_no_changes";
        loop.invalidStreak++;
        state.patch_rounds.push(record);
        writeTaskState(cwd, state);
        messages.push({
          role: "user",
          content:
            "<DONE/> rejected: no change has been applied yet. " +
            "Produce at least one change block before signalling done.",
        });
      } else {
        modelSaidDone = true;
        if (choice.message.reasoning_content) {
          record.reasoning_excerpt = choice.message.reasoning_content.slice(0, 500);
        }
        state.patch_rounds.push(record);
        writeTaskState(cwd, state);
        if (loop.missingRequiredFiles.size === 0) {
          exitReason = "covered";
        } else {
          loop.modelSaidDoneWithMissing = true;
          exitReason = "model_done_missing";
        }
        break;
      }
    } else {
      record.invalid_reason = action.reason;
      loop.invalidStreak++;
      if (loop.hasStartedPatching) loop.roundsSinceCoverageProgress++;
      state.patch_rounds.push(record);
      writeTaskState(cwd, state);
      messages.push({
        role: "user",
        content:
          `Invalid response: ${action.reason}. You must output EXACTLY ONE of: ` +
          "tool calls, ONE change block, or <DONE/>. Please try again.",
      });
    }

    // ---- Exit evaluation ----
    // The loop stops when the model stalls (coverage-aware counters) — NOT the
    // instant coverage completes, so a covered model still gets to emit
    // <DONE/>. Coverage state is computed afterwards by the validator and
    // decides patched vs patch_partial; it never short-circuits the loop here.
    if (isExploreStalled(loop)) {
      exitReason = loop.missingRequiredFiles.size === 0 ? "covered" : "needs_finalization";
      break;
    }
    // isExploreStalled ignores the pre-patching phase, so cap an invalid streak
    // from a model that never produces a change explicitly.
    if (!loop.hasStartedPatching && loop.invalidStreak >= MAX_CONSECUTIVE_INVALID) {
      exitReason = "invalid_streak";
      break;
    }
  }

  return { appliedChangedFiles, loop, modelSaidDone, exitReason };
}

// ---- coverage_finalization ----

// Commit 4 fills this stage in: a no-tools finalization call that injects the
// missing required files' content and asks the model to cover them. Until then
// it is a pass-through that reports finalization as not attempted, so a patch
// with missing required files decides to patch_partial.
function maybeRunCoverageFinalization(args: {
  state: TaskState;
  cwd: string;
  client: DeepSeekClient;
  dryRun: boolean;
  contract: PlanFileContract;
  explore: ExploreResult;
}): Promise<FinalizationResult> {
  return Promise.resolve({
    appliedChangedFiles: args.explore.appliedChangedFiles,
    attempted: false,
    succeeded: false,
  });
}

// ---- patch_validate + decide ----

function decidePatchResult(args: {
  state: TaskState;
  cwd: string;
  contract: PlanFileContract;
  finalization: FinalizationResult;
}): TaskState {
  let state = args.state;
  const { contract, finalization } = args;

  const validation = validatePatchCoverage({
    contract,
    appliedChangedFiles: finalization.appliedChangedFiles,
  });

  const okChangeRounds = state.patch_rounds.filter(
    (r) => r.action === "change" && r.change?.apply_status === "ok",
  );
  const failedChangeRounds = state.patch_rounds.filter(
    (r) => r.action === "change" && r.change?.apply_status === "failed",
  );
  const hasOkChanges = okChangeRounds.length > 0;

  const decision = decidePatchStatus({
    hasOkChanges,
    fullRequiredCoverage: validation.fullRequiredCoverage,
    missingRequiredFiles: validation.missingRequiredFiles,
    strictFailureEligible: validation.strictFailureEligible,
    strictGateEnabled: isStrictRequiredCoverageEnabled(),
    coverageFinalizationAttempted: finalization.attempted,
  });

  const dedupedFiles = [...new Set(finalization.appliedChangedFiles.map(normalizePath))];
  const patchText =
    state.patch_rounds
      .filter((r) => r.action === "change" && r.change)
      .map((r) => r.change!.raw_block)
      .join("\n\n") || "<empty>";

  let applyStatus: "ok" | "partial_ok" | "failed";
  if (hasOkChanges && failedChangeRounds.length === 0) applyStatus = "ok";
  else if (hasOkChanges) applyStatus = "partial_ok";
  else applyStatus = "failed";

  const newPatch: PatchRecord = {
    round: (state.repair_rounds ?? 0) + 1,
    patch: patchText,
    apply_status: applyStatus,
    files_changed: dedupedFiles,
    coverage: decision.coverage,
    covered_required_files: validation.coveredRequiredFiles,
    missing_required_files: validation.missingRequiredFiles,
    coverage_finalization_attempted: finalization.attempted,
    plan_file_contract_version: contract.version,
  };
  if (decision.status !== "patched") {
    newPatch.patch_partial_reason = decision.reason;
    if (validation.missingRequiredFiles.length > 0) {
      // Keep the legacy field populated for older repair/handoff consumers.
      newPatch.patch_incomplete_reason = `uncovered required files: ${validation.missingRequiredFiles.join(", ")}`;
    }
  }
  state.patches.push(newPatch);

  state = transition(state, decision.status);
  writeTaskState(args.cwd, state);
  return state;
}

// ---- Orchestrator ----

export async function runPatchPipeline(args: {
  state: TaskState;
  cwd: string;
  client: DeepSeekClient;
  dryRun: boolean;
  messages: DeepSeekMessage[];
  target: ModelTarget;
}): Promise<TaskState> {
  const contract = buildPlanFileContract(args.state.plan);

  const explore = await runPatchExplore({
    state: args.state,
    cwd: args.cwd,
    client: args.client,
    dryRun: args.dryRun,
    messages: args.messages,
    target: args.target,
    contract,
  });

  const finalization = await maybeRunCoverageFinalization({
    state: args.state,
    cwd: args.cwd,
    client: args.client,
    dryRun: args.dryRun,
    contract,
    explore,
  });

  return decidePatchResult({
    state: args.state,
    cwd: args.cwd,
    contract,
    finalization,
  });
}
