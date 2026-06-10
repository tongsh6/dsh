// Patch coverage state machine v2 — contract-first, validator-driven,
// repair-aware patch stage. Replaces the legacy "big while + many exits" loop
// when PATCH_STATE_MACHINE_V2 is enabled. The patch stage's exit is bound to
// *required target file coverage* (PatchCoverageValidator) rather than to
// model-behaviour signals (done / invalid / tools-only / rounds).
//
// Phases: patch_explore -> coverage_finalization -> patch_validate -> decide.
// See spec docs/specs/2026-05-19-patch-pipeline-coverage-state-machine.md.

import * as fs from "node:fs";
import * as path from "node:path";
import type { DeepSeekClient, DeepSeekMessage, DeepSeekToolCall } from "@dsh/provider";
import {
  isGitRepo,
  createCheckpoint,
  applyRollback,
  createFileCheckpoint,
  applyFileRollback,
  loadDshConfig,
} from "@dsh/repo";
import type { TaskState, PatchRoundRecord, PatchRecord } from "./task-state.js";
import { transition, writeTaskState } from "./task-state.js";
import { parsePatchTurn, parseChanges, applyChanges } from "./patch-parser.js";
import type { ChangeBlock, PatchTurnAction, ProtocolOp } from "./patch-parser.js";
import { recoverDsmlWrappedChange } from "./dsml-recovery.js";
import { buildMessages } from "./prompt-builder.js";
import type { ContextLayers } from "./context-builder.js";
import { applySingleChange } from "./pipeline.js";
import { ALL_TOOL_DEFINITIONS } from "./tool-definitions.js";
import {
  executeToolCallsForPolicy,
  filterToolsForPolicy,
  getToolPolicy,
} from "./agent-turn-loop.js";
import { recordDeepSeekUsage } from "./deepseek-usage.js";
import { formatRenameIntentGuidance } from "./rename-intent.js";
import { buildPlanFileContract, normalizePath } from "./plan-file-contract.js";
import type { PlanFileContract } from "./plan-file-contract.js";
import { validatePatchCoverage, computeCoverageDelta } from "./patch-coverage.js";
import type { PatchCoverageValidation } from "./patch-coverage.js";

// ---- Tunable thresholds (spec §4.5) ----

const MAX_PATCH_ROUNDS = 30;
const MAX_CONSECUTIVE_INVALID = 3;
// Tool-only turns before the first change: analysis-paralysis guard pauses tools.
const MAX_INITIAL_TOOLS_ONLY = 10;
const MAX_ROUNDS_WITHOUT_COVERAGE_PROGRESS = 5;
const MAX_VALID_CHANGES_WITHOUT_PROGRESS = 2;
const MAX_TOOLS_ONLY_AFTER_PATCH = 8;
const TRIGGER_WHEN_ROUNDS_LEFT_LTE = 3;
// coverage_finalization injects each missing file's content; cap per-file size.
const MAX_FINALIZE_FILE_BYTES = 20_000;

// ---- Feature flags ----
// Resolved from the `.dsh/config.yml` `patch:` section, overridable per
// same-named environment variable (env wins). Defaults per spec §4.9:
// v2 / contract / finalization on, strict required coverage off.

export interface PatchFlags {
  stateMachineV2: boolean;
  planFileContractV2: boolean;
  coverageFinalization: boolean;
  strictRequiredCoverage: boolean;
  editsAsNativeTool: boolean;
}

function resolveFlag(
  patchConfig: Record<string, unknown>,
  configKey: string,
  envKey: string,
  fallback: boolean,
): boolean {
  const env = process.env[envKey];
  if (env !== undefined && env !== "") return env !== "false" && env !== "0";
  const fromConfig = patchConfig[configKey];
  if (typeof fromConfig === "boolean") return fromConfig;
  return fallback;
}

export function resolvePatchFlags(cwd: string): PatchFlags {
  let patchConfig: Record<string, unknown> = {};
  try {
    const raw = loadDshConfig(cwd)["patch"];
    if (raw && typeof raw === "object") patchConfig = raw as Record<string, unknown>;
  } catch {
    // No / unreadable config — fall back to env and defaults.
  }
  return {
    stateMachineV2: resolveFlag(patchConfig, "state_machine_v2", "PATCH_STATE_MACHINE_V2", true),
    planFileContractV2: resolveFlag(patchConfig, "plan_file_contract_v2", "PLAN_FILE_CONTRACT_V2", true),
    coverageFinalization: resolveFlag(patchConfig, "coverage_finalization", "PATCH_COVERAGE_FINALIZATION", true),
    strictRequiredCoverage: resolveFlag(patchConfig, "strict_required_target_coverage", "STRICT_REQUIRED_TARGET_COVERAGE", false),
    editsAsNativeTool: resolveFlag(patchConfig, "edits_as_native_tool", "PATCH_EDITS_AS_NATIVE_TOOL", false),
  };
}

