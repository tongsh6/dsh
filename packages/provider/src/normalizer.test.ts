import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractTextContent,
  extractThinkingContent,
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
    reasoning_tokens: 20,
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

describe("normalizeUsage", () => {
  it("normalizes token counts", () => {
    const usage = normalizeUsage({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      reasoning_tokens: 3,
    });
    assert.deepEqual(usage, { prompt: 10, completion: 5, total: 15, reasoning: 3 });
  });

  it("defaults reasoning to 0", () => {
    const usage = normalizeUsage({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
    assert.equal(usage.reasoning, 0);
  });
});

describe("normalizeResponse", () => {
  it("returns structured NormalizedResponse", () => {
    const res = makeResponse();
    const nr = normalizeResponse(res);
    assert.equal(nr.content, "Hello");
    assert.equal(nr.thinkingContent, "Thinking...");
    assert.equal(nr.finishReason, "stop");
    assert.deepEqual(nr.usage, { prompt: 100, completion: 50, total: 150, reasoning: 20 });
  });
});
