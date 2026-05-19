import { createHash } from "node:crypto";
import { loadDshConfig } from "@dsh/repo";
import type { DeepSeekClient, DeepSeekMessage, DeepSeekResponse } from "@dsh/provider";
import type { ModelRoutingConfig } from "@dsh/provider";
import { classify } from "@dsh/provider";
import type { ContextLayers } from "./context-builder.js";
import { assembleContext, buildDynamicContext } from "./context-builder.js";
import { buildMessages } from "./prompt-builder.js";
import {
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
import type { PlanContractAttempt } from "./task-state.js";
import {
  PLAN_CONTRACT_TEMPLATE,
  validatePlanContract,
} from "./plan-contract.js";
import type {
  PlanContractFailureReason,
  PlanContractValidationResult,
} from "./plan-contract.js";
import { writeHandoff } from "./handoff-writer.js";
import {
  loadRuleContents,
  assembleIntelligence,
  generateRepoContext,
  rankFiles,
  loadTopFiles,
  scanProjectFiles,
  isGitRepo,
  createCheckpoint,
  applyRollback,
  cleanupCheckpoints,
  createFileCheckpoint,
  applyFileRollback,
  cleanupFileCheckpoints,
} from "@dsh/repo";
import { ALL_TOOL_DEFINITIONS } from "./tool-definitions.js";
import {
  executeToolCallsForPolicy,
  filterToolsForPolicy,
  getToolPolicy,
} from "./agent-turn-loop.js";
import { recordDeepSeekUsage } from "./deepseek-usage.js";
import { runPatchPipeline, isPatchStateMachineV2Enabled } from "./patch-pipeline.js";

// ---- Helpers ----

const MAX_PATCH_ROUNDS = 30;
const MAX_PLAN_TOOL_ROUNDS = 5;
const MAX_CONSECUTIVE_INVALID = 3;
const MAX_CONSECUTIVE_TOOLS_ONLY = 10;
const TOOLS_ONLY_STALL_WARNING = 3;

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

export function resolvePreflightAssertions(
  verifyConfig: Record<string, unknown> | undefined,
): VerifyAssertion[] {
  if (!verifyConfig) return [];

  const assertionsField = verifyConfig["preflight_assertions"];
  if (Array.isArray(assertionsField) && assertionsField.length > 0) {
    const parsed = assertionsField
      .map((raw) => parseAssertion(raw))
      .filter((a): a is VerifyAssertion => a !== null);
    if (parsed.length > 0) return parsed;
  }

  const commandsField = verifyConfig["preflight_commands"];
  if (!Array.isArray(commandsField)) return [];

  return commandsField
    .filter((command): command is string => typeof command === "string")
    .map((command) => command.trim())
    .filter((command) => command.length > 0)
    .map((command) => ({ type: "shell" as const, command }));
}

function buildPatchLoopStallWarning(state: TaskState, changedFiles: string[]): string {
  const planFiles = state.plan?.files ?? [];
  const uncovered = computeUncoveredPlanFiles(planFiles, [...new Set(changedFiles)]);
  const target = uncovered[0] ?? planFiles[0] ?? "the next planned file";

  return [
    "## SYSTEM WARNING",
    `You have already produced a change, then spent ${TOOLS_ONLY_STALL_WARNING} consecutive turns using tools.`,
    "Stop using tools now. The next response MUST be exactly one change block, not tool calls.",
    `Target the remaining planned file: ${target}`,
    "Use <CREATE> for a new file, or <PATCH>/<PATCH type=\"search\"> for an existing file.",
    "Do not use exec_shell to create directories or write files.",
  ].join("\n");
}

function buildInitialPatchLoopStallWarning(state: TaskState): string {
  const planFiles = state.plan?.files ?? [];
  const target = planFiles[0] ?? "the first planned file";

  return [
    "## SYSTEM WARNING",
    `You have spent ${MAX_CONSECUTIVE_TOOLS_ONLY} consecutive turns using tools without producing any change.`,
    "Tool access is now paused for the next turn. The next response MUST be exactly one change block, not tool calls.",
    `Start with: ${target}`,
    "Use <CREATE> for a new file, or <PATCH>/<PATCH type=\"search\"> for an existing file.",
  ].join("\n");
}

function _totalCharCount(messages: DeepSeekMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (m.content) chars += m.content.length;
    if (m.reasoning_content) chars += m.reasoning_content.length;
  }
  return chars;
}

