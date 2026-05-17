import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractTextContent,
  extractThinkingContent,
  extractToolCalls,
  normalizeStreamDelta,
  normalizeUsage,
  normalizeResponse,
} from "./normalizer.js";
import type { DeepSeekResponse } from "./client.js";

const makeResponse = (overrides?: Partial<DeepSeekResponse>): DeepSeekResponse => ({
  id: "r1",
  object: "chat.completion",
  created: 1,
  model: "deepseek-v4-pro",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello", reasoning_content: "Thinking..." },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    prompt_cache_hit_tokens: 80,
    prompt_cache_miss_tokens: 20,
    completion_tokens_details: {
      reasoning_tokens: 20,
    },
  },
  ...overrides,
});

describe("extractTextContent", () => {
  it("returns message content", () => {
    const res = makeResponse();
    assert.equal(extractTextContent(res), "Hello");
  });

  it("returns empty string when no choices", () => {
    const res = makeResponse({ choices: [] });
    assert.equal(extractTextContent(res), "");
  });
});

describe("extractThinkingContent", () => {
  it("returns reasoning_content when present", () => {
    const res = makeResponse();
    assert.equal(extractThinkingContent(res), "Thinking...");
  });

  it("returns null when no reasoning_content", () => {
    const res = makeResponse({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hi" },
          finish_reason: "stop",
        },
      ],
    });
    assert.equal(extractThinkingContent(res), null);
  });
});

describe("extractToolCalls", () => {
  it("returns tool calls without parsing or dropping arguments", () => {
    const res = makeResponse({
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: "{\"path\":\"src/a.ts\"}",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });

    assert.deepEqual(extractToolCalls(res), [
      {
        id: "call_1",
        type: "function",
        function: {
          name: "read_file",
          arguments: "{\"path\":\"src/a.ts\"}",
        },
      },
    ]);
  });
});

describe("normalizeUsage", () => {
  it("normalizes token counts", () => {
    const usage = normalizeUsage({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_cache_hit_tokens: 8,
      prompt_cache_miss_tokens: 2,
      completion_tokens_details: {
        reasoning_tokens: 3,
      },
    });
    assert.deepEqual(usage, {
      prompt: 10,
      completion: 5,
      total: 15,
      cacheHit: 8,
      cacheMiss: 2,
      reasoning: 3,
      cacheHitRatio: 0.8,
    });
  });

  it("defaults missing usage fields to 0", () => {
    const usage = normalizeUsage({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
    assert.equal(usage.prompt, 10);
    assert.equal(usage.reasoning, 0);
    assert.equal(usage.cacheHit, 0);
    assert.equal(usage.cacheMiss, 0);
    assert.equal(usage.cacheHitRatio, 0);
  });

  it("does not crash when usage is missing", () => {
    const usage = normalizeUsage(undefined);
    assert.deepEqual(usage, {
      prompt: 0,
      completion: 0,
      total: 0,
      cacheHit: 0,
      cacheMiss: 0,
      reasoning: 0,
      cacheHitRatio: 0,
    });
  });
});

describe("normalizeResponse", () => {
  it("returns structured NormalizedResponse", () => {
    const res = makeResponse();
    const nr = normalizeResponse(res);
    assert.equal(nr.content, "Hello");
    assert.equal(nr.thinkingContent, "Thinking...");
    assert.deepEqual(nr.toolCalls, []);
    assert.deepEqual(nr.message, {
      content: "Hello",
      reasoningContent: "Thinking...",
      toolCalls: [],
    });
    assert.equal(nr.finishReason, "stop");
    assert.deepEqual(nr.usage, {
      prompt: 100,
      completion: 50,
      total: 150,
      cacheHit: 80,
      cacheMiss: 20,
      reasoning: 20,
      cacheHitRatio: 0.8,
    });
  });
});

describe("normalizeStreamDelta", () => {
  it("keeps content and reasoning deltas separate", () => {
    const delta = normalizeStreamDelta({
      id: "s1",
      object: "chat.completion.chunk",
      created: 1,
      model: "deepseek-v4-pro",
      choices: [
        {
          index: 0,
          delta: { content: "final", reasoning_content: "think" },
          finish_reason: null,
        },
      ],
    });

    assert.deepEqual(delta, {
      content: "final",
      reasoningContent: "think",
      finishReason: null,
    });
  });
});
