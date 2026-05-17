import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDeepSeekCapability } from "./capability-registry.js";

describe("DeepSeek capability registry", () => {
  it("describes v4 pro coding capabilities", () => {
    const capability = getDeepSeekCapability("deepseek-v4-pro");

    assert.ok(capability);
    assert.equal(capability.thinking, true);
    assert.deepEqual(capability.reasoningEffort, ["high", "max"]);
    assert.equal(capability.toolCalls, true);
    assert.equal(capability.jsonOutput, true);
    assert.equal(capability.strictToolCalls, "experimental");
    assert.equal(capability.chatPrefix, "experimental");
    assert.equal(capability.fim, "experimental");
    assert.equal(capability.maxContextTokens, 1_048_576);
  });

  it("marks legacy aliases as deprecated", () => {
    assert.equal(getDeepSeekCapability("deepseek-chat")?.deprecated, true);
    assert.equal(getDeepSeekCapability("deepseek-reasoner")?.deprecated, true);
  });
});
