import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  buildUserMessage,
  buildMessages,
  estimateTokens,
} from "./prompt-builder.js";
import type { ContextLayers } from "./context-builder.js";

function makeLayers(overrides?: Partial<ContextLayers>): ContextLayers {
  return {
    base: "# Project Rules\n- Keep it simple",
    repo: "## Repo\ntree:\nsrc/\n  index.ts\n  utils.ts",
    task: "## Task\nFix the bug in utils.ts",
    dynamic: null,
    estimatedTokens: 150,
    ...overrides,
  };
}

describe("buildSystemPrompt", () => {
  it("returns v0.4 loop prompt for patch phase", () => {
    const prompt = buildSystemPrompt("patch");
    assert.ok(prompt.includes("PATCH LOOP MODE"));
    assert.ok(prompt.includes("Loop Protocol"));
    assert.ok(prompt.includes("<DONE/>"));
    assert.ok(prompt.includes("After-Apply Feedback"));
  });

  it("returns plan prompt (unchanged)", () => {
    const prompt = buildSystemPrompt("plan");
    assert.ok(prompt.includes("PLAN>"));
    assert.ok(!prompt.includes("Loop Protocol"));
    assert.ok(!prompt.includes("PATCH LOOP MODE"));
  });

  it("returns repair prompt (unchanged)", () => {
    const prompt = buildSystemPrompt("repair");
    assert.ok(prompt.includes("REPAIR MODE"));
    assert.ok(!prompt.includes("Loop Protocol"));
  });
});

describe("buildUserMessage", () => {
  it("includes all context layers and task description", () => {
    const layers = makeLayers();
    const msg = buildUserMessage({ context: layers, taskDescription: "Fix the bug" });
    assert.ok(msg.includes("## Base Context"));
    assert.ok(msg.includes("## Repo Context"));
    assert.ok(msg.includes("## Task Context"));
    assert.ok(msg.includes("## Task"));
    assert.ok(msg.includes("Fix the bug"));
  });

  it("includes dynamic context when present", () => {
    const layers = makeLayers({ dynamic: "## Round 1\nFailed: patch apply error" });
    const msg = buildUserMessage({ context: layers, taskDescription: "Fix the bug" });
    assert.ok(msg.includes("## Dynamic Context"));
    assert.ok(msg.includes("Failed: patch apply error"));
  });

  it("excludes dynamic context section when null", () => {
    const layers = makeLayers({ dynamic: null });
    const msg = buildUserMessage({ context: layers, taskDescription: "Fix the bug" });
    assert.ok(!msg.includes("Dynamic Context"));
  });
});

describe("buildMessages", () => {
  it("returns system + user message pair", () => {
    const layers = makeLayers();
    const msgs = buildMessages({ context: layers, taskDescription: "test" });
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0]!.role, "system");
    assert.equal(msgs[1]!.role, "user");
  });

  it("uses patch prompt by default", () => {
    const layers = makeLayers();
    const msgs = buildMessages({ context: layers, taskDescription: "test" });
    assert.ok(msgs[0]!.content.includes("PATCH LOOP MODE"));
  });
});

describe("estimateTokens", () => {
  it("estimates ~4 characters per token", () => {
    assert.ok(estimateTokens("Hello, world!") > 0);
    assert.equal(estimateTokens(""), 0);
  });

  it("returns integer ceiling", () => {
    const tokens = estimateTokens("123");
    assert.equal(tokens, 1); // ceil(3/3.5) = 1
  });
});
