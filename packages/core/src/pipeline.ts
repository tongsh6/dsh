import { loadDshConfig } from "@dsh/repo";
import type { DeepSeekClient, DeepSeekMessage } from "@dsh/provider";
import { classify } from "@dsh/provider";
import type { ContextLayers } from "./context-builder.js";
import { assembleContext, buildDynamicContext } from "./context-builder.js";
import { buildMessages } from "./prompt-builder.js";
import {
  extractPlanBlock,
  extractFilesBlock,
  extractRisksBlock,
  extractVerifyBlock,
  parsePatchTurn,
  applyCreates,
  applyDeletes,
  applyRenames,
  applySearchReplace,
  applyInserts,
  applyPatch,
} from "./patch-parser.js";
import type { ChangeBlock } from "./patch-parser.js";
import { runVerifyAssertions, isAllPassed, parseAssertion } from "./verifier.js";
import type { VerifyAssertion } from "./verifier.js";
import { runRepairLoop } from "./repair-loop.js";
import type { RepairRoundResult } from "./repair-loop.js";
import {
  repairStaticScanTopN,
  resolveStaticScanConfig,
  runStaticScan,
} from "./static-scanner.js";
import {
  createTaskState,
  readTaskState,
  writeTaskState,
  transition,
} from "./task-state.js";
import type { TaskState, PatchRoundRecord, PatchRecord } from "./task-state.js";
import { writeHandoff } from "./handoff-writer.js";
import {
  loadRuleContents,
  detectTechStack,
  generateRepoContext,
  rankFiles,
  loadTopFiles,
  scanProjectFiles,
} from "@dsh/repo";
import { ALL_TOOL_DEFINITIONS } from "./tool-definitions.js";
import { executeTool, formatToolResult } from "./tool-executor.js";
import type { ToolName } from "./tool-definitions.js";

// ---- Helpers ----

const MAX_PATCH_ROUNDS = 30;
const MAX_CONSECUTIVE_INVALID = 3;
const MAX_CONSECUTIVE_TOOLS_ONLY = 5;

interface VerifySlotSelection {
  test?: boolean;
  lint?: boolean;
  typecheck?: boolean;
}

// Returns plan files that are NOT covered by the actual changed-files set.
// Uses endsWith fuzzy matching so absolute-vs-relative path differences
// don't false-positive (mirrors the original inline matcher in runVerify).
export function computeUncoveredPlanFiles(
  planFiles: string[],
  changedFiles: string[],
): string[] {
  return planFiles.filter(
    (planF) => !changedFiles.some(
      (actF) => actF === planF || actF.endsWith(planF) || planF.endsWith(actF),
    ),
  );
}

// `verify.commands` (a list, executed independently) takes precedence over the
// legacy `test/lint/typecheck` slots so a fixture / config can express N
// verification steps without `&&`-chaining them into one shell command.
export function resolveVerifyCommands(
  verifyConfig: Record<string, unknown> | undefined,
  selection: VerifySlotSelection,
): string[] {
  if (!verifyConfig) return [];

  const commandsField = verifyConfig["commands"];
  if (Array.isArray(commandsField)) {
    const list = commandsField
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (list.length > 0) return list;
  }

  const slots: string[] = [];
  const { test, lint, typecheck } = selection;
  const anySelected = Boolean(test || lint || typecheck);
  const pickAll = !anySelected;

  const get = (key: "test" | "lint" | "typecheck"): string => {
    const v = verifyConfig[key];
    return typeof v === "string" ? v : "";
  };

  if (pickAll || test) slots.push(get("test"));
  if (pickAll || lint) slots.push(get("lint"));
  if (pickAll || typecheck) slots.push(get("typecheck"));

  return slots.map((c) => c.trim()).filter((c) => c.length > 0);
}

// Resolve config into a VerifyAssertion list (spec
// 2026-05-08-verify-protocol-structured §3.3). Precedence:
//   1. verify.assertions[] (parsed; invalid entries silently dropped)
//   2. verify.commands[]   (each wrapped as { type: "shell", command })
//   3. verify.test/lint/typecheck (each non-empty wrapped as shell)
// Returns [] if nothing resolves.
export function resolveVerifyAssertions(
  verifyConfig: Record<string, unknown> | undefined,
  selection: VerifySlotSelection,
): VerifyAssertion[] {
  if (!verifyConfig) return [];

  const assertionsField = verifyConfig["assertions"];
  if (Array.isArray(assertionsField) && assertionsField.length > 0) {
    const parsed = assertionsField
      .map((raw) => parseAssertion(raw))
      .filter((a): a is VerifyAssertion => a !== null);
    if (parsed.length > 0) return parsed;
  }

  return resolveVerifyCommands(verifyConfig, selection).map(
    (command) => ({ type: "shell" as const, command }),
  );
}

