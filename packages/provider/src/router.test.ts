import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classify } from "./router.js";

describe("classify", () => {
  it("routes plan to Pro with thinking", () => {
    const r = classify({ command: "plan" });
    assert.equal(r.model, "deepseek-v4-pro");
    assert.equal(r.thinking, true);
  });

  it("routes patch/single to Flash with thinking", () => {
    const r = classify({ command: "patch", fileCount: 2 });
    assert.equal(r.model, "deepseek-v4-flash");
    assert.equal(r.thinking, true);
  });

  it("routes patch/multi (>3 files) to Pro with thinking", () => {
    const r = classify({ command: "patch", fileCount: 5 });
    assert.equal(r.model, "deepseek-v4-pro");
    assert.equal(r.thinking, true);
  });

  it("routes verify to Flash without thinking", () => {
    const r = classify({ command: "verify" });
    assert.equal(r.model, "deepseek-v4-flash");
    assert.equal(r.thinking, false);
  });

  it("routes repair to Pro with thinking", () => {
    const r = classify({ command: "repair" });
    assert.equal(r.model, "deepseek-v4-pro");
    assert.equal(r.thinking, true);
  });

  it("routes handoff to Flash without thinking", () => {
    const r = classify({ command: "handoff" });
    assert.equal(r.model, "deepseek-v4-flash");
    assert.equal(r.thinking, false);
  });

  it("routes init/scan to Flash without thinking", () => {
    const r = classify({ command: "init/scan" });
    assert.equal(r.model, "deepseek-v4-flash");
    assert.equal(r.thinking, false);
  });

  it("routes init/rule-detect to Pro with thinking", () => {
    const r = classify({ command: "init/rule-detect" });
    assert.equal(r.model, "deepseek-v4-pro");
    assert.equal(r.thinking, true);
  });

  it("allows model routing overrides", () => {
    const plan = classify({ command: "plan" }, { planModel: "custom-plan" });
    const patchSmall = classify({ command: "patch", fileCount: 1 }, { patchSmallModel: "custom-small" });
    const patchLarge = classify({ command: "patch", fileCount: 5 }, { patchLargeModel: "custom-large" });

    assert.equal(plan.model, "custom-plan");
    assert.equal(patchSmall.model, "custom-small");
    assert.equal(patchLarge.model, "custom-large");
  });
});