export function applySingleChange(
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
  verificationGoal?: string;
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
  verificationGoal?: string;
  auto?: boolean;
  dryRun?: boolean;
  maxRepairRounds?: number;
}

// ---- Internal helpers ----

async function buildLayers(
  cwd: string,
  state: TaskState,
): Promise<ContextLayers> {
  const config = loadDshConfig(cwd);
  const rules = loadRuleContents(cwd);
  const pi = assembleIntelligence(cwd);
  const repoContext = generateRepoContext(cwd, pi);

  const allFiles = await scanProjectFiles(cwd);
  const ranked = rankFiles(state.task.description, allFiles);
  const taskFiles = loadTopFiles(cwd, ranked, 10);

  return assembleContext({ config, rules, repoContext, taskState: state, taskFiles });
}

function resolveModelRoutingConfig(cwd: string): ModelRoutingConfig {
  const deepseek = loadDshConfig(cwd).deepseek ?? {};
  return {
    planModel: deepseek.default_model,
    planExploreModel: deepseek.plan_explore_model ?? deepseek.flash_model,
    planExploreThinking: deepseek.plan_explore_thinking ?? deepseek.thinking_default,
    planFinalizeModel: deepseek.plan_finalize_model ?? deepseek.default_model,
    planFinalizeThinking: deepseek.plan_finalize_thinking ?? deepseek.thinking_default,
    planProtocolRepairModel: deepseek.plan_protocol_repair_model ?? deepseek.default_model,
    planProtocolRepairThinking: deepseek.plan_protocol_repair_thinking ?? deepseek.thinking_default,
    patchSmallModel: deepseek.flash_model,
    patchLargeModel: deepseek.default_model,
    verifyModel: deepseek.flash_model,
    repairModel: deepseek.default_model,
    handoffModel: deepseek.flash_model,
    initScanModel: deepseek.flash_model,
    initRuleDetectModel: deepseek.default_model,
  };
}

interface PlanExploreResult {
  messages: DeepSeekMessage[];
  toolRounds: number;
  evidenceSummary: string;
}

function responseContent(response: DeepSeekResponse): string {
  return response.choices[0]?.message.content ?? "";
}