function _totalCharCount(messages: DeepSeekMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (m.content) chars += m.content.length;
    if (m.reasoning_content) chars += m.reasoning_content.length;
  }
  return chars;
}

function applySingleChange(
  cwd: string,
  change: ChangeBlock,
  dryRun: boolean,
): { ok: boolean; files_changed: string[]; error?: string } {
  switch (change.op) {
    case "CREATE": {
      if (!change.create) return { ok: false, files_changed: [], error: "missing create payload" };
      const r = applyCreates(cwd, [change.create], dryRun);
      return { ok: r.success, files_changed: r.files, error: r.error };
    }
    case "DELETE": {
      const r = applyDeletes(cwd, [change.file], dryRun);
      return { ok: r.success, files_changed: r.files, error: r.error };
    }
    case "RENAME": {
      if (!change.rename) return { ok: false, files_changed: [], error: "missing rename payload" };
      const r = applyRenames(cwd, [change.rename], dryRun);
      return { ok: r.success, files_changed: r.files, error: r.error };
    }
    case "SEARCH_REPLACE": {
      if (!change.searchReplace) return { ok: false, files_changed: [], error: "missing search_replace payload" };
      const r = applySearchReplace(cwd, [change.searchReplace], dryRun);
      return { ok: r.success, files_changed: r.files, error: r.error };
    }
    case "INSERT": {
      if (!change.insert) return { ok: false, files_changed: [], error: "missing insert payload" };
      const r = applyInserts(cwd, [change.insert], dryRun);
      return { ok: r.success, files_changed: r.files, error: r.error };
    }
    case "PATCH": {
      if (!change.patchText) return { ok: false, files_changed: [], error: "missing patch text" };
      const r = applyPatch(cwd, change.patchText, dryRun);
      return { ok: r.success, files_changed: r.files, error: r.error };
    }
    default:
      return { ok: false, files_changed: [], error: `unknown op: ${change.op}` };
  }
}

// ---- Types ----

export interface PipelineBase {
  cwd: string;
  client: DeepSeekClient;
}

export interface PlanParams extends PipelineBase {
  description: string;
  taskType: "bugfix" | "feature" | "refactor" | "test" | "docs";
}

export interface PatchParams extends PipelineBase {
  auto?: boolean;
  dryRun?: boolean;
}

export interface VerifyParams {
  cwd: string;
  test?: boolean;
  lint?: boolean;
  typecheck?: boolean;
}

export interface RepairParams extends PipelineBase {
  maxRounds?: number;
  onRound?: (round: number, result: RepairRoundResult) => void;
}

// NOTE: HandoffParams does NOT extend PipelineBase because handoff doesn't need a client
export interface HandoffParams {
  cwd: string;
  format?: "markdown" | "json";
  outputDir?: string;
}

export interface FullPipelineParams extends PipelineBase {
  description: string;
  taskType: "bugfix" | "feature" | "refactor" | "test" | "docs";
  auto?: boolean;
  maxRepairRounds?: number;
}

// ---- Internal helpers ----

async function buildLayers(cwd: string, description: string, taskType: string): Promise<ContextLayers> {
  const config = loadDshConfig(cwd);
  const rules = loadRuleContents(cwd);
  const stack = detectTechStack(cwd);
  const repoContext = generateRepoContext(cwd, stack);

  const state = createTaskState(description, taskType as TaskState["task"]["type"]);
  const allFiles = await scanProjectFiles(cwd);
  const ranked = rankFiles(description, allFiles);
  const taskFiles = loadTopFiles(cwd, ranked, 10);

  return assembleContext({ config, rules, repoContext, taskState: state, taskFiles });
}

