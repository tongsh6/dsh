import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DeepSeekClient, DeepSeekRequest, DeepSeekResponse } from "@dsh/provider";
import { runAgentTurnLoop, getToolPolicy } from "./agent-turn-loop.js";
import { ALL_TOOL_DEFINITIONS } from "./tool-definitions.js";
import type { ToolDefinition } from "./tool-definitions.js";

function response(message: DeepSeekResponse["choices"][number]["message"], finishReason: DeepSeekResponse["choices"][number]["finish_reason"] = "stop"): DeepSeekResponse {
  return {
    id: "r1",
    object: "chat.completion",
    created: 1,
    model: "deepseek-v4-pro",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_cache_hit_tokens: 8,
      prompt_cache_miss_tokens: 2,
      completion_tokens_details: { reasoning_tokens: 3 },
    },
  };
}

function mockClient(responses: DeepSeekResponse[], seen: DeepSeekRequest[] = []): DeepSeekClient {
  let index = 0;
  return {
    chat: async (req: DeepSeekRequest) => {
      seen.push(req);
      const next = responses[Math.min(index, responses.length - 1)];
      index++;
      return next!;
    },
  } as unknown as DeepSeekClient;
}

describe("runAgentTurnLoop", () => {
  it("allows only read tools in plan phase", async () => {
    const seen: DeepSeekRequest[] = [];
    const client = mockClient([
      response({ role: "assistant", content: "done" }),
    ], seen);

    await runAgentTurnLoop({
      client,
      messages: [{ role: "user", content: "plan" }],
      model: "deepseek-v4-pro",
      thinking: true,
      tools: ALL_TOOL_DEFINITIONS,
      toolPolicy: getToolPolicy("plan"),
      maxToolRounds: 1,
    });

    const names = ((seen[0]!.tools ?? []) as ToolDefinition[]).map((tool) => String(tool.function.name)).sort();
    assert.deepEqual(names, ["grep_files", "read_file"]);
  });

  it("allows exec_shell in repair phase", async () => {
    const seen: DeepSeekRequest[] = [];
    const client = mockClient([
      response({ role: "assistant", content: "done" }),
    ], seen);

    await runAgentTurnLoop({
      client,
      messages: [{ role: "user", content: "repair" }],
      model: "deepseek-v4-pro",
      thinking: true,
      tools: ALL_TOOL_DEFINITIONS,
      toolPolicy: getToolPolicy("repair"),
      maxToolRounds: 1,
    });

    const names = ((seen[0]!.tools ?? []) as ToolDefinition[]).map((tool) => String(tool.function.name)).sort();
    assert.deepEqual(names, ["exec_shell", "grep_files", "read_file"]);
  });

  it("does not pass tools in verify phase", async () => {
    const seen: DeepSeekRequest[] = [];
    const client = mockClient([
      response({ role: "assistant", content: "done" }),
    ], seen);

    await runAgentTurnLoop({
      client,
      messages: [{ role: "user", content: "verify" }],
      model: "deepseek-v4-flash",
      thinking: false,
      tools: ALL_TOOL_DEFINITIONS,
      toolPolicy: getToolPolicy("verify"),
      maxToolRounds: 1,
    });

    assert.equal(seen[0]!.tools, undefined);
  });

  it("exposes apply_patch only when patch native edits are explicitly enabled", () => {
    assert.deepEqual(getToolPolicy("patch").allowedTools, ["read_file", "grep_files"]);
    assert.deepEqual(
      getToolPolicy("patch", { editsAsNativeTool: true }).allowedTools,
      ["read_file", "grep_files", "apply_patch"],
    );
  });

  it("appends tool result messages with the matching tool_call_id", async () => {
    const client = mockClient([
      response({
        role: "assistant",
        content: "",
        reasoning_content: "need to read",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"a.ts"}' },
        }],
      }, "tool_calls"),
      response({ role: "assistant", content: "final" }),
    ]);

    const result = await runAgentTurnLoop({
      client,
      messages: [{ role: "user", content: "patch" }],
      model: "deepseek-v4-pro",
      thinking: true,
      tools: ALL_TOOL_DEFINITIONS,
      toolPolicy: getToolPolicy("patch"),
      maxToolRounds: 2,
      toolExecutor: async (_name, _args, callId) => ({
        callId,
        status: "success",
        content: "file content",
      }),
    });

    const assistantWithTool = result.messages.find((message) => message.role === "assistant" && message.tool_calls);
    const toolMessage = result.messages.find((message) => message.role === "tool");
    assert.equal(assistantWithTool?.reasoning_content, "need to read");
    assert.equal(toolMessage?.tool_call_id, "call_1");
    assert.equal(result.toolRounds, 1);
  });

  it("returns a tool error on invalid JSON arguments instead of using empty args", async () => {
    const client = mockClient([
      response({
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_bad",
          type: "function",
          function: { name: "read_file", arguments: '{"path":' },
        }],
      }, "tool_calls"),
      response({ role: "assistant", content: "final" }),
    ]);

    const result = await runAgentTurnLoop({
      client,
      messages: [{ role: "user", content: "patch" }],
      model: "deepseek-v4-pro",
      thinking: true,
      tools: ALL_TOOL_DEFINITIONS,
      toolPolicy: getToolPolicy("patch"),
      maxToolRounds: 2,
    });

    const toolMessage = result.messages.find((message) => message.role === "tool");
    assert.ok(toolMessage?.content.includes("Invalid tool arguments"));
    assert.ok(toolMessage?.content.includes("Invalid tool arguments JSON"));
  });

  it("blocks tools outside the active policy", async () => {
    const client = mockClient([
      response({
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_shell",
          type: "function",
          function: { name: "exec_shell", arguments: '{"command":"pnpm test"}' },
        }],
      }, "tool_calls"),
      response({ role: "assistant", content: "final" }),
    ]);

    const result = await runAgentTurnLoop({
      client,
      messages: [{ role: "user", content: "patch" }],
      model: "deepseek-v4-pro",
      thinking: true,
      tools: ALL_TOOL_DEFINITIONS,
      toolPolicy: getToolPolicy("patch"),
      maxToolRounds: 2,
    });

    const toolMessage = result.messages.find((message) => message.role === "tool");
    assert.ok(toolMessage?.content.includes("not allowed during patch"));
  });

  it("enforces maxToolRounds", async () => {
    const client = mockClient([
      response({
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"a.ts"}' },
        }],
      }, "tool_calls"),
      response({
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "call_2",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"b.ts"}' },
        }],
      }, "tool_calls"),
    ]);

    await assert.rejects(
      () =>
        runAgentTurnLoop({
          client,
          messages: [{ role: "user", content: "patch" }],
          model: "deepseek-v4-pro",
          thinking: true,
          tools: ALL_TOOL_DEFINITIONS,
          toolPolicy: getToolPolicy("patch"),
          maxToolRounds: 1,
          toolExecutor: async (_name, _args, callId) => ({
            callId,
            status: "success",
            content: "file content",
          }),
        }),
      /maxToolRounds exceeded/,
    );
  });
});