export function isPatchStateMachineV2Enabled(cwd: string): boolean {
  return resolvePatchFlags(cwd).stateMachineV2;
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
  patchText?: string;
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
  if (loop.missingRequiredFiles.size === 0) return false;
  if (!loop.hasStartedPatching) {
    return loop.invalidStreak >= MAX_CONSECUTIVE_INVALID || loop.round >= loop.maxRounds;
  }
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
  editInstruction = "change block",
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
    `仍未修改: [${[...loop.missingRequiredFiles].join(", ")}]。请优先对这些文件输出 ${editInstruction}。`
  );
}

// Spoken to the model when the analysis-paralysis guard pauses tools. The
// legacy runPatch loop had an equivalent warning; the v2 explore loop dropped
// it (regression — benchmark 260519132104 / rename-distill-state: tools were
// paused silently, the model then emitted prose and the turn parsed as
// "no action" three times in a row). Tell the model explicitly what happened
// and what it must do.
function buildToolsPausedWarning(
  contract: PlanFileContract,
  loop: PatchLoopState,
  editsAsNativeTool: boolean,
): string {
  const target =
    [...loop.missingRequiredFiles][0] ??
    contract.requiredTargetFiles[0]?.path ??
    "the first target file";
  if (editsAsNativeTool) {
    return [
      "## SYSTEM: EXPLORATION TOOLS PAUSED",
      `You have used ${MAX_INITIAL_TOOLS_ONLY} consecutive exploration tool calls without producing any change.`,
      "Exploration tools are now disabled. Your next response MUST be exactly ONE apply_patch tool call — not read_file, not grep_files, not prose, not explanation.",
      `Start with: ${target}`,
      'Use protocol_op CREATE for a new file, RENAME to rename a file, DELETE to remove one, or PATCH/SEARCH_REPLACE/INSERT to edit an existing file.',
    ].join("\n");
  }
  return [
    "## SYSTEM: TOOL ACCESS PAUSED",
    `You have used ${MAX_INITIAL_TOOLS_ONLY} consecutive tool calls without producing any change.`,
    "Tools are now disabled. Your next response MUST be exactly ONE change block — not tool calls, not prose, not explanation.",
    `Start with: ${target}`,
    'Use <CREATE path="..."> for a new file, <RENAME from="old" to="new"/> to rename a file, ' +
      '<DELETE path="..."/> to remove one, or <PATCH>/<PATCH type="search"> to edit an existing file.',
  ].join("\n");
}

type EditSource = "content_xml" | "tool_call";

type PatchExploreAction =
  | { kind: "tools" }
  | { kind: "done" }
  | { kind: "invalid"; reason: string }
  | {
      kind: "change";
      change: ChangeBlock;
      source: EditSource;
      toolCallId?: string;
      toolCallArgs?: Record<string, unknown>;
    };

const APPLY_PATCH_TOOL_NAME = "apply_patch";
const PROTOCOL_OPS = new Set<ProtocolOp>([
  "CREATE",
  "PATCH",
  "SEARCH_REPLACE",
  "INSERT",
  "DELETE",
  "RENAME",
]);

function withContentSource(action: PatchTurnAction): PatchExploreAction {
  if (action.kind === "change") return { ...action, source: "content_xml" };
  return action;
}