async function runPostImplementationStaticScan(params: {
  cwd: string;
  client: DeepSeekClient;
  state: TaskState;
  changedFiles: string[];
}): Promise<TaskState> {
  const { cwd, client, changedFiles } = params;
  const { state } = params;
  const scanConfig = resolveStaticScanConfig(loadDshConfig(cwd));

  if (!scanConfig.enabled || !scanConfig.command) {
    return state;
  }

  const scanRound = (state.static_scan_runs?.length ?? 0) + 1;
  const scan = runStaticScan(
    cwd,
    scanConfig.command,
    scanRound,
    changedFiles,
    scanConfig.topNConfig,
  );
  state.static_scan_runs.push(scan.run);
  writeTaskState(cwd, state);

  if (scan.run.status === "passed" || scan.run.selected_top_n.length === 0) {
    return state;
  }

  const repair = await repairStaticScanTopN({
    cwd,
    client,
    state,
    scanRun: scan.run,
    selectedFindings: scan.run.selected_top_n,
    command: scanConfig.command,
    topNConfig: scanConfig.topNConfig,
  });

  state.static_repair_results.push(repair.repair);
  if (repair.patchRecord) {
    state.patches.push(repair.patchRecord);
  }
  if (repair.postScan) {
    state.static_scan_runs.push(repair.postScan.run);
  }
  writeTaskState(cwd, state);

  return state;
}

// ---- runPlan ----

