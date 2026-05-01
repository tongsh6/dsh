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
  extractVerifyBlock,
  parseChanges,
  applyChanges,
} from "./patch-parser.js";
import { detectFailures, buildRepairHints } from "./failure-detector.js";
import { runVerify as runVerifyCommands, isAllPassed } from "./verifier.js";
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

function readLocalConfigStrict(cwd: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(cwd, ".dsh", "config.yml"), "utf-8");
  return yaml.load(raw) as Record<string, unknown>;
}

function readLocalConfig(cwd: string): Record<string, unknown> {
  try {
    return readLocalConfigStrict(cwd);
  } catch {
    return {};
  }
}

async function buildLayers(cwd: string, description: string, taskType: string): Promise<ContextLayers> {
  const config = readLocalConfig(cwd);
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
  const scanConfig = resolveStaticScanConfig(readLocalConfig(cwd));

  if (!scanConfig.enabled || !scanConfig.command) {
    return state;
  }

  const scanRound = (state.static_scan_runs?.length ?? 0) + 1;
  const scan = runStaticScan(
    cwd,
    scanConfig.command,
    scanRound,
    changedFiles,
    scanConfig.topN,
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
    topN: scanConfig.topN,
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

  const messages = buildMessages({ context: fullLayers, taskDescription: state.task.description, phase: "patch" });
  const response = await client.chat({
    model: target.model,
    messages,
    thinking: target.thinking,
  });

  const content = response.choices[0]?.message.content ?? "";

  // Try to parse changes; if unified diff fails, retry with SEARCH/REPLACE hint
  let changes: ReturnType<typeof parseChanges>;
  let applyResult = dryRun
    ? { success: true as const, createdFiles: [] as string[], renamedFiles: [] as string[], patchedFiles: [] as string[], deletedFiles: [] as string[] }
    : undefined as { success: boolean; createdFiles: string[]; renamedFiles: string[]; patchedFiles: string[]; deletedFiles: string[]; error?: string } | undefined;
  try {
    changes = parseChanges(content);
  } catch (parseErr) {
    changes = { creates: [], renames: [], patchText: null, patchFiles: [], hunks: [], deletePaths: [], searchReplaceBlocks: [] };
    applyResult = { success: false, createdFiles: [], renamedFiles: [], patchedFiles: [], deletedFiles: [], error: parseErr instanceof Error ? parseErr.message : "parse failed" };
  }
  applyResult ??= applyChanges(cwd, changes, false);

  // Retry on parse failure or patch apply failure
  const MAX_APPLY_RETRIES = 2;
  for (let retry = 0; !dryRun && !applyResult.success && retry < MAX_APPLY_RETRIES; retry++) {
    const parseOrApplyError = applyResult.error ?? "patch apply failed";
    const isParseError = parseOrApplyError.includes("validation failed") || parseOrApplyError.includes("No hunk headers") || parseOrApplyError.includes("No <CREATE>");
    const isSearchMismatch = parseOrApplyError.includes("Search block not found");

    const detections = detectFailures({
      response: content,
      planFiles: state.plan?.files ?? [],
      actualChangedFiles: [],
      verifyOutput: null,
      patchApplyError: parseOrApplyError,
    });

    const hints = buildRepairHints(detections);

    const retryHintParts = [
      "PATCH FORMAT FAILED — the previous attempt had format errors. Fix and retry.",
      "",
      "Error: " + parseOrApplyError,
    ];
    if (isParseError) {
      retryHintParts.push("");
    if (isSearchMismatch) {
      retryHintParts.push("SEARCH TEXT MISMATCH — the <SEARCH> block did not match any text in the file.");
      retryHintParts.push("");
      retryHintParts.push("Here is the ACTUAL file content. COPY text DIRECTLY from here into <SEARCH>:");

      // Read the target file(s) and include their content
      const targetFiles = state.plan?.files ?? [];
      for (const f of targetFiles) {
        try {
          const fileContent = fs.readFileSync(path.join(cwd, f), "utf-8");
          // Include first 3000 chars — enough to find good anchor text
          const snippet = fileContent.length > 3000
            ? fileContent.slice(0, 3000) + "\n... (truncated, total " + fileContent.length + " chars)"
            : fileContent;
          retryHintParts.push("");
          retryHintParts.push("=== " + f + " (ACTUAL FILE CONTENT) ===");
          retryHintParts.push(snippet);
          retryHintParts.push("=== END " + f + " ===");
        } catch {
          // file not readable, skip
        }
      }

      retryHintParts.push("");
      retryHintParts.push("Find the exact text you want to replace in the content above.");
      retryHintParts.push("COPY-PASTE it character-for-character into <SEARCH>.");
      retryHintParts.push("");
      retryHintParts.push("Format:");
      retryHintParts.push("<PATCH type=\"search\" file=\"path/to/file\">");
      retryHintParts.push("<SEARCH>exact text copied from the file content above</SEARCH>");
      retryHintParts.push("<REPLACE>replacement text</REPLACE>");
      retryHintParts.push("</PATCH>");
    } else {
      retryHintParts.push("The unified diff format failed to parse. Use <PATCH type=\"search\" file=\"path\"> with XML sub-tags instead:");
      retryHintParts.push("<PATCH type=\"search\" file=\"path/to/file\">");
      retryHintParts.push("<SEARCH>exact code copied from the file content</SEARCH>");
      retryHintParts.push("<REPLACE>replacement code</REPLACE>");
      retryHintParts.push("</PATCH>");
      retryHintParts.push("");
      retryHintParts.push("Copy the EXACT text from the file content into <SEARCH> — whitespace, indentation, everything must match.");
    }
    }
    if (hints) {
      retryHintParts.push("");
      retryHintParts.push(hints);
    }

    const retryMessages = buildMessages({
      context: { ...fullLayers, dynamic: buildDynamicContext(state.patches, state.verify_results, 1) },
      taskDescription: [
        ...retryHintParts,
        "",
        "Original task: " + state.task.description,
      ].join("\n"),
      phase: "patch",
    });

    const retryResponse = await client.chat({
      model: "deepseek-v4-pro", // Always use Pro for retry
      messages: retryMessages,
      thinking: true,
    });

    const retryContent = retryResponse.choices[0]?.message.content ?? "";
    try {
      const retryChanges = parseChanges(retryContent);
      applyResult = applyChanges(cwd, retryChanges, false);
    } catch {
      // Continue to next retry
      applyResult = { success: false, createdFiles: [], renamedFiles: [], patchedFiles: [], deletedFiles: [], error: "parse failed" };
    }
  }

  if (!dryRun) {
    if (!applyResult.success) {
      throw new Error(`变更应用失败 — ${applyResult.error}`);
    }

    const changedFiles = [...applyResult.createdFiles, ...applyResult.renamedFiles, ...applyResult.patchedFiles, ...applyResult.deletedFiles];
    state.patches.push({
      round: (state.repair_rounds ?? 0) + 1,
      patch: [
        ...changes.creates.map((c) => `<CREATE path="${c.path}">\n${c.content}\n</CREATE>`),
        ...changes.renames.map((r) => `<RENAME from="${r.from}" to="${r.to}" />`),
        ...changes.deletePaths.map((p) => `<DELETE path="${p}" />`),
        changes.patchText ?? "",
      ].filter(Boolean).join("\n\n") || "<empty>",
      apply_status: "ok",
      files_changed: changedFiles,
    });
    state = transition(state, "patched");
    writeTaskState(cwd, state);
    state = await runPostImplementationStaticScan({ cwd, client, state, changedFiles });
  }

  return state;
}

// ---- runVerify ----

export async function runVerify(params: VerifyParams): Promise<TaskState> {
  const { cwd, test, lint, typecheck } = params;

  let state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");
  if (state.status !== "patched" && state.status !== "repairing") {
    throw new Error(`当前状态为 ${state.status}，需要 patched 或 repairing`);
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

  const state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");
  if (state.status !== "verification_failed") {
    throw new Error(`当前状态为 ${state.status}，需要 verification_failed`);
  }

  const layers = await buildLayers(cwd, state.task.description, state.task.type);

  const config = readLocalConfigStrict(cwd);
  const verifyConfig = config.verify as Record<string, string> | undefined;
  if (verifyConfig && state.plan) {
    const commands = [verifyConfig.test, verifyConfig.lint, verifyConfig.typecheck]
      .filter((c): c is string => typeof c === "string" && c.length > 0);
    state.plan = { ...state.plan, verify_commands: commands };
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

  try {
    state = await runVerify({ cwd });
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