function selectPatchExploreAction(args: {
  contentAction: PatchTurnAction;
  toolCalls: DeepSeekToolCall[];
  toolsPaused: boolean;
  editsAsNativeTool: boolean;
}): PatchExploreAction {
  const hasToolCalls = args.toolCalls.length > 0;
  const contentAction = withContentSource(args.contentAction);
  const editToolCalls = args.toolCalls.filter(
    (toolCall) => toolCall.function.name === APPLY_PATCH_TOOL_NAME,
  );

  if (args.toolsPaused && hasToolCalls) {
    const allowPausedNativeEdit =
      args.editsAsNativeTool && editToolCalls.length === 1 && args.toolCalls.length === 1;
    if (!allowPausedNativeEdit) {
      return {
        kind: "invalid",
        reason: args.editsAsNativeTool
          ? "exploration tool calls are paused after analysis paralysis; output one apply_patch tool call"
          : "tool calls are paused after analysis paralysis; output one change block",
      };
    }
  }

  if (!args.editsAsNativeTool || editToolCalls.length === 0) {
    return contentAction.kind === "invalid" && hasToolCalls
      ? { kind: "tools" }
      : contentAction;
  }

  if (editToolCalls.length > 1) {
    return { kind: "invalid", reason: "multiple apply_patch tool calls: output exactly one edit per turn" };
  }
  if (args.toolCalls.length > 1) {
    return { kind: "invalid", reason: "apply_patch cannot be combined with read_file/grep_files in the same turn" };
  }
  if (contentAction.kind === "change") {
    return { kind: "invalid", reason: "apply_patch cannot be combined with a content change block" };
  }
  if (contentAction.kind === "done") {
    return { kind: "invalid", reason: "apply_patch cannot be combined with <DONE/>" };
  }
  if (contentAction.kind === "invalid") {
    return { kind: "invalid", reason: `apply_patch cannot be combined with invalid content: ${contentAction.reason}` };
  }

  return parseApplyPatchToolCall(editToolCalls[0]!);
}

export function parseApplyPatchToolCall(toolCall: DeepSeekToolCall): PatchExploreAction {
  let rawArgs: unknown;
  try {
    rawArgs = toolCall.function.arguments.trim().length > 0
      ? JSON.parse(toolCall.function.arguments)
      : {};
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { kind: "invalid", reason: `Invalid apply_patch arguments JSON: ${detail}` };
  }
  if (rawArgs === null || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return { kind: "invalid", reason: "apply_patch arguments must be a JSON object" };
  }

  const toolCallArgs = rawArgs as Record<string, unknown>;
  const rendered = buildApplyPatchChange(toolCallArgs);
  if (!rendered.ok) return { kind: "invalid", reason: rendered.reason };

  return {
    kind: "change",
    change: rendered.change,
    source: "tool_call",
    toolCallId: toolCall.id,
    toolCallArgs: redactApplyPatchToolArgs(toolCallArgs),
  };
}

function buildApplyPatchChange(
  args: Record<string, unknown>,
) : { ok: true; change: ChangeBlock } | { ok: false; reason: string } {
  const protocolOp = resolveProtocolOp(args);
  if (!protocolOp.ok) {
    return protocolOp;
  }

  if (protocolOp.value === "PATCH" && hasStringArg(args, "path") && hasStringArg(args, "search") && hasStringArg(args, "replace")) {
    return buildApplyPatchChange({ ...args, protocol_op: "SEARCH_REPLACE" });
  }

  switch (protocolOp.value) {
    case "CREATE": {
      const filePath = requiredAttr(args, "path");
      const content = requiredString(args, "content");
      if (!filePath.ok) return filePath;
      if (!content.ok) return content;
      return {
        ok: true,
        change: {
          op: "CREATE",
          file: filePath.value,
          raw_block: `<CREATE path="${filePath.value}">\n${content.value}\n</CREATE>`,
          create: { path: filePath.value, content: content.value },
        },
      };
    }
    case "DELETE": {
      const filePath = requiredAttr(args, "path");
      if (!filePath.ok) return filePath;
      return {
        ok: true,
        change: {
          op: "DELETE",
          file: filePath.value,
          raw_block: `<DELETE path="${filePath.value}" />`,
        },
      };
    }
    case "RENAME": {
      const from = requiredAttr(args, "from");
      const to = requiredAttr(args, "to");
      if (!from.ok) return from;
      if (!to.ok) return to;
      return {
        ok: true,
        change: {
          op: "RENAME",
          file: `${from.value} -> ${to.value}`,
          raw_block: `<RENAME from="${from.value}" to="${to.value}" />`,
          rename: { from: from.value, to: to.value },
        },
      };
    }
    case "SEARCH_REPLACE": {
      const filePath = requiredAttr(args, "path");
      const search = requiredString(args, "search");
      const replace = requiredString(args, "replace");
      if (!filePath.ok) return filePath;
      if (!search.ok) return search;
      if (!replace.ok) return replace;
      const rawBlock =
          `<PATCH type="search" file="${filePath.value}">\n` +
          `<SEARCH>${search.value}</SEARCH>\n` +
          `<REPLACE>${replace.value}</REPLACE>\n` +
          "</PATCH>";
      return {
        ok: true,
        change: {
          op: "SEARCH_REPLACE",
          file: filePath.value,
          raw_block: rawBlock,
          searchReplace: { filePath: filePath.value, search: search.value, replace: replace.value },
        },
      };
    }
    case "INSERT": {
      const filePath = requiredAttr(args, "path");
      const anchor = requiredString(args, "anchor");
      const content = requiredString(args, "content");
      const position = requiredAttr(args, "position");
      if (!filePath.ok) return filePath;
      if (!anchor.ok) return anchor;
      if (!content.ok) return content;
      if (!position.ok) return position;
      if (position.value !== "before" && position.value !== "after") {
        return { ok: false, reason: "apply_patch.position must be before or after" };
      }
      const rawBlock =
          `<INSERT position="${position.value}" anchor="${anchor.value}" file="${filePath.value}">` +
          `${content.value}` +
          "</INSERT>";
      return {
        ok: true,
        change: {
          op: "INSERT",
          file: filePath.value,
          raw_block: rawBlock,
          insert: {
            filePath: filePath.value,
            anchor: anchor.value,
            position: position.value,
            content: content.value,
          },
        },
      };
    }
    case "PATCH": {
      const patch = requiredString(args, "patch");
      if (!patch.ok) return patch;
      const parsed = parsePatchTurn(`<PATCH>\n${patch.value}\n</PATCH>`, false);
      if (parsed.kind !== "change") {
        const embedded = parsePatchTurn(patch.value, false);
        if (embedded.kind === "change") {
          return { ok: true, change: embedded.change };
        }
        const reason = parsed.kind === "invalid" ? parsed.reason : `unexpected ${parsed.kind} action`;
        return { ok: false, reason: `apply_patch payload invalid: ${reason}` };
      }
      return { ok: true, change: parsed.change };
    }
  }
}

