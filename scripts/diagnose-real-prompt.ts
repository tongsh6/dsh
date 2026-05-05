// 用真实 PATCH_PROMPT + 简化 user message 复现 benchmark 中工具零调用现象。

import { DeepSeekClient } from "../packages/provider/dist/client.js";
import { readApiKey } from "../packages/repo/dist/config-loader.js";
import { ALL_TOOL_DEFINITIONS } from "../packages/core/dist/tool-definitions.js";
import { buildSystemPrompt } from "../packages/core/dist/prompt-builder.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const apiKey = process.env["DEEPSEEK_API_KEY"] ?? readApiKey(projectRoot) ?? "";
if (!apiKey) { console.error("no api key"); process.exit(1); }
const client = new DeepSeekClient({ apiKey });

const systemPrompt = buildSystemPrompt("patch");
console.log(`PATCH_PROMPT length: ${systemPrompt.length} chars`);

// 仿 loam-bugfix-cli-error-handling 任务描述，但极简化
const taskDesc = `Fix the bug in packages/cli/src/main.ts where errors are not properly logged. Add proper error handling with try/catch. The file is in this project — you should read it first to understand the current code.`;

const userMessage = `## Base Context
project: dsh
language: typescript

## Repo Context
packages/cli/src/main.ts exists.

## Task Context
(file content omitted — use tools to read)

## Your Task
${taskDesc}

Output your response following the protocol above.`;

async function probe(label: string, system: string, user: string) {
  const t0 = Date.now();
  const res = await client.chat({
    model: "deepseek-v4-pro",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    thinking: true,
    tools: ALL_TOOL_DEFINITIONS as unknown as Record<string, unknown>[],
  });
  const elapsed = Date.now() - t0;
  const choice = res.choices[0];
  const msg = choice?.message;
  console.log(`\n=== ${label} (${elapsed}ms) ===`);
  console.log(`finish_reason: ${choice?.finish_reason}`);
  console.log(`tool_calls count: ${msg?.tool_calls?.length ?? 0}`);
  if (msg?.tool_calls?.length) {
    console.log(`first tool_call: ${msg.tool_calls[0]?.function.name}(${msg.tool_calls[0]?.function.arguments})`);
  }
  console.log(`content (len=${msg?.content?.length ?? 0}, first 800):`);
  console.log((msg?.content ?? "").slice(0, 800));
  if (msg?.reasoning_content) {
    console.log(`reasoning (len=${msg.reasoning_content.length}, first 400):`);
    console.log(msg.reasoning_content.slice(0, 400));
  }
}

await probe("Real PATCH_PROMPT + bugfix-like task", systemPrompt, userMessage);
