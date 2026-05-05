// 诊断 DeepSeek API 是否返回 tool_calls。
// 用法: ./packages/core/node_modules/.bin/tsx scripts/diagnose-tool-calls.ts

import { DeepSeekClient } from "../packages/provider/dist/client.js";
import { readApiKey } from "../packages/repo/dist/config-loader.js";
import { ALL_TOOL_DEFINITIONS } from "../packages/core/dist/tool-definitions.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const apiKey = process.env["DEEPSEEK_API_KEY"] ?? readApiKey(projectRoot) ?? "";
if (!apiKey) {
  console.error("DEEPSEEK_API_KEY not set and not in .dsh/config.yml");
  process.exit(1);
}

const client = new DeepSeekClient({ apiKey });

const messages = [
  {
    role: "system" as const,
    content:
      "You are a coding agent with access to tools. Use the read_file tool to read files when asked. Do not guess.",
  },
  {
    role: "user" as const,
    content:
      "Use the read_file tool to read the file at path 'packages/cli/src/main.ts', then tell me how many lines it has. You MUST use read_file — do not guess.",
  },
];

async function probe(label: string, withTools: boolean, withThinking: boolean) {
  const t0 = Date.now();
  const res = await client.chat({
    model: "deepseek-v4-pro",
    messages,
    thinking: withThinking,
    tools: withTools ? (ALL_TOOL_DEFINITIONS as unknown as Record<string, unknown>[]) : undefined,
  });
  const elapsed = Date.now() - t0;
  const choice = res.choices[0];
  const msg = choice?.message;
  console.log(`\n=== ${label} (tools=${withTools}, thinking=${withThinking}, ${elapsed}ms) ===`);
  console.log(`finish_reason: ${choice?.finish_reason}`);
  console.log(`tool_calls: ${msg?.tool_calls ? JSON.stringify(msg.tool_calls, null, 2) : "(none)"}`);
  console.log(`content (len=${msg?.content?.length ?? 0}):`);
  console.log((msg?.content ?? "").slice(0, 600));
  if (msg?.reasoning_content) {
    console.log(`reasoning_content (len=${msg.reasoning_content.length}, first 200):`);
    console.log(msg.reasoning_content.slice(0, 200));
  }
  console.log(`usage:`, res.usage);
}

console.log("Probing DeepSeek API tool-calls behavior...\n");
console.log(`Model: deepseek-v4-pro`);
console.log(`Tool count: ${ALL_TOOL_DEFINITIONS.length}`);

await probe("A: tools + thinking", true, true);
await probe("B: tools, no thinking", true, false);
await probe("C: no tools, thinking", false, true);