function resolveProtocolOp(args: Record<string, unknown>): { ok: true; value: ProtocolOp } | { ok: false; reason: string } {
  const explicit =
    stringArg(args, "protocol_op") ??
    stringArg(args, "protocolOp") ??
    stringArg(args, "op") ??
    stringArg(args, "operation") ??
    stringArg(args, "action") ??
    stringArg(args, "type");
  const normalized = normalizeProtocolOp(explicit);
  if (normalized) return { ok: true, value: normalized };

  const inferred = inferProtocolOp(args);
  if (inferred) return { ok: true, value: inferred };

  return { ok: false, reason: "apply_patch.protocol_op must be one of CREATE/PATCH/SEARCH_REPLACE/INSERT/DELETE/RENAME" };
}

function normalizeProtocolOp(value: string | undefined): ProtocolOp | null {
  if (!value) return null;
  const normalized = value.trim().replace(/[\s-]+/g, "_").toUpperCase();
  const aliases: Record<string, ProtocolOp> = {
    CREATE_FILE: "CREATE",
    WRITE: "CREATE",
    ADD: "CREATE",
    MODIFY: "PATCH",
    EDIT: "PATCH",
    UPDATE: "PATCH",
    DIFF: "PATCH",
    UNIFIED_DIFF: "PATCH",
    SEARCH: "SEARCH_REPLACE",
    REPLACE: "SEARCH_REPLACE",
    SEARCHREPLACE: "SEARCH_REPLACE",
    SEARCH_AND_REPLACE: "SEARCH_REPLACE",
    MOVE: "RENAME",
  };
  const op = aliases[normalized] ?? normalized;
  return PROTOCOL_OPS.has(op as ProtocolOp) ? (op as ProtocolOp) : null;
}

function inferProtocolOp(args: Record<string, unknown>): ProtocolOp | null {
  if (hasStringArg(args, "from") && hasStringArg(args, "to")) return "RENAME";
  if (hasStringArg(args, "path") && hasStringArg(args, "search") && hasStringArg(args, "replace")) return "SEARCH_REPLACE";
  if (hasStringArg(args, "path") && hasStringArg(args, "anchor") && hasStringArg(args, "position") && hasStringArg(args, "content")) return "INSERT";
  if (hasStringArg(args, "patch")) return "PATCH";
  if (hasStringArg(args, "path") && hasStringArg(args, "content")) return "CREATE";
  return null;
}