function responseHasToolCalls(response: DeepSeekResponse): boolean {
  return (response.choices[0]?.message.tool_calls ?? []).length > 0;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function excerpt(content: string, limit = 1200): string {
  const trimmed = content.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}...`;
}

function recordPlanContractAttempt(params: {
  state: TaskState;
  stage: PlanContractAttempt["stage"];
  attempt: number;
  status: PlanContractAttempt["status"];
  content: string;
  toolRounds: number;
  failureReason?: string;
  protocolRecovered?: boolean;
  protocolRecoveryReason?: string;
}): void {
  params.state.plan_contract_attempts.push({
    stage: params.stage,
    attempt: params.attempt,
    status: params.status,
    failure_reason: params.failureReason,
    response_excerpt: excerpt(params.content),
    response_sha256: sha256(params.content),
    tool_rounds_before_finalize: params.toolRounds,
    protocol_recovered: params.protocolRecovered,
    protocol_recovery_reason: params.protocolRecoveryReason,
    created_at: new Date().toISOString(),
  });
}

function buildExploreEvidenceSummary(messages: DeepSeekMessage[]): string {
  const toolMessages = messages
    .filter((message) => message.role === "tool")
    .map((message, index) => {
      const content = message.content.replace(/\s+/g, " ").trim();
      return `Tool result ${index + 1}: ${content.slice(0, 1000)}`;
    });
  const assistantNotes = messages
    .filter((message) => message.role === "assistant" && message.content.trim().length > 0)
    .map((message, index) => `Assistant exploration note ${index + 1}: ${message.content.trim().slice(0, 1000)}`);

  const evidence = [...toolMessages, ...assistantNotes].slice(-12);
  return evidence.length > 0 ? evidence.join("\n") : "No tool evidence was collected.";
}

function buildPlanFinalizeMessages(params: {
  taskDescription: string;
  context: ContextLayers;
  evidenceSummary: string;
}): DeepSeekMessage[] {
  return [
    {
      role: "system",
      content: [
        "Tool exploration has ended.",
        "You must output only the final XML contract.",
        "Do not request tools.",
        "Do not include prose outside XML.",
        "<FILES> is the only machine-readable file contract.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "## Task Description",
        params.taskDescription,
        "",
        "## Necessary Context",
        params.context.base,
        "",
        params.context.repo,
        "",
        params.context.task,
        "",
        "## Compressed Exploration Evidence",
        params.evidenceSummary,
        "",
        "## Strict XML Template",
        PLAN_CONTRACT_TEMPLATE,
        "",
        "Rules:",
        "- Output only the XML blocks shown in the template.",
        "- Each non-empty <FILES> line must be exactly one repo-relative file path.",
        "- Do not include descriptions in <FILES>.",
        "- Do not list files you only read or reference.",
        "- <RISKS> must include at least two specific non-empty risks.",
      ].join("\n"),
    },
  ];
}

function buildProtocolRepairMessages(params: {
  invalidResponse: string;
  reason: PlanContractFailureReason;
}): DeepSeekMessage[] {
  return [
    {
      role: "system",
      content: [
        "Repair only the PLAN XML protocol.",
        "Use only the invalid response, validation error reason, and protocol template supplied here.",
        "Output only a corrected XML contract. Do not request tools.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "## Validation Error Reason",
        params.reason,
        "",
        "## Invalid Finalize Response",
        params.invalidResponse,
        "",
        "## Protocol Template",
        PLAN_CONTRACT_TEMPLATE,
      ].join("\n"),
    },
  ];
}

export async function runPlanExplore(params: {
  cwd: string;
  client: DeepSeekClient;
  state: TaskState;
  context: ContextLayers;
  target: ReturnType<typeof classify>;
  planTools: Record<string, unknown>[];
}): Promise<PlanExploreResult> {
  const { cwd, client, state, context, target, planTools } = params;
  const planToolPolicy = getToolPolicy("plan");
  const messages = buildMessages({
    context,
    taskDescription: state.task.description,
    phase: "plan",
  });
  let toolRounds = 0;

  while (toolRounds < MAX_PLAN_TOOL_ROUNDS) {
    const startedAt = Date.now();
    const response = await client.chat({
      model: target.model,
      messages,
      thinking: target.thinking,
      tools: planTools,
    });
    recordDeepSeekUsage(state, {
      phase: "plan_explore",
      model: target.model,
      thinking: target.thinking,
      durationMs: Date.now() - startedAt,
      response,
    });

    const content = responseContent(response);
    const choice = response.choices[0];
    const toolCalls = choice?.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      if (content.trim().length > 0) {
        messages.push({
          role: "assistant",
          content,
          ...(choice?.message.reasoning_content ? { reasoning_content: choice.message.reasoning_content } : {}),
        });
      }
      break;
    }

    messages.push({
      role: "assistant",
      content,
      tool_calls: toolCalls,
      ...(choice?.message.reasoning_content ? { reasoning_content: choice.message.reasoning_content } : {}),
    });

    const toolResult = await executeToolCallsForPolicy({
      toolCalls,
      toolPolicy: planToolPolicy,
      tools: ALL_TOOL_DEFINITIONS,
      cwd,
    });
    messages.push(...toolResult.messages);
    toolRounds++;
    state.tool_rounds.push({
      round: toolRounds,
      calls: toolResult.records,
    });
    writeTaskState(cwd, state);
  }

  return {
    messages,
    toolRounds,
    evidenceSummary: buildExploreEvidenceSummary(messages),
  };
}

export async function runPlanFinalize(params: {
  client: DeepSeekClient;
  target: ReturnType<typeof classify>;
  taskDescription: string;
  context: ContextLayers;
  evidenceSummary: string;
}): Promise<DeepSeekResponse> {
  return params.client.chat({
    model: params.target.model,
    messages: buildPlanFinalizeMessages({
      taskDescription: params.taskDescription,
      context: params.context,
      evidenceSummary: params.evidenceSummary,
    }),
    thinking: params.target.thinking,
  });
}

export async function repairPlanContractProtocol(params: {
  client: DeepSeekClient;
  target: ReturnType<typeof classify>;
  invalidResponse: string;
  reason: PlanContractFailureReason;
}): Promise<DeepSeekResponse> {
  return params.client.chat({
    model: params.target.model,
    messages: buildProtocolRepairMessages({
      invalidResponse: params.invalidResponse,
      reason: params.reason,
    }),
    thinking: params.target.thinking,
  });
}

function applyValidPlanContract(
  state: TaskState,
  description: string,
  validation: PlanContractValidationResult,
): void {
  if (!validation.valid || !validation.planRaw || !validation.files || !validation.risks) {
    throw new Error(`plan_contract_invalid:${validation.reason ?? "unknown"}`);
  }

  state.plan = {
    summary: validation.planRaw.split("\n")[0]?.replace(/^#+\s*/, "") ?? description,
    files: validation.files,
    risks: validation.risks,
    raw_xml: validation.planRaw,
    verify_commands: validation.verifyCommands && validation.verifyCommands.length > 0
      ? validation.verifyCommands
      : undefined,
    verify_strategy: validation.verifyStrategy,
  };
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

// ---- Helpers for Transactional Self-Correction (PHASE-3-D) ----

function performCheckpoint(cwd: string, id: string, managedFiles: string[]): boolean {
  if (isGitRepo(cwd)) {
    return createCheckpoint(cwd, id);
  } else {
    return createFileCheckpoint(cwd, id, managedFiles);
  }
}

function performRollback(cwd: string, id: string): boolean {
  if (isGitRepo(cwd)) {
    return applyRollback(cwd);
  } else {
    return applyFileRollback(cwd, id);
  }
}

function performCleanup(cwd: string): void {
  if (isGitRepo(cwd)) {
    cleanupCheckpoints(cwd);
  }
  cleanupFileCheckpoints(cwd);
}

// ---- runPlan ----

export async function runPlan(params: PlanParams): Promise<TaskState> {
  const { cwd, client, description, taskType, verificationGoal } = params;

  let state = readTaskState(cwd);
  if (!state || state.task.description !== description) {
    state = createTaskState(description, taskType, verificationGoal);
    writeTaskState(cwd, state);
  }

  const layers = await buildLayers(cwd, state);
  const routingConfig = resolveModelRoutingConfig(cwd);
  const exploreTarget = classify({ command: "plan/explore" }, routingConfig);
  const finalizeTarget = classify({ command: "plan/finalize" }, routingConfig);
  const protocolRepairTarget = classify({ command: "plan/protocol-repair" }, routingConfig);
  const planToolPolicy = getToolPolicy("plan");
  const planTools = filterToolsForPolicy(ALL_TOOL_DEFINITIONS, planToolPolicy);

  const explore = await runPlanExplore({
    cwd,
    client,
    state,
    context: layers,
    target: exploreTarget,
    planTools: planTools as unknown as Record<string, unknown>[],
  });

  let finalizeResponse: DeepSeekResponse;
  try {
    const startedAt = Date.now();
    finalizeResponse = await runPlanFinalize({
      client,
      target: finalizeTarget,
      taskDescription: description,
      context: layers,
      evidenceSummary: explore.evidenceSummary,
    });
    recordDeepSeekUsage(state, {
      phase: "plan_finalize",
      model: finalizeTarget.model,
      thinking: finalizeTarget.thinking,
      durationMs: Date.now() - startedAt,
      response: finalizeResponse,
    });
  } catch (err) {
    recordPlanContractAttempt({
      state,
      stage: "finalize",
      attempt: 1,
      status: "provider_error",
      content: err instanceof Error ? err.message : String(err),
      toolRounds: explore.toolRounds,
      failureReason: "provider_network",
    });
    writeTaskState(cwd, state);
    throw err;
  }

  const finalizeContent = responseContent(finalizeResponse);
  let validation = validatePlanContract({
    content: finalizeContent,
    hasToolCalls: responseHasToolCalls(finalizeResponse),
  });
  recordPlanContractAttempt({
    state,
    stage: "finalize",
    attempt: 1,
    status: validation.valid ? "valid" : "invalid",
    content: finalizeContent,
    toolRounds: explore.toolRounds,
    failureReason: validation.reason,
  });
  writeTaskState(cwd, state);

  if (!validation.valid) {
    const repairReason = validation.reason ?? "unknown";
    let repairResponse: DeepSeekResponse;
    try {
      const startedAt = Date.now();
      repairResponse = await repairPlanContractProtocol({
        client,
        target: protocolRepairTarget,
        invalidResponse: finalizeContent,
        reason: repairReason,
      });
      recordDeepSeekUsage(state, {
        phase: "plan_protocol_repair",
        model: protocolRepairTarget.model,
        thinking: protocolRepairTarget.thinking,
        durationMs: Date.now() - startedAt,
        response: repairResponse,
      });
    } catch (err) {
      recordPlanContractAttempt({
        state,
        stage: "protocol_repair",
        attempt: 1,
        status: "provider_error",
        content: err instanceof Error ? err.message : String(err),
        toolRounds: explore.toolRounds,
        failureReason: "provider_network",
      });
      writeTaskState(cwd, state);
      throw err;
    }

    const repairContent = responseContent(repairResponse);
    validation = validatePlanContract({
      content: repairContent,
      hasToolCalls: responseHasToolCalls(repairResponse),
    });
    recordPlanContractAttempt({
      state,
      stage: "protocol_repair",
      attempt: 1,
      status: validation.valid ? "valid" : "invalid",
      content: repairContent,
      toolRounds: explore.toolRounds,
      failureReason: validation.reason ?? repairReason,
      protocolRecovered: validation.valid,
      protocolRecoveryReason: validation.valid ? repairReason : undefined,
    });
    writeTaskState(cwd, state);

    if (!validation.valid) {
      throw new Error(`plan_contract_invalid:${validation.reason ?? repairReason}`);
    }
  }

  applyValidPlanContract(state, description, validation);

  state = transition(state, "planned");
  
  // ---- Initialize managed_files (PHASE-3-D) ----
  // managed_files = plan.files (intended) + actually changed files (realized)
  if (state.plan?.files) {
    const currentManaged = new Set(state.managed_files);
    for (const f of state.plan.files) currentManaged.add(f);
    state.managed_files = [...currentManaged];
  }

  writeTaskState(cwd, state);

  return state;
}

// ---- runPatch ----

export async function runPatch(params: PatchParams): Promise<TaskState> {
  const { cwd, client, dryRun } = params;

  let state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");
  if (state.status !== "planned" && state.status !== "repairing" && state.status !== "preflighted" && state.status !== "preflight_failed") {
    throw new Error(`当前状态为 ${state.status}，需要 planned, repairing, preflighted 或 preflight_failed`);
  }

  const layers = await buildLayers(cwd, state);
  const dynamic = buildDynamicContext(state.patches, state.verify_results, 2);
  const fullLayers = { ...layers, dynamic };

  const fileCount = state.plan?.files?.length ?? 0;
  const target = classify({ command: "patch", fileCount });
  const patchToolPolicy = getToolPolicy("patch");
  const patchTools = filterToolsForPolicy(ALL_TOOL_DEFINITIONS, patchToolPolicy);

  const messages: DeepSeekMessage[] = buildMessages({
    context: fullLayers,
    taskDescription: state.task.description,
    phase: "patch",
  });

  // ---- Patch coverage state machine v2 (spec 2026-05-19) ----
  // When enabled, the v2 pipeline owns the patch stage and returns early. The
  // legacy loop below is preserved unchanged for flag-off / rollback.
  if (isPatchStateMachineV2Enabled(cwd)) {
    state = await runPatchPipeline({
      state,
      cwd,
      client,
      dryRun: !!dryRun,
      messages,
      target: { model: target.model, thinking: target.thinking },
      contextLayers: fullLayers,
    });
    const v2Patch = state.patches.at(-1);
    if (!dryRun && v2Patch && v2Patch.files_changed.length > 0 && v2Patch.apply_status !== "failed") {
      state = await runPostImplementationStaticScan({ cwd, client, state, changedFiles: v2Patch.files_changed });
    }
    return state;
  }

  // ---- Patch Loop Main ----

  const allChangedFiles: string[] = [];
  let consecutiveInvalid = 0;
  let consecutiveToolsOnly = 0;
  let hasProducedChange = false;
  let round = 0;

  while (round < MAX_PATCH_ROUNDS) {
    round++;

    const toolsPausedForInitialStall = !hasProducedChange && consecutiveToolsOnly >= MAX_CONSECUTIVE_TOOLS_ONLY;
    const startedAt = Date.now();
    const response = await client.chat({
      model: target.model,
      messages,
      thinking: target.thinking,
      ...(toolsPausedForInitialStall
        ? {}
        : { tools: patchTools as unknown as Record<string, unknown>[] }),
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

    // If model returned tool_calls but content also parses as invalid,
    // prioritize tool execution (spec note: avoid spurious invalid counts)
    let action = toolsPausedForInitialStall && hasToolCalls
      ? {
          kind: "invalid" as const,
          reason: "tool calls are paused after analysis paralysis; output one change block",
        }
      : parsePatchTurn(content, hasToolCalls);
    if (action.kind === "invalid" && hasToolCalls && !toolsPausedForInitialStall) {
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

        const toolResult = await executeToolCallsForPolicy({
          toolCalls: toolCalls ?? [],
          toolPolicy: patchToolPolicy,
          tools: ALL_TOOL_DEFINITIONS,
          cwd,
        });
        messages.push(...toolResult.messages);
        callRecords.push(...toolResult.records);
        record.tool_calls = callRecords;
        consecutiveInvalid = 0;
        consecutiveToolsOnly++;

        if (hasProducedChange && consecutiveToolsOnly === TOOLS_ONLY_STALL_WARNING) {
          messages.push({
            role: "user",
            content: buildPatchLoopStallWarning(state, allChangedFiles),
          });
        }

        if (consecutiveToolsOnly >= MAX_CONSECUTIVE_TOOLS_ONLY) {
          const reason = hasProducedChange
            ? `连续超过 ${MAX_CONSECUTIVE_TOOLS_ONLY} 轮仅调用工具而未产生代码块，任务自动终止以防止 Token 浪费。请总结已完成部分进入验证。`
            : `初始调研轮次达到 ${MAX_CONSECUTIVE_TOOLS_ONLY} 轮且未产生任何代码修改，判定为 Analysis Paralysis。请停止调研并开始实施第一步。`;
          
          messages.push({
            role: "user",
            content: hasProducedChange
              ? `## SYSTEM WARNING\n${reason}`
              : buildInitialPatchLoopStallWarning(state),
          });
        }
        break;
      }

      case "change": {
        consecutiveToolsOnly = 0;
        hasProducedChange = true;
        if (choice.message.reasoning_content) {
          record.reasoning_excerpt = choice.message.reasoning_content.slice(0, 500);
        }

        // ---- Checkpoint (PHASE-3-D) ----
        const checkpointId = `dsh-checkpoint-patch-round-${round}`;
        if (!dryRun) {
          performCheckpoint(cwd, checkpointId, state.managed_files);
        }

        const result = applySingleChange(cwd, action.change, !!dryRun);

        // ---- Rollback on failure (PHASE-3-D) ----
        if (!result.ok && !dryRun) {
          performRollback(cwd, checkpointId);
        }

        record.change = {
          op: action.change.op,
          file: action.change.file,
          apply_status: result.ok ? "ok" : "failed",
          apply_error: result.error,
          raw_block: action.change.raw_block,
        };

        // ---- Track managed files (PHASE-3-D) ----
        if (result.ok && result.files_changed.length > 0) {
          const currentManaged = new Set(state.managed_files);
          for (const f of result.files_changed) currentManaged.add(f);
          state.managed_files = [...currentManaged];

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
          // cutoffs — see docs/reports/runlogs/260509-040502 for evidence.)
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
  // Evidence: docs/reports/runlogs/260509-040502 (pi-refactor-read-text: 3/3 files
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
  if (
    state.status !== "patched" &&
    state.status !== "repairing" &&
    state.status !== "patch_failed" &&
    state.status !== "patch_partial"
  ) {
    throw new Error(`当前状态为 ${state.status}，需要 patched、repairing、patch_failed 或 patch_partial`);
  }

  // patch_failed / patch_partial: route directly to repair without running the
  // verify assertions. patch_partial already carries a structured missing-file
  // signal on the patch record (spec 2026-05-19 §4.8 D2).
  if (state.status === "patch_failed" || state.status === "patch_partial") {
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
  if (
    state.status !== "verification_failed" &&
    state.status !== "patch_failed" &&
    state.status !== "patch_partial"
  ) {
    throw new Error(`当前状态为 ${state.status}，需要 verification_failed、patch_failed 或 patch_partial`);
  }

  const layers = await buildLayers(cwd, state);

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

// ---- runPreflight ----

export interface PreflightParams {
  cwd: string;
  client: DeepSeekClient;
}

export async function runPreflight(params: PreflightParams): Promise<TaskState> {
  const { cwd, client } = params;

  let state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");

  if (state.status !== "planned" && state.status !== "repairing") {
    return state; // Only run preflight from planned or repairing
  }

  state = transition(state, "preflighting");
  writeTaskState(cwd, state);

  const config = loadDshConfig(cwd);
  const initialPreflight = config.verify?.initial_preflight !== false;

  if (!initialPreflight) {
    state = transition(state, "preflighted");
    writeTaskState(cwd, state);
    return state;
  }

  const repoFiles = await scanProjectFiles(cwd);
  const ranked = rankFiles(state.task.description, repoFiles);
  const taskFiles = loadTopFiles(cwd, ranked, 10);
  const repoContext = generateRepoContext(cwd, assembleIntelligence(cwd));
  const rules = loadRuleContents(cwd);

  const layers = assembleContext({
    config,
    rules,
    repoContext,
    taskState: state,
    taskFiles,
  });

  const messages: DeepSeekMessage[] = buildMessages({
    context: layers,
    taskDescription: state.task.description,
    phase: "preflight",
  });

  const MAX_PREFLIGHT_TURNS = 5;
  const preflightToolPolicy = getToolPolicy("preflight");
  const preflightTools = filterToolsForPolicy(ALL_TOOL_DEFINITIONS, preflightToolPolicy);
  for (let turn = 1; turn <= MAX_PREFLIGHT_TURNS; turn++) {
    const startedAt = Date.now();
    const response = await client.chat({
      model: "deepseek-v4-pro",
      messages,
      thinking: true,
      tools: preflightTools as unknown as Record<string, unknown>[],
    });
    recordDeepSeekUsage(state, {
      phase: "preflight",
      model: "deepseek-v4-pro",
      thinking: true,
      durationMs: Date.now() - startedAt,
      response,
    });

    const choice = response.choices[0];
    if (!choice) break;

    const content = choice.message.content;
    const toolCalls = choice.message.tool_calls;

    const assistantMsg: DeepSeekMessage = { role: "assistant", content, tool_calls: toolCalls };
    if (choice.message.reasoning_content) assistantMsg.reasoning_content = choice.message.reasoning_content;
    messages.push(assistantMsg);

    if (toolCalls && toolCalls.length > 0) {
      const toolResult = await executeToolCallsForPolicy({
        toolCalls,
        toolPolicy: preflightToolPolicy,
        tools: ALL_TOOL_DEFINITIONS,
        cwd,
      });
      messages.push(...toolResult.messages);
      const round = state.tool_rounds.length + 1;
      state.tool_rounds.push({
        round: 1000 + round, // Use 1000+ offset to distinguish from patch rounds
        calls: toolResult.records,
      });
      writeTaskState(cwd, state);
      continue;
    }

    if (content.includes("<DONE/>")) {
      break;
    }

    // If no tools and no DONE, just end preflight
    break;
  }

  // Preflight checks are environment/readiness probes only. Final acceptance
  // assertions may depend on files that the patch has not created yet, so they
  // intentionally run later in runVerify.
  const assertions = resolvePreflightAssertions(config.verify);
  if (assertions.length > 0) {
    const results = runVerifyAssertions(assertions, cwd);
    const round = state.preflight_results.length + 1;
    state.preflight_results.push({ round, results });
    
    if (isAllPassed(results)) {
      state = transition(state, "preflighted");
    } else {
      state = transition(state, "preflight_failed");
    }
  } else {
    state = transition(state, "preflighted");
  }

  writeTaskState(cwd, state);
  return state;
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
  const { cwd, client, description, taskType, verificationGoal, auto = true, dryRun, maxRepairRounds = 5 } = params;

  await runPlan({ cwd, client, description, taskType, verificationGoal });
  await runPreflight({ cwd, client });
  let state = await runPatch({ cwd, client, auto, dryRun });

  if (state.status === "patched") {
    try {
      state = await runVerify({ cwd });
    } catch (e) {
      if (e instanceof Error && e.message.includes("没有配置验证命令")) {
        // Verification cannot run, but the full pipeline should still clean up
        // transient checkpoints and write an auditable handoff.
      }
      else {
        throw e;
      }
    }
  }

  if (state.status === "verification_failed" || state.status === "patch_failed") {
    state = await runRepair({ cwd, client, maxRounds: maxRepairRounds });
  }

  // ---- Cleanup Checkpoints (PHASE-3-D) ----
  performCleanup(cwd);

  const handoffPath = await runHandoff({ cwd });
  state = { ...state, handoff_path: handoffPath };
  writeTaskState(cwd, state);

  return state;
}