export async function runPlan(params: PlanParams): Promise<TaskState> {
  const { cwd, client, description, taskType } = params;

  let state = readTaskState(cwd);
  if (!state || state.task.description !== description) {
    state = createTaskState(description, taskType);
    writeTaskState(cwd, state);
  }

  const layers = await buildLayers(cwd, description, taskType);
  const target = classify({ command: "plan" });

  const messages = buildMessages({ context: layers, taskDescription: description, phase: "plan" });
  const response = await client.chat({
    model: target.model,
    messages,
    thinking: target.thinking,
  });

  const content = response.choices[0]?.message.content ?? "";
  const planRaw = extractPlanBlock(content);
  const files = extractFilesBlock(content);
  const risks = extractRisksBlock(content);
  const verifyCommands = extractVerifyBlock(content);

  if (!planRaw) {
    // Fallback: use entire response as plan if no <PLAN> block found
    const trimmed = content.trim();
    if (trimmed.length > 50) {
      state.plan = {
        summary: trimmed.split("\n")[0]?.replace(/^#+\s*/, "") ?? description,
        files,
        risks,
        raw_xml: trimmed,
        verify_commands: verifyCommands.length > 0 ? verifyCommands : undefined,
      };
      state = transition(state, "planned");
      writeTaskState(cwd, state);
      return state;
    }
    throw new Error("DeepSeek 未返回有效的 PLAN 块");
  }

  state.plan = {
    summary: planRaw.split("\n")[0]?.replace(/^#+\s*/, "") ?? description,
    files,
    risks,
    raw_xml: planRaw,
    verify_commands: verifyCommands.length > 0 ? verifyCommands : undefined,
  };
  state = transition(state, "planned");
  writeTaskState(cwd, state);

  return state;
}

// ---- runPatch ----

export async function runPatch(params: PatchParams): Promise<TaskState> {
  const { cwd, client, dryRun } = params;

  let state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");
  if (state.status !== "planned" && state.status !== "repairing") {
    throw new Error(`当前状态为 ${state.status}，需要 planned 或 repairing`);
  }

  const layers = await buildLayers(cwd, state.task.description, state.task.type);
  const dynamic = buildDynamicContext(state.patches, state.verify_results, 2);
  const fullLayers = { ...layers, dynamic };

  const fileCount = state.plan?.files?.length ?? 0;
  const target = classify({ command: "patch", fileCount });

  const messages: DeepSeekMessage[] = buildMessages({
    context: fullLayers,
    taskDescription: state.task.description,
    phase: "patch",
  });

  // ---- Patch Loop Main ----

  const allChangedFiles: string[] = [];
  let consecutiveInvalid = 0;
  let consecutiveToolsOnly = 0;
  let hasProducedChange = false;
  let round = 0;

  while (round < MAX_PATCH_ROUNDS) {
    round++;

    const response = await client.chat({
      model: target.model,
      messages,
      thinking: target.thinking,
      tools: ALL_TOOL_DEFINITIONS as unknown as Record<string, unknown>[],
    });

    const choice = response.choices[0];
    if (!choice) throw new Error("DeepSeek API 返回空响应");

    const content = choice.message.content ?? "";
    const toolCalls = choice.message.tool_calls;
    const hasToolCalls = (toolCalls?.length ?? 0) > 0;

    // If model returned tool_calls but content also parses as invalid,
    // prioritize tool execution (spec note: avoid spurious invalid counts)
    let action = parsePatchTurn(content, hasToolCalls);
    if (action.kind === "invalid" && hasToolCalls) {
      action = { kind: "tools" };
    }

    const record: PatchRoundRecord = {
      round,
      action: action.kind,
      duration_ms: 0,
    };

    switch (action.kind) {
      case "tools": {
        // Execute tool calls, push results back
        const callRecords: PatchRoundRecord["tool_calls"] = [];
        const assistantMsg: DeepSeekMessage = {
          role: "assistant",
          content,
          tool_calls: toolCalls ?? undefined,
        };
        if (choice.message.reasoning_content) {
          assistantMsg.reasoning_content = choice.message.reasoning_content;
        }
        messages.push(assistantMsg);

        for (const tc of toolCalls ?? []) {
          let rawArgs: Record<string, unknown> = {};
          try { rawArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* keep empty */ }
          const args: Record<string, string> = {};
          for (const [k, v] of Object.entries(rawArgs)) {
            args[k] = typeof v === "string" ? v : JSON.stringify(v);
          }
          const result = executeTool(tc.function.name as ToolName, args, cwd, tc.id);
          const formatted = formatToolResult(tc.function.name as ToolName, args, result);
          messages.push({ role: "tool", content: formatted, tool_call_id: tc.id });
          callRecords.push({
            name: tc.function.name,
            arguments: args,
            status: result.status,
            summary: result.status === "success" ? result.content.slice(0, 200) : (result.error ?? "").slice(0, 200),
          });
        }
        record.tool_calls = callRecords;
        consecutiveInvalid = 0;
        if (hasProducedChange) consecutiveToolsOnly++;
        break;
      }

      case "change": {
        consecutiveToolsOnly = 0;
        hasProducedChange = true;
        if (choice.message.reasoning_content) {
          record.reasoning_excerpt = choice.message.reasoning_content.slice(0, 500);
        }
        const result = applySingleChange(cwd, action.change, !!dryRun);
        record.change = {
          op: action.change.op,
          file: action.change.file,
          apply_status: result.ok ? "ok" : "failed",
          apply_error: result.error,
          raw_block: action.change.raw_block,
        };
        if (result.ok && result.files_changed.length > 0) {
          allChangedFiles.push(...result.files_changed);
        }
        // Build progress-aware feedback message
        const planFiles = state.plan?.files ?? [];
        const deduped = [...new Set(allChangedFiles)];
        const covered = planFiles.filter((f) =>
          deduped.some((pf) => pf === f || pf.endsWith("/" + f)),
        );
        const uncovered = planFiles.filter((f) => !covered.includes(f));
        const baseMsg = result.ok
          ? `✓ change applied: ${action.change.file} (op=${action.change.op})`
          : `✗ change failed: ${result.error ?? "unknown error"}`;
        const progressMsg =
          planFiles.length > 0 && result.ok
            ? uncovered.length > 0
              ? `${baseMsg}\n进度: plan.files 覆盖 ${covered.length}/${planFiles.length} (剩余: ${uncovered.join(", ")})`
              : `${baseMsg}\n进度: plan.files 已全部覆盖，可输出 <DONE/>`
            : baseMsg;
        messages.push({ role: "user", content: progressMsg });
        consecutiveInvalid = 0;
        break;
      }

      case "done": {
        const planFiles = state.plan?.files ?? [];
        const dedupedSoFar = [...new Set(allChangedFiles)];
        const uncovered = computeUncoveredPlanFiles(planFiles, dedupedSoFar);

        if (uncovered.length === 0) {
          record.reasoning_excerpt = choice.message.reasoning_content?.slice(0, 500);
          state.patch_rounds.push(record);
          writeTaskState(cwd, state);
          round = MAX_PATCH_ROUNDS; // exit loop cleanly
        } else if (dedupedSoFar.length === 0) {
          // Model hasn't produced any changes yet — reject DONE and ask for
          // at least one change before we can let verify judge.
          record.action = "invalid";
          record.invalid_reason = "done_with_no_changes";
          state.patch_rounds.push(record);
          writeTaskState(cwd, state);
          consecutiveInvalid++;
          messages.push({
            role: "user",
            content:
              `<DONE/> rejected: no changes have been applied yet. ` +
              `Produce at least one change block before signalling done.`,
          });
        } else {
          // Model has made changes but some plan.files remain uncovered.
          // Accept DONE — let verify provide the real signal. The uncovered
          // list is recorded so repair knows what was missed.
          // (Previously this was a hard reject, which punished models that
          // listed extra files in plan and caused MAX_CONSECUTIVE_INVALID
          // cutoffs — see docs/reports/260509-040502 for evidence.)
          record.reasoning_excerpt = choice.message.reasoning_content?.slice(0, 500);
          record.incomplete_note = `accepted with uncovered plan files: [${uncovered.join(", ")}]`;
          state.patch_rounds.push(record);
          writeTaskState(cwd, state);
          messages.push({
            role: "user",
            content:
              `<DONE/> accepted. Note: plan.files 中以下文件未被修改: [${uncovered.join(", ")}]. ` +
              `已修改文件: [${dedupedSoFar.join(", ")}]. 现在进入验证阶段。`,
          });
          round = MAX_PATCH_ROUNDS; // exit loop and proceed to verify
        }
        break;
      }

      case "invalid": {
        record.invalid_reason = action.reason;
        consecutiveInvalid++;
        messages.push({
          role: "user",
          content: `Invalid response: ${action.reason}. You must output EXACTLY ONE of: tool calls, ONE change block, or <DONE/>. Please try again.`,
        });
        break;
      }
    }

    if (action.kind !== "done") {
      state.patch_rounds.push(record);
      writeTaskState(cwd, state);
    }

    // Guard: consecutive invalid threshold
    if (consecutiveInvalid >= MAX_CONSECUTIVE_INVALID) {
      break;
    }

    // Guard: continuous tools after first change (model needs to explore
    // before producing the first change; guard kicks in only after that)
    if (hasProducedChange && consecutiveToolsOnly >= MAX_CONSECUTIVE_TOOLS_ONLY) {
      break;
    }
  }

  // ---- Aggregate PatchRecord for backward compat ----

  const okChanges = state.patch_rounds.filter(
    (r) => r.action === "change" && r.change?.apply_status === "ok",
  );
  const failedChanges = state.patch_rounds.filter(
    (r) => r.action === "change" && r.change?.apply_status === "failed",
  );
  const allOk = okChanges.length > 0 && failedChanges.length === 0;
  const partialOk = okChanges.length > 0 && failedChanges.length > 0;
  const _allFailed = okChanges.length === 0;

  const dedupedFiles = [...new Set(allChangedFiles)];

  const patchText = state.patch_rounds
    .filter((r) => r.action === "change" && r.change)
    .map((r) => r.change!.raw_block)
    .join("\n\n") || "<empty>";

  let applyStatus: "ok" | "partial_ok" | "failed";
  if (allOk) applyStatus = "ok";
  else if (partialOk || (okChanges.length > 0)) applyStatus = "partial_ok";
  else applyStatus = "failed";

  // ---- Scope completeness: plan.files must all be covered ----
  // (spec §3.3) When ≥1 change applied successfully but plan.files were not
  // fully covered, treat patch as incomplete and route to repair with the
  // structured "missing files" signal in patch_incomplete_reason.
  const planFilesForPatch = state.plan?.files ?? [];
  const uncoveredAfterPatch = computeUncoveredPlanFiles(planFilesForPatch, dedupedFiles);

  const newPatch: PatchRecord = {
    round: (state.repair_rounds ?? 0) + 1,
    patch: patchText,
    apply_status: applyStatus,
    files_changed: dedupedFiles,
  };
  if (okChanges.length > 0 && uncoveredAfterPatch.length > 0) {
    newPatch.patch_incomplete_reason = `uncovered plan files: ${uncoveredAfterPatch.join(", ")}`;
  }
  state.patches.push(newPatch);

  // ---- State transition ----
  //
  // When okChanges > 0 but plan.files are not fully covered, we now route to
  // "patched" (not "patch_failed"). This lets verify produce diagnostic signals
  // that repair can use. Previously, "patch_failed" skipped verify entirely,
  // leaving repair blind. The patch_incomplete_reason on the patch record
  // carries the uncovered file list forward for repair's completion mode.
  // Evidence: docs/reports/260509-040502 (pi-refactor-read-text: 3/3 files
  // changed but DONE rejected → verify skipped → repair blind).

  if (okChanges.length === 0) {
    state = transition(state, "patch_failed");
  } else if (uncoveredAfterPatch.length > 0) {
    state = transition(state, "patched");
  } else {
    state = transition(state, "patched");
  }
  writeTaskState(cwd, state);

  if (!dryRun && okChanges.length > 0) {
    state = await runPostImplementationStaticScan({ cwd, client, state, changedFiles: dedupedFiles });
  }

  return state;
}

// ---- runVerify ----

export async function runVerify(params: VerifyParams): Promise<TaskState> {
  const { cwd, test, lint, typecheck } = params;

  let state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");
  if (state.status !== "patched" && state.status !== "repairing" && state.status !== "patch_failed") {
    throw new Error(`当前状态为 ${state.status}，需要 patched、repairing 或 patch_failed`);
  }

  // patch_failed: no changes to verify, route directly to repair
  if (state.status === "patch_failed") {
    state = transition(state, "verification_failed");
    writeTaskState(cwd, state);
    return state;
  }

  // Scope-completeness check: plan.files not fully covered by patches.
  // DONE acceptance (in runPatch) already allows partial coverage through;
  // we no longer fail verification here — the real verify commands (test,
  // lint, assertions) are the authoritative signal. We record the uncovered
  // list as a non-failing diagnostic so repair can use it.
  const planFiles = state.plan?.files ?? [];
  const lastPatch = state.patches.at(-1);
  const patchedFiles = lastPatch?.files_changed ?? [];
  const uncovered = computeUncoveredPlanFiles(planFiles, patchedFiles);
  if (uncovered.length > 0 && lastPatch) {
    state.verify_results.push({
      round: (state.verify_results?.length ?? 0) + 1,
      results: [{
        command: "scope-completeness",
        status: "passed",
        exit_code: 0,
        output: `Note: plan.files 未全覆盖 — 未修改: [${uncovered.join(", ")}]. 已修改: [${patchedFiles.join(", ")}].`,
        duration_ms: 0,
      }],
    });
  }

  const config = loadDshConfig(cwd);
  const assertions = resolveVerifyAssertions(config.verify, { test, lint, typecheck });
  if (assertions.length === 0) {
    throw new Error("没有配置验证命令。请检查 .dsh/config.yml");
  }

  const results = runVerifyAssertions(assertions, cwd);
  const round = (state.verify_results?.length ?? 0) + 1;
  state.verify_results.push({ round, results });

  state = transition(state, isAllPassed(results) ? "verified" : "verification_failed");
  writeTaskState(cwd, state);

  return state;
}

// ---- runRepair ----

export async function runRepair(params: RepairParams): Promise<TaskState> {
  const { cwd, client, maxRounds = 3, onRound } = params;

  const state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");
  if (state.status !== "verification_failed" && state.status !== "patch_failed") {
    throw new Error(`当前状态为 ${state.status}，需要 verification_failed 或 patch_failed`);
  }

  const layers = await buildLayers(cwd, state.task.description, state.task.type);

  const config = loadDshConfig(cwd);
  if (config.verify && state.plan) {
    const assertions = resolveVerifyAssertions(config.verify, { test: true, lint: true, typecheck: true });
    // Keep verify_commands populated (as shell-only subset) for any consumer
    // that doesn't know about verify_assertions yet.
    const shellCommands = assertions
      .filter((a): a is { type: "shell"; command: string; name?: string; timeout_ms?: number } => a.type === "shell")
      .map((a) => a.command);
    state.plan = {
      ...state.plan,
      verify_commands: shellCommands,
      verify_assertions: assertions,
    };
  }

  let finalState = await runRepairLoop(state, {
    client,
    cwd,
    maxRounds,
    contextLayers: layers,
    onRound,
  });

  const lastPatch = finalState.patches.at(-1);
  if (lastPatch?.apply_status === "ok" && lastPatch.files_changed.length > 0) {
    finalState = await runPostImplementationStaticScan({
      cwd,
      client,
      state: finalState,
      changedFiles: lastPatch.files_changed,
    });
  }

  return finalState;
}

// ---- runHandoff ----

export async function runHandoff(params: HandoffParams): Promise<string> {
  const { cwd, format = "markdown", outputDir } = params;

  const state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");

  const filePath = writeHandoff(state, cwd, format, outputDir);
  return filePath;
}

// ---- runFullPipeline ----

export async function runFullPipeline(params: FullPipelineParams): Promise<TaskState> {
  const { cwd, client, description, taskType, auto = true, maxRepairRounds = 3 } = params;

  await runPlan({ cwd, client, description, taskType });
  let state = await runPatch({ cwd, client, auto });

  if (state.status === "patched") {
    try {
      state = await runVerify({ cwd });
    } catch (e) {
      if (e instanceof Error && e.message.includes("没有配置验证命令")) {
        return state;
      }
      throw e;
    }
  }

  if (state.status === "verification_failed" || state.status === "patch_failed") {
    state = await runRepair({ cwd, client, maxRounds: maxRepairRounds });
  }

  await runHandoff({ cwd });

  return state;
}
