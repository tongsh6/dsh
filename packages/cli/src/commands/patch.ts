import { DeepSeekClient, classify } from "@dsh/provider";
import { loadRuleContents, detectTechStack, generateRepoContext, rankFiles, loadTopFiles, scanProjectFiles } from "@dsh/repo";
import {
  readTaskState,
  writeTaskState,
  transition,
  buildBaseContext,
  buildRepoContext,
  buildTaskContext,
  buildDynamicContext,
  assembleContext,
  buildMessages,
  parsePatch,
  applyPatch,
} from "@dsh/core";
import * as readline from "node:readline";
import { readConfig } from "../utils/config.js";

interface PatchOptions {
  auto?: boolean;
  dryRun?: boolean;
}

export async function patchCommand(opts: PatchOptions): Promise<void> {
  const cwd = process.cwd();

  let state = readTaskState(cwd);
  if (!state) {
    console.log("错误: 尚未初始化。请先运行 dsh init");
    process.exit(1);
  }

  if (state.status !== "planned" && state.status !== "repairing") {
    console.log(`错误: 当前状态为 ${state.status}，需要 planned 或 repairing`);
    process.exit(1);
  }

  console.log("正在生成 patch...");

  // Build context
  const config = readConfig(cwd);
  const rules = loadRuleContents(cwd);
  const stack = detectTechStack(cwd);
  const repoContext = generateRepoContext(cwd, stack);
  const baseContext = buildBaseContext(rules, config);
  const repoStr = buildRepoContext(repoContext);

  const allFiles = await scanProjectFiles(cwd);
  const ranked = rankFiles(state.task.description, allFiles);
  const taskFiles = loadTopFiles(cwd, ranked, 10);
  const taskContext = buildTaskContext(state, taskFiles);
  const dynamicContext = buildDynamicContext(state.patches, state.verify_results, 2);

  const layers = {
    base: baseContext,
    repo: repoStr,
    task: taskContext,
    dynamic: dynamicContext,
    estimatedTokens: 0,
  };

  // Route
  const fileCount = state.plan?.files?.length ?? 0;
  const target = classify({ command: "patch", fileCount });
  let client: DeepSeekClient;
  try {
    client = DeepSeekClient.fromEnv();
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  console.log(`使用模型: ${target.model} (thinking: ${target.thinking})`);

  const messages = buildMessages({ context: layers, taskDescription: state.task.description });
  const response = await client.chat({
    model: target.model,
    messages,
    thinking: target.thinking,
  });

  const content = response.choices[0]?.message.content ?? "";

  // Parse and validate
  let parsed;
  try {
    parsed = parsePatch(content);
  } catch (e) {
    console.log("错误: patch 解析失败");
    console.log(e instanceof Error ? e.message : String(e));
    console.log("原始响应 (前 1000 字符):");
    console.log(content.slice(0, 1000));
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log("");
    console.log(parsed.patchText);
    console.log("");
    console.log(`→ 将修改 ${parsed.files.length} 个文件 (dry-run)`);
    return;
  }

  if (!opts.auto) {
    console.log("");
    console.log(parsed.patchText);
    console.log("");
    const confirmed = await askUser("→ 应用此 patch? (Y/n): ");
    if (confirmed.toLowerCase() !== "y" && confirmed !== "") {
      console.log("已取消。");
      return;
    }
  }

  const result = applyPatch(cwd, parsed.patchText, false);
  if (!result.success) {
    console.log(`错误: patch 应用失败 — ${result.error}`);
    process.exit(1);
  }

  // Update state
  state.patches.push({
    round: (state.repair_rounds ?? 0) + 1,
    patch: parsed.patchText,
    apply_status: "ok",
    files_changed: result.files,
  });
  state = transition(state, "patched");
  writeTaskState(cwd, state);

  console.log("");
  console.log(`✓ 已修改 ${result.files.length} 个文件`);
  console.log("→ 下一步: dsh verify");
}

function askUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

