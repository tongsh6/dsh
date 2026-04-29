import * as path from "node:path";
import * as fs from "node:fs";
import { DeepSeekClient, classify } from "@dsh/provider";
import { rankFiles, loadTopFiles, scanProjectFiles, loadRuleContents, generateRepoContext, detectTechStack } from "@dsh/repo";
import {
  createTaskState,
  readTaskState,
  writeTaskState,
  transition,
  buildBaseContext,
  buildRepoContext,
  buildTaskContext,
  assembleContext,
  buildMessages,
  extractPlanBlock,
  extractFilesBlock,
  extractRisksBlock,
} from "@dsh/core";
import { readConfig } from "../utils/config.js";

interface PlanOptions {
  type?: string;
}

export async function planCommand(description: string, opts: PlanOptions): Promise<void> {
  const cwd = process.cwd();
  const taskType = (opts.type ?? "feature") as "bugfix" | "feature" | "refactor" | "test" | "docs";

  // Read or init task state
  let state = readTaskState(cwd);
  if (!state || state.task.description !== description) {
    state = createTaskState(description, taskType);
    writeTaskState(cwd, state);
  }

  console.log("正在分析任务和项目上下文...");

  // Build context layers
  const config = readConfig(cwd);
  const rules = loadRuleContents(cwd);
  const stack = detectTechStack(cwd);
  const repoContext = generateRepoContext(cwd, stack);
  const baseContext = buildBaseContext(rules, config);
  const repoStr = buildRepoContext(repoContext);

  // Find relevant files
  const allFiles = await scanProjectFiles(cwd);
  const ranked = rankFiles(description, allFiles);
  const taskFiles = loadTopFiles(cwd, ranked, 10);

  const tempState = { ...state, plan: undefined };
  const taskContext = buildTaskContext(tempState, taskFiles);

  const context = { base: baseContext, repo: repoStr, task: taskContext, dynamic: null, estimatedTokens: 0 };

  // Route to Pro + thinking
  const target = classify({ command: "plan" });
  let client: DeepSeekClient;
  try {
    client = DeepSeekClient.fromEnv();
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  console.log(`使用模型: ${target.model} (thinking: ${target.thinking})`);

  const messages = buildMessages({ context, taskDescription: description });
  const response = await client.chat({
    model: target.model,
    messages,
    thinking: target.thinking,
  });

  const content = response.choices[0]?.message.content ?? "";

  // Parse response
  const planRaw = extractPlanBlock(content);
  const files = extractFilesBlock(content);
  const risks = extractRisksBlock(content);

  if (!planRaw) {
    console.log("错误: DeepSeek 未返回有效的 PLAN 块");
    console.log("原始响应:");
    console.log(content.slice(0, 1000));
    process.exit(1);
  }

  // Update state
  state.plan = {
    summary: planRaw.split("\n")[0]?.replace(/^#+\s*/, "") ?? description,
    files,
    risks,
    raw_xml: planRaw,
  };
  state = transition(state, "planned");
  writeTaskState(cwd, state);

  // Output
  console.log("");
  console.log("## 计划");
  console.log(planRaw);
  console.log("");
  if (files.length > 0) {
    console.log("### 涉及文件");
    for (const f of files) console.log(`- ${f}`);
    console.log("");
  }
  if (risks.length > 0) {
    console.log("### 风险");
    for (const r of risks) console.log(`- ${r}`);
    console.log("");
  }
  console.log("→ 下一步: dsh patch");
}