function hasStringArg(args: Record<string, unknown>, key: string): boolean {
  const value = stringArg(args, key);
  return value !== undefined && value.length > 0;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function requiredString(
  args: Record<string, unknown>,
  key: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const value = stringArg(args, key);
  if (value === undefined || value.length === 0) {
    return { ok: false, reason: `apply_patch.${key} is required` };
  }
  return { ok: true, value };
}

function requiredAttr(
  args: Record<string, unknown>,
  key: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const value = requiredString(args, key);
  if (!value.ok) return value;
  if (/["\r\n]/.test(value.value)) {
    return { ok: false, reason: `apply_patch.${key} cannot contain quotes or newlines` };
  }
  return value;
}

const REDACTED_APPLY_PATCH_STRING_KEYS = new Set([
  "content",
  "patch",
  "search",
  "replace",
  "body",
  "text",
  "code",
  "new_content",
  "old_content",
  "newText",
  "oldText",
]);

function redactApplyPatchToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (REDACTED_APPLY_PATCH_STRING_KEYS.has(key) && typeof value === "string") {
      redacted[`${key}_length`] = value.length;
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function redactToolCallArguments(toolCall: DeepSeekToolCall): Record<string, unknown> {
  const raw = toolCall.function.arguments;
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { invalid_arguments_shape: true };
    }
    if (toolCall.function.name === APPLY_PATCH_TOOL_NAME) {
      return redactApplyPatchToolArgs(parsed as Record<string, unknown>);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return { invalid_json: true, raw_length: raw.length };
  }
}

function summarizeInvalidToolCalls(toolCalls: DeepSeekToolCall[], reason: string): PatchRoundRecord["tool_calls"] | undefined {
  if (toolCalls.length === 0) return undefined;
  return toolCalls.map((toolCall) => ({
    name: toolCall.function.name,
    arguments: redactToolCallArguments(toolCall),
    status: "error" as const,
    summary: reason.slice(0, 200),
  }));
}

async function runPatchExplore(args: {
  state: TaskState;
  cwd: string;
  client: DeepSeekClient;
  dryRun: boolean;
  messages: DeepSeekMessage[];
  target: ModelTarget;
  contract: PlanFileContract;
  editsAsNativeTool: boolean;
}): Promise<ExploreResult> {
  const { state, cwd, client, dryRun, messages, target, contract, editsAsNativeTool } = args;
  const toolPolicy = getToolPolicy("patch", { editsAsNativeTool });
  const tools = filterToolsForPolicy(ALL_TOOL_DEFINITIONS, toolPolicy);
  const editOnlyTools = filterToolsForPolicy(ALL_TOOL_DEFINITIONS, {
    phase: "patch",
    allowedTools: editsAsNativeTool ? [APPLY_PATCH_TOOL_NAME] : [],
  });

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
    modelSaidDoneWithMissing: false,
  };
  const appliedChangedFiles: string[] = [];
  let modelSaidDone = false;
  let exitReason: ExploreExitReason = "max_rounds";
  let toolsPauseAnnounced = false;

  while (loop.round < loop.maxRounds) {
    loop.round++;

    const toolsPaused =
      !loop.hasStartedPatching && loop.consecutiveToolsOnly >= MAX_INITIAL_TOOLS_ONLY;
    if (toolsPaused && !toolsPauseAnnounced) {
      messages.push({ role: "user", content: buildToolsPausedWarning(contract, loop, editsAsNativeTool) });
      toolsPauseAnnounced = true;
    }
    const activeTools = toolsPaused && editsAsNativeTool ? editOnlyTools : toolsPaused ? [] : tools;
    const startedAt = Date.now();
    const response = await client.chat({
      model: target.model,
      messages,
      thinking: target.thinking,
      ...(activeTools.length > 0 ? { tools: activeTools as unknown as Record<string, unknown>[] } : {}),
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
    // route Y / Bug A: salvage DSML-wrapped change before parsing.
    // See docs/plans/2026-05-20-dsml-recovery.md.
    const salvage = recoverDsmlWrappedChange(choice.message.content ?? "");
    const content = salvage.content;
    const toolCalls = choice.message.tool_calls;
    const hasToolCalls = (toolCalls?.length ?? 0) > 0;

    const action = selectPatchExploreAction({
      contentAction: parsePatchTurn(content, hasToolCalls),
      toolCalls: toolCalls ?? [],
      toolsPaused,
      editsAsNativeTool,
    });

    const record: PatchRoundRecord = {
      round: loop.round,
      action: action.kind,
      duration_ms: Date.now() - startedAt,
      ...(salvage.recovered ? { dsml_salvage_applied: true } : {}),
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
        source: action.source,
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

      const progressMessage = buildCoverageProgressMessage(
        result.ok,
        result.error,
        action.change.file,
        action.change.op,
        loop,
        editsAsNativeTool ? "apply_patch tool call" : "change block",
      );
      if (action.source === "tool_call" && action.toolCallId) {
        const assistantMsg: DeepSeekMessage = { role: "assistant", content, tool_calls: toolCalls ?? undefined };
        if (choice.message.reasoning_content) assistantMsg.reasoning_content = choice.message.reasoning_content;
        messages.push(assistantMsg);
        messages.push({
          role: "tool",
          tool_call_id: action.toolCallId,
          content: JSON.stringify({
            apply_status: result.ok ? "ok" : "failed",
            files_changed: result.files_changed,
            coverage_delta: [...coverageDelta],
            missing_required_files: [...loop.missingRequiredFiles],
            error: result.error,
          }),
        });
        record.tool_calls = [{
          name: APPLY_PATCH_TOOL_NAME,
          arguments: action.toolCallArgs ?? {},
          status: result.ok ? "success" : "error",
          summary: progressMessage.slice(0, 200),
        }];
      } else {
        messages.push({ role: "user", content: progressMessage });
      }
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
            (editsAsNativeTool
              ? "Produce at least one apply_patch tool call before signalling done."
              : "Produce at least one change block before signalling done."),
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
      record.tool_calls = summarizeInvalidToolCalls(toolCalls ?? [], action.reason);
      loop.invalidStreak++;
      if (loop.hasStartedPatching) loop.roundsSinceCoverageProgress++;
      state.patch_rounds.push(record);
      writeTaskState(cwd, state);
      messages.push({
        role: "user",
        content:
          `Invalid response: ${action.reason}. You must output EXACTLY ONE of: ` +
          (editsAsNativeTool
            ? "exploration tool calls, ONE apply_patch tool call, or <DONE/>. Please try again."
            : "tool calls, ONE change block, or <DONE/>. Please try again."),
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

// A dedicated, no-tools turn that asks the model to cover the still-missing
// required files. The orchestrator injects each missing file's current content
// (truncated) so the model never needs a tool to see it (spec §4.6). The
// finalizer output is always re-checked by the coverage validator — <DONE/>
// here never bypasses it.
async function maybeRunCoverageFinalization(args: {
  state: TaskState;
  cwd: string;
  client: DeepSeekClient;
  dryRun: boolean;
  contract: PlanFileContract;
  explore: ExploreResult;
  contextLayers: ContextLayers;
  target: ModelTarget;
}): Promise<FinalizationResult> {
  const { state, cwd, client, dryRun, contract, explore, contextLayers, target } = args;
  const exploreApplied = explore.appliedChangedFiles;

  if (!shouldEnterCoverageFinalization(explore.loop)) {
    return { appliedChangedFiles: exploreApplied, attempted: false, succeeded: false };
  }

  const missing = [...explore.loop.missingRequiredFiles];
  const covered = [...explore.loop.coveredRequiredFiles];

  const fileBlocks = missing.map((rel) => {
    let body: string;
    try {
      const raw = fs.readFileSync(path.join(cwd, rel), "utf-8");
      body =
        Buffer.byteLength(raw, "utf-8") > MAX_FINALIZE_FILE_BYTES
          ? raw.slice(0, MAX_FINALIZE_FILE_BYTES) + "\n... [truncated]"
          : raw;
    } catch {
      body = "[file does not exist yet — create it with a <CREATE> block]";
    }
    return `<file path="${rel}">\n${body}\n</file>`;
  });

  const finalizeInstructions = [
    "You are in COVERAGE FINALIZATION mode. Tools are disabled — do not request",
    "files, do not call tools, do not explain. Emit only change blocks.",
    "",
    `Original task:\n${state.task.description}`,
    "",
    formatRenameIntentGuidance(state.task.description) ?? "",
    "",
    `Required target files: ${contract.requiredTargetFiles.map((e) => e.path).join(", ") || "(none)"}`,
    `Already covered: ${covered.join(", ") || "(none)"}`,
    `Still MISSING — you must produce a change for each of these: ${missing.join(", ")}`,
    "",
    "Current content of the missing required files:",
    ...fileBlocks,
    "",
    'Emit one change block (CREATE / PATCH / PATCH type="search" / INSERT / DELETE',
    "/ RENAME) for each missing required file. If a missing file genuinely needs",
    "no modification to satisfy the task, output <DONE/> instead. Do not call tools.",
  ].join("\n");

  const startedAt = Date.now();
  const response = await client.chat({
    model: target.model,
    messages: buildMessages({
      context: contextLayers,
      taskDescription: finalizeInstructions,
      phase: "patch",
    }),
    thinking: target.thinking,
    // No tools: finalization is a closed turn — no further exploration.
  });
  recordDeepSeekUsage(state, {
    phase: "patch",
    model: target.model,
    thinking: target.thinking,
    durationMs: Date.now() - startedAt,
    response,
  });

  // route Y / Bug A: salvage DSML-wrapped change in finalization output too.
  const finalizationSalvage = recoverDsmlWrappedChange(
    response.choices[0]?.message.content ?? "",
  );
  const content = finalizationSalvage.content;
  const checkpointId = "dsh-checkpoint-coverage-finalization";
  if (!dryRun) performCheckpoint(cwd, checkpointId, state.managed_files);

  const appliedFinalize: string[] = [];
  let finalizeAction: PatchRoundRecord["action"] = "invalid";
  let invalidReason: string | undefined;
  try {
    const changes = parseChanges(content);
    const applyResult = applyChanges(cwd, changes, dryRun);
    appliedFinalize.push(
      ...applyResult.createdFiles,
      ...applyResult.renamedFiles,
      ...applyResult.patchedFiles,
      ...applyResult.deletedFiles,
    );
    if (appliedFinalize.length > 0) {
      finalizeAction = "change";
    } else {
      invalidReason = "coverage_finalization_apply_failed";
    }
  } catch {
    // parseChanges throws when no change blocks are present — either a <DONE/>
    // (the model declined) or unusable output.
    if (/<DONE\s*\/?>/i.test(content)) {
      finalizeAction = "done";
    } else {
      invalidReason = "coverage_finalization_unparseable_output";
    }
  }

  if (appliedFinalize.length > 0) {
    const managed = new Set(state.managed_files);
    for (const f of appliedFinalize) managed.add(f);
    state.managed_files = [...managed];
  }

  state.patch_rounds.push({
    round: explore.loop.round + 1,
    action: finalizeAction,
    duration_ms: Date.now() - startedAt,
    ...(invalidReason ? { invalid_reason: invalidReason } : {}),
    ...(finalizationSalvage.recovered ? { dsml_salvage_applied: true } : {}),
  });
  writeTaskState(cwd, state);

  const appliedChangedFiles = [...exploreApplied, ...appliedFinalize];
  const validation = validatePatchCoverage({ contract, appliedChangedFiles });
  return {
    appliedChangedFiles,
    ...(appliedFinalize.length > 0 ? { patchText: content } : {}),
    attempted: true,
    succeeded: validation.fullRequiredCoverage,
  };
}

// ---- patch_validate + decide ----

function decidePatchResult(args: {
  state: TaskState;
  cwd: string;
  contract: PlanFileContract;
  finalization: FinalizationResult;
  strictGateEnabled: boolean;
}): { state: TaskState; validation: PatchCoverageValidation; decision: PatchDecision } {
  let state = args.state;
  const { contract, finalization } = args;

  const validation = validatePatchCoverage({
    contract,
    appliedChangedFiles: finalization.appliedChangedFiles,
  });

  const dedupedFiles = [...new Set(finalization.appliedChangedFiles.map(normalizePath))];
  const failedChangeRounds = state.patch_rounds.filter(
    (r) => r.action === "change" && r.change?.apply_status === "failed",
  );
  // A patch "has ok changes" when at least one file was actually applied —
  // across explore AND finalization. Finalization rounds are multi-file and do
  // not carry a per-round `change` record, so this is derived from the files.
  const hasOkChanges = dedupedFiles.length > 0;

  const decision = decidePatchStatus({
    hasOkChanges,
    fullRequiredCoverage: validation.fullRequiredCoverage,
    missingRequiredFiles: validation.missingRequiredFiles,
    strictFailureEligible: validation.strictFailureEligible,
    strictGateEnabled: args.strictGateEnabled,
    coverageFinalizationAttempted: finalization.attempted,
  });

  const patchText =
    [
      state.patch_rounds
      .filter((r) => r.action === "change" && r.change)
      .map((r) => r.change!.raw_block)
        .join("\n\n"),
      finalization.patchText ?? "",
    ]
      .filter((text) => text.trim().length > 0)
      .join("\n\n") || "<empty>";

  let applyStatus: "ok" | "partial_ok" | "failed";
  if (hasOkChanges && failedChangeRounds.length === 0) applyStatus = "ok";
  else if (hasOkChanges) applyStatus = "partial_ok";
  else applyStatus = "failed";

  const newPatch: PatchRecord = {
    round: (state.repair_rounds ?? 0) + 1,
    phase: "patch",
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
  return { state, validation, decision };
}

// ---- Telemetry ----

export interface PatchCoverageTelemetry {
  planFileContractVersion: "legacy" | "v2";
  requiredTargetCount: number;
  optionalTargetCount: number;
  contextFileCount: number;
  coveredRequiredCount: number;
  missingRequiredCount: number;
  missingRequiredFiles: string[];
  coverageFinalizationTriggered: boolean;
  coverageFinalizationSucceeded: boolean;
  doneWithMissingRequiredFiles: boolean;
  patchResultStatus: PatchDecision["status"];
  repairTriggered: boolean;
  totalPatchRounds: number;
  totalToolCalls: number;
  strictFailureEligible: boolean;
  strictFailureApplied: boolean;
}

function buildPatchCoverageTelemetry(input: {
  contract: PlanFileContract;
  explore: ExploreResult;
  finalization: FinalizationResult;
  validation: PatchCoverageValidation;
  decision: PatchDecision;
  totalPatchRounds: number;
  totalToolCalls: number;
}): PatchCoverageTelemetry {
  const { contract, explore, finalization, validation, decision } = input;
  return {
    planFileContractVersion: contract.version,
    requiredTargetCount: contract.requiredTargetFiles.length,
    optionalTargetCount: contract.optionalTargetFiles.length,
    contextFileCount: contract.contextFiles.length,
    coveredRequiredCount: validation.coveredRequiredFiles.length,
    missingRequiredCount: validation.missingRequiredFiles.length,
    missingRequiredFiles: validation.missingRequiredFiles,
    coverageFinalizationTriggered: finalization.attempted,
    coverageFinalizationSucceeded: finalization.succeeded,
    doneWithMissingRequiredFiles: explore.loop.modelSaidDoneWithMissing,
    patchResultStatus: decision.status,
    repairTriggered: decision.status !== "patched",
    totalPatchRounds: input.totalPatchRounds,
    totalToolCalls: input.totalToolCalls,
    strictFailureEligible: validation.strictFailureEligible,
    strictFailureApplied:
      decision.status === "patch_failed" &&
      decision.reason.startsWith("strict_required_coverage_gate"),
  };
}

// Best-effort: telemetry must never fail the patch stage. Only paths, counts,
// statuses and reasons are recorded — never file contents or diffs (spec §4.10).
function writePatchCoverageTelemetry(cwd: string, telemetry: PatchCoverageTelemetry): void {
  try {
    fs.writeFileSync(
      path.join(cwd, ".dsh", "patch-coverage-telemetry.json"),
      JSON.stringify(telemetry, null, 2),
    );
  } catch {
    // ignore — observability only
  }
}

// ---- Orchestrator ----

export async function runPatchPipeline(args: {
  state: TaskState;
  cwd: string;
  client: DeepSeekClient;
  dryRun: boolean;
  messages: DeepSeekMessage[];
  target: ModelTarget;
  contextLayers: ContextLayers;
}): Promise<TaskState> {
  const flags = resolvePatchFlags(args.cwd);
  const contract = buildPlanFileContract(args.state.plan);

  const explore = await runPatchExplore({
    state: args.state,
    cwd: args.cwd,
    client: args.client,
    dryRun: args.dryRun,
    messages: args.messages,
    target: args.target,
    contract,
    editsAsNativeTool: flags.editsAsNativeTool,
  });

  const finalization: FinalizationResult = flags.coverageFinalization
    ? await maybeRunCoverageFinalization({
        state: args.state,
        cwd: args.cwd,
        client: args.client,
        dryRun: args.dryRun,
        contract,
        explore,
        contextLayers: args.contextLayers,
        target: args.target,
      })
    : { appliedChangedFiles: explore.appliedChangedFiles, attempted: false, succeeded: false };

  const { state, validation, decision } = decidePatchResult({
    state: args.state,
    cwd: args.cwd,
    contract,
    finalization,
    strictGateEnabled: flags.strictRequiredCoverage,
  });

  const totalToolCalls = state.patch_rounds.reduce(
    (sum, round) => sum + (round.tool_calls?.length ?? 0),
    0,
  );
  writePatchCoverageTelemetry(
    args.cwd,
    buildPatchCoverageTelemetry({
      contract,
      explore,
      finalization,
      validation,
      decision,
      totalPatchRounds: state.patch_rounds.length,
      totalToolCalls,
    }),
  );

  return state;
}
