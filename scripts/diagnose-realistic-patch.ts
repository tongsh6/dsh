// 复刻 benchmark runPatch 第一次 client.chat 的完整入参，观察模型响应。
// 不修任何业务代码。

import { DeepSeekClient } from "../packages/provider/dist/client.js";
import { readApiKey, loadDshConfig, loadRuleContents, assembleIntelligence, toLegacyTechStack, generateRepoContext, rankFiles, loadTopFiles, scanProjectFiles, writeDshConfig } from "../packages/repo/dist/index.js";
import { ALL_TOOL_DEFINITIONS } from "../packages/core/dist/tool-definitions.js";
import { assembleContext } from "../packages/core/dist/context-builder.js";
import { buildMessages } from "../packages/core/dist/prompt-builder.js";
import { createTaskState } from "../packages/core/dist/task-state.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const apiKey = process.env["DEEPSEEK_API_KEY"] ?? readApiKey(projectRoot) ?? "";
if (!apiKey) { console.error("no api key"); process.exit(1); }
const client = new DeepSeekClient({ apiKey });

const REPO = "/Users/loong/dsh-bench/repos/loamlog";
const TASK_PROMPT = fs.readFileSync(
  path.join(projectRoot, "packages/eval/src/fixtures/loam-bugfix-cli-error-handling.yaml"),
  "utf-8",
);
// crude yaml extract of taskPrompt
const m = TASK_PROMPT.match(/taskPrompt:\s*\|\n([\s\S]*?)(?=\nexpectedFiles:)/);
const taskDescription = (m?.[1] ?? "").replace(/^  /gm, "").trim();
console.log(`taskDescription length: ${taskDescription.length}`);

// Ensure .dsh exists like benchmark does
const intelligence = assembleIntelligence(REPO);
const stack = toLegacyTechStack(REPO, intelligence);
fs.mkdirSync(path.join(REPO, ".dsh"), { recursive: true });
writeDshConfig(REPO, {
  project: { name: "loamlog", language: stack.language, package_manager: stack.packageManager ?? "unknown" },
  verify: { test: "pnpm run typecheck", lint: "", typecheck: "" },
  deepseek: { default_model: "deepseek-v4-pro", flash_model: "deepseek-v4-flash", max_repair_rounds: 2, thinking_default: true },
});

// Mirror buildLayers from pipeline.ts
const config = loadDshConfig(REPO);
const rules = loadRuleContents(REPO);
const repoContext = generateRepoContext(REPO, intelligence);
const state = createTaskState(taskDescription, "bugfix");
const allFiles = await scanProjectFiles(REPO);
const ranked = rankFiles(taskDescription, allFiles);
const taskFiles = loadTopFiles(REPO, ranked, 10);
const layers = assembleContext({ config, rules, repoContext, taskState: state, taskFiles });

const messages = buildMessages({ context: layers, taskDescription, phase: "patch" });
const sysLen = (messages[0]?.content ?? "").length;
const userLen = (messages[1]?.content ?? "").length;
console.log(`messages: system=${sysLen} chars, user=${userLen} chars, total=${sysLen + userLen}`);
console.log(`top file paths in task context (first 10 lines of task layer):`);
console.log(layers.task.split("\n").slice(0, 10).join("\n"));

const t0 = Date.now();
const res = await client.chat({
  model: "deepseek-v4-pro",
  messages,
  thinking: true,
  tools: ALL_TOOL_DEFINITIONS as unknown as Record<string, unknown>[],
});
const elapsed = Date.now() - t0;

const choice = res.choices[0];
const msg = choice?.message;
console.log(`\n=== RESPONSE (${elapsed}ms) ===`);
console.log(`finish_reason: ${choice?.finish_reason}`);
console.log(`tool_calls count: ${msg?.tool_calls?.length ?? 0}`);
if (msg?.tool_calls?.length) {
  for (const tc of msg.tool_calls) {
    console.log(`  ${tc.function.name}(${tc.function.arguments})`);
  }
}
console.log(`content (len=${msg?.content?.length ?? 0}):`);
console.log("---BEGIN content---");
console.log(msg?.content ?? "");
console.log("---END content---");
if (msg?.reasoning_content) {
  console.log(`reasoning (len=${msg.reasoning_content.length}, first 600):`);
  console.log(msg.reasoning_content.slice(0, 600));
}
console.log(`usage:`, res.usage);
