import * as fs from "node:fs";
import * as path from "node:path";
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
import { ALL_TOOL_DEFINITIONS } from "./tool-definitions.js";
import { executeTool, formatToolResult } from "./tool-executor.js";
import type { ToolName } from "./tool-definitions.js";

// ---- Helpers ----

const MAX_TOOL_ROUNDS = 5;
const PATCH_BLOCK_PATTERN = /<\/?(?:CREATE|PATCH|INSERT|DELETE|RENAME|SEARCH|REPLACE)[>\s]/i;

function hasPatchBlocks(content: string): boolean {
  return PATCH_BLOCK_PATTERN.test(content);
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

  // Preemptively detect large file edits and inject two-step hint
  let taskDescription = state.task.description;
  const planFiles = state.plan?.files ?? [];
  const LARGE_FILE_THRESHOLD = 200; // lines
  let hasLargeFile = false;
  for (const f of planFiles) {
    try {
      const filePath = path.join(cwd, f);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const lineCount = content.split("\n").length;
        if (lineCount > LARGE_FILE_THRESHOLD) {
          hasLargeFile = true;
          break;
        }
      }
    } catch { /* skip */ }
  }

  if (hasLargeFile) {
    taskDescription = [
      taskDescription,
      "",
      "LARGE FILE DETECTED. Use two-step CREATE + INSERT approach:",
      "1. Write the new/modified content to a temp file using <CREATE path=\"...\">",
      "2. Insert it with <INSERT position=\"before|after\" anchor=\"section heading\" file=\"target\" from=\"temp-file\" />",
      "DO NOT use unified diff — it will fail on large files.",
    ].join("\n");
  }

  const target = classify({ command: "patch", fileCount });

  const messages: DeepSeekMessage[] = buildMessages({ context: fullLayers, taskDescription, phase: "patch" });
  let content = "";
  let toolRounds = 0;
  const toolRoundRecords: import("./task-state.js").ToolRoundRecord[] = [];

  while (toolRounds < MAX_TOOL_ROUNDS) {
    const response = await client.chat({
      model: target.model,
      messages,
      thinking: target.thinking,
      tools: ALL_TOOL_DEFINITIONS as unknown as Record<string, unknown>[],
    });

    const choice = response.choices[0];
    if (!choice) throw new Error("DeepSeek API 返回空响应");

    content = choice.message.content;
    const toolCalls = choice.message.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      const roundNum = toolRounds + 1;
      // Execute tools once, collect both results and records
      const callRecords: import("./task-state.js").ToolCallRecord[] = [];
      const assistantMsg: DeepSeekMessage = { role: "assistant", content, tool_calls: toolCalls };
      if (choice.message.reasoning_content) assistantMsg.reasoning_content = choice.message.reasoning_content;
      messages.push(assistantMsg);

      for (const tc of toolCalls) {
        let args: Record<string, string> = {};
        try { args = JSON.parse(tc.function.arguments) as Record<string, string>; } catch { /* keep empty */ }
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
      toolRoundRecords.push({ round: roundNum, calls: callRecords });
      toolRounds++;
      continue;
    }

    break;
  }

  // Record tool calls in state
  if (toolRoundRecords.length > 0) {
    state.tool_rounds.push(...toolRoundRecords);
    writeTaskState(cwd, state);
  }

  // Force output if max tool rounds reached without patch blocks
  if (toolRounds >= MAX_TOOL_ROUNDS && !hasPatchBlocks(content)) {
    messages.push({
      role: "user",
      content: "MAX TOOL ROUNDS REACHED. You MUST now output your patch using CREATE/PATCH/INSERT/DELETE/RENAME XML blocks. Do not call any more tools.",
    });
    const finalResponse = await client.chat({
      model: "deepseek-v4-pro",
      messages,
      thinking: true,
    });
    content = finalResponse.choices[0]?.message.content ?? "";
  }

  // Try to parse changes; if unified diff fails, retry with SEARCH/REPLACE hint
  let changes: ReturnType<typeof parseChanges>;
  let applyResult = dryRun
    ? { success: true as const, createdFiles: [] as string[], renamedFiles: [] as string[], patchedFiles: [] as string[], deletedFiles: [] as string[] }
    : undefined as { success: boolean; createdFiles: string[]; renamedFiles: string[]; patchedFiles: string[]; deletedFiles: string[]; error?: string } | undefined;
  try {
    changes = parseChanges(content);
  } catch (parseErr) {
    changes = { creates: [], renames: [], patchText: null, patchFiles: [], hunks: [], deletePaths: [], searchReplaceBlocks: [], insertBlocks: [] };
    applyResult = { success: false, createdFiles: [], renamedFiles: [], patchedFiles: [], deletedFiles: [], error: parseErr instanceof Error ? parseErr.message : "parse failed" };
  }
  applyResult ??= applyChanges(cwd, changes, false);

  // Retry on parse failure or patch apply failure
  const MAX_APPLY_RETRIES = 2;
  for (let retry = 0; !dryRun && !applyResult.success && retry < MAX_APPLY_RETRIES; retry++) {
    const parseOrApplyError = applyResult.error ?? "patch apply failed";
    const isParseError = parseOrApplyError.includes("validation failed") || parseOrApplyError.includes("No hunk headers") || parseOrApplyError.includes("No <CREATE>");
    const isSearchMismatch = parseOrApplyError.includes("Search block not found");
    const isCreateRejected = parseOrApplyError.includes("CREATE rejected") || parseOrApplyError.includes("already exists");

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
    if (isCreateRejected) {
      retryHintParts.push("CREATE REJECTED — the file already exists (possibly created in a previous attempt).");
      retryHintParts.push("");
      retryHintParts.push("Use <PATCH> or <PATCH type=\"search\"> to modify the existing file instead of CREATE.");
      retryHintParts.push("");
      retryHintParts.push("For REPLACING existing text:");
      retryHintParts.push("<PATCH type=\"search\" file=\"path/to/file\">");
      retryHintParts.push("<SEARCH>existing code to replace</SEARCH>");
      retryHintParts.push("<REPLACE>new code</REPLACE>");
      retryHintParts.push("</PATCH>");
      retryHintParts.push("");
      retryHintParts.push("For small changes, unified diff:");
      retryHintParts.push("<PATCH>");
      retryHintParts.push("--- a/file");
      retryHintParts.push("+++ b/file");
      retryHintParts.push("@@ -line,count +line,count @@");
      retryHintParts.push(" context");
      retryHintParts.push("+added");
      retryHintParts.push("</PATCH>");
    } else if (isSearchMismatch) {
      retryHintParts.push("SEARCH TEXT MISMATCH — the <SEARCH> block did not match any text in the file.");
      retryHintParts.push("");
      retryHintParts.push("Here is the ACTUAL file content. COPY text DIRECTLY from here into <SEARCH>:");

      // Read the target file(s) and extract headings as anchor candidates
      const targetFiles = state.plan?.files ?? [];
      for (const f of targetFiles) {
        try {
          const fileContent = fs.readFileSync(path.join(cwd, f), "utf-8");

          // Extract markdown headings and section markers as anchor candidates
          const headings = fileContent.match(/^#{1,4}\s+.+$/gm) ?? [];
          const uniqueHeadings = [...new Set(headings)].slice(0, 20);

          retryHintParts.push("");
          retryHintParts.push("=== " + f + " — AVAILABLE ANCHORS (use EXACTLY one of these) ===");
          if (uniqueHeadings.length > 0) {
            uniqueHeadings.forEach((h: string) => retryHintParts.push("  " + h));
          } else {
            // For non-markdown files, show first lines
            const lines = fileContent.split("\n").slice(0, 10);
            lines.forEach((l: string) => retryHintParts.push("  " + l));
          }
          retryHintParts.push("=== END ANCHORS ===");
        } catch {
          // file not readable, skip
        }
      }

      retryHintParts.push("");
      retryHintParts.push("=== SIMPLE APPROACH: Write new content to a temp file ===");
      retryHintParts.push("Don't try to edit the large file. Instead, use CREATE to write your new content to a temp file.");
      retryHintParts.push("The system will handle inserting it at the right place.");
      retryHintParts.push("");
      retryHintParts.push("Step 1 — write the new section to a temp file:");
      retryHintParts.push("<CREATE path=\"tools/README-new-section.md\">");
      retryHintParts.push("## 架构检查与门禁");
      retryHintParts.push("");
      retryHintParts.push("... your documentation content ...");
      retryHintParts.push("</CREATE>");
      retryHintParts.push("");
      retryHintParts.push("Step 2 — tell the system where to insert it (pick from the anchors list above):");
      retryHintParts.push("<INSERT position=\"before\" anchor=\"pick from anchor list\" file=\"tools/README.md\" from=\"tools/README-new-section.md\" />");
      retryHintParts.push("");
      retryHintParts.push("The system will read the temp file and insert its content at the anchor position.");
    } else if (isParseError) {
      retryHintParts.push("The unified diff format failed to parse. Use <INSERT> or <PATCH type=\"search\"> instead:");
      retryHintParts.push("");
      retryHintParts.push("For ADDING new content (recommended):");
      retryHintParts.push("<INSERT position=\"before\" anchor=\"a unique heading or phrase\" file=\"path/to/file\">");
      retryHintParts.push("new content to insert");
      retryHintParts.push("</INSERT>");
      retryHintParts.push("The anchor is any text that EXISTS in the file — just name it, don't copy it exactly.");
      retryHintParts.push("");
      retryHintParts.push("For REPLACING existing text:");
      retryHintParts.push("<PATCH type=\"search\" file=\"path/to/file\">");
      retryHintParts.push("<SEARCH>exact code from the file content</SEARCH>");
      retryHintParts.push("<REPLACE>replacement code</REPLACE>");
      retryHintParts.push("</PATCH>");
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
    const changedFiles = applyResult.success
      ? [...applyResult.createdFiles, ...applyResult.renamedFiles, ...applyResult.patchedFiles, ...applyResult.deletedFiles]
      : [];

    // Record patch with XML tags preserved so protocol ops can be detected
    const patchText = [
      ...changes.creates.map((c) => `<CREATE path="${c.path}">\n${c.content}\n</CREATE>`),
      ...changes.renames.map((r) => `<RENAME from="${r.from}" to="${r.to}" />`),
      ...changes.deletePaths.map((p) => `<DELETE path="${p}" />`),
      ...changes.searchReplaceBlocks.map((s) => `<PATCH type="search" file="${s.filePath}">\n<<<<<<< SEARCH\n${s.search}\n=======\n${s.replace}\n>>>>>>> REPLACE\n</PATCH>`),
      changes.patchText ? `<PATCH>\n${changes.patchText}\n</PATCH>` : "",
    ].filter(Boolean).join("\n\n") || "<empty>";

    state.patches.push({
      round: (state.repair_rounds ?? 0) + 1,
      patch: patchText,
      apply_status: applyResult.success ? "ok" : "failed",
      files_changed: changedFiles,
    });

    if (!applyResult.success) {
      writeTaskState(cwd, state);
      throw new Error(`变更应用失败 — ${applyResult.error}`);
    }

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

  const config = loadDshConfig(cwd);
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

  const config = loadDshConfig(cwd);
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
