import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { DeepSeekClient } from "@dsh/provider";
import { classify } from "@dsh/provider";
import type { ContextLayers } from "./context-builder.js";
import { assembleContext, buildDynamicContext } from "./context-builder.js";
import { buildMessages } from "./prompt-builder.js";
import {
  extractPlanBlock,
  extractFilesBlock,
  extractRisksBlock,
  parsePatch,
  applyPatch,
} from "./patch-parser.js";
import { runVerify as runVerifyCommands, isAllPassed, formatResults } from "./verifier.js";
import { runRepairLoop } from "./repair-loop.js";
import type { RepairRoundResult } from "./repair-loop.js";
import {
  createTaskState,
  readTaskState,
  writeTaskState,
  transition,
} from "./task-state.js";
import type { TaskState } from "./task-state.js";
import { writeHandoff } from "./handoff-writer.js";
import {
  loadRuleContents,
  detectTechStack,
  generateRepoContext,
  rankFiles,
  loadTopFiles,
  scanProjectFiles,
} from "@dsh/repo";

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

export interface VerifyParams extends PipelineBase {
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

function readLocalConfig(cwd: string): Record<string, any> {
  try {
    const raw = fs.readFileSync(path.join(cwd, ".dsh", "config.yml"), "utf-8");
    return (yaml.load(raw) as Record<string, any>) ?? {};
  } catch {
    return {};
  }
}

async function buildLayers(cwd: string, description: string): Promise<ContextLayers> {
  const config = readLocalConfig(cwd);
  const rules = loadRuleContents(cwd);
  const stack = detectTechStack(cwd);
  const repoContext = generateRepoContext(cwd, stack);

  const state = createTaskState(description, "feature");
  const allFiles = await scanProjectFiles(cwd);
  const ranked = rankFiles(description, allFiles);
  const taskFiles = loadTopFiles(cwd, ranked, 10);

  return assembleContext({ config, rules, repoContext, taskState: state, taskFiles });
}

function readLocalConfigStrict(cwd: string): Record<string, any> {
  try {
    const raw = fs.readFileSync(path.join(cwd, ".dsh", "config.yml"), "utf-8");
    return (yaml.load(raw) as Record<string, any>) ?? {};
  } catch {
    throw new Error("无法读取 .dsh/config.yml 文件，请确认项目已初始化");
  }
}

// ---- runPlan ----

export async function runPlan(params: PlanParams): Promise<TaskState> {
  const { cwd, client, description, taskType } = params;

  let state = readTaskState(cwd);
  if (!state || state.task.description !== description) {
    state = createTaskState(description, taskType);
    writeTaskState(cwd, state);
  }

  const layers = await buildLayers(cwd, description);
  const target = classify({ command: "plan" });

  const messages = buildMessages({ context: layers, taskDescription: description });
  const response = await client.chat({
    model: target.model,
    messages,
    thinking: target.thinking,
  });

  const content = response.choices[0]?.message.content ?? "";
  const planRaw = extractPlanBlock(content);
  const files = extractFilesBlock(content);
  const risks = extractRisksBlock(content);

  if (!planRaw) {
    throw new Error("DeepSeek 未返回有效的 PLAN 块");
  }

  state.plan = {
    summary: planRaw.split("\n")[0]?.replace(/^#+\s*/, "") ?? description,
    files,
    risks,
    raw_xml: planRaw,
  };
  state = transition(state, "planned");
  writeTaskState(cwd, state);

  return state;
}

// ---- runPatch ----

export async function runPatch(params: PatchParams): Promise<TaskState> {
  const { cwd, client, auto, dryRun } = params;

  let state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");
  if (state.status !== "planned" && state.status !== "repairing") {
    throw new Error(`当前状态为 ${state.status}，需要 planned 或 repairing`);
  }

  const layers = await buildLayers(cwd, state.task.description);
  const dynamic = buildDynamicContext(state.patches, state.verify_results, 2);
  const fullLayers = { ...layers, dynamic };

  const fileCount = state.plan?.files?.length ?? 0;
  const target = classify({ command: "patch", fileCount });

  const messages = buildMessages({ context: fullLayers, taskDescription: state.task.description });
  const response = await client.chat({
    model: target.model,
    messages,
    thinking: target.thinking,
  });

  const content = response.choices[0]?.message.content ?? "";
  const parsed = parsePatch(content);

  if (!dryRun) {
    const result = applyPatch(cwd, parsed.patchText, false);
    if (!result.success) {
      throw new Error(`patch 应用失败 — ${result.error}`);
    }

    state.patches.push({
      round: (state.repair_rounds ?? 0) + 1,
      patch: parsed.patchText,
      apply_status: "ok",
      files_changed: result.files,
    });
    state = transition(state, "patched");
    writeTaskState(cwd, state);
  }

  return state;
}

// ---- runVerify ----

export async function runVerify(params: VerifyParams): Promise<TaskState> {
  const { cwd, test, lint, typecheck } = params;

  let state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");
  if (state.status !== "patched" && state.status !== "repairing") {
    throw new Error(`当前状态为 ${state.status}，需要 patched`);
  }

  const config = readLocalConfigStrict(cwd);
  const verifyConfig = config.verify as Record<string, string> | undefined;
  const commands: string[] = [];

  if (test) commands.push(verifyConfig?.test ?? "");
  if (lint) commands.push(verifyConfig?.lint ?? "");
  if (typecheck) commands.push(verifyConfig?.typecheck ?? "");

  if (!test && !lint && !typecheck) {
    if (verifyConfig?.test) commands.push(verifyConfig.test);
    if (verifyConfig?.lint) commands.push(verifyConfig.lint);
    if (verifyConfig?.typecheck) commands.push(verifyConfig.typecheck);
  }

  const validCommands = commands.filter((c) => c && c.trim());
  if (validCommands.length === 0) {
    throw new Error("没有配置验证命令。请检查 .dsh/config.yml");
  }

  const results = runVerifyCommands(validCommands, cwd);
  const round = (state.verify_results?.length ?? 0) + 1;
  state.verify_results.push({ round, results });

  state = transition(state, isAllPassed(results) ? "verified" : "verification_failed");
  writeTaskState(cwd, state);

  return state;
}

// ---- runRepair ----

export async function runRepair(params: RepairParams): Promise<TaskState> {
  const { cwd, client, maxRounds = 3, onRound } = params;

  let state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");
  if (state.status !== "verification_failed") {
    throw new Error(`当前状态为 ${state.status}，需要 verification_failed`);
  }

  const layers = await buildLayers(cwd, state.task.description);

  const config = readLocalConfigStrict(cwd);
  const verifyConfig = config.verify as Record<string, string> | undefined;
  if (verifyConfig && state.plan) {
    const commands = [verifyConfig.test, verifyConfig.lint, verifyConfig.typecheck]
      .filter((c): c is string => typeof c === "string" && c.length > 0);
    state.plan = { ...state.plan, verify_commands: commands };
  }

  const finalState = await runRepairLoop(state, {
    client,
    cwd,
    maxRounds,
    contextLayers: layers,
    onRound,
  });

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

  let state = await runPlan({ cwd, client, description, taskType });
  state = await runPatch({ cwd, client, auto });

  try {
    state = await runVerify({ cwd, client });
  } catch (e) {
    if (e instanceof Error && e.message.includes("没有配置验证命令")) {
      return state;
    }
    throw e;
  }

  if (state.status === "verification_failed") {
    state = await runRepair({ cwd, client, maxRounds: maxRepairRounds });
  }

  await runHandoff({ cwd });

  return state;
}
