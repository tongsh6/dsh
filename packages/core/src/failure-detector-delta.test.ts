import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectFailures } from "./failure-detector.js";
import type { DetectParams } from "./failure-detector.js";

describe("detectFailures - Error Delta Tracking", () => {
  it("detects regression when error count increases", () => {
    const params: DetectParams = {
      response: "",
      planFiles: [],
      actualChangedFiles: [],
      verifyOutput: "[ERROR] Foo.java:[10,5] err1\n[ERROR] Foo.java:[20,5] err2",
      prevVerifyOutput: "[ERROR] Foo.java:[10,5] err1", // was 1 error
      patchApplyError: null,
    };
    const detections = detectFailures(params);
    const de = detections.find((d) => d.mode === "compilation-error");
    assert.ok(de);
    assert.ok(de!.evidence.includes("REGRESSION: Last patch introduced 1 NEW error(s)"));
    assert.ok(de!.repairHint.includes("consider REVERTING"));
  });

  it("detects progress when error count decreases", () => {
    const params: DetectParams = {
      response: "",
      planFiles: [],
      actualChangedFiles: [],
      verifyOutput: "[ERROR] Foo.java:[10,5] err1",
      prevVerifyOutput: "[ERROR] Foo.java:[10,5] err1\n[ERROR] Foo.java:[20,5] err2", // was 2
      patchApplyError: null,
    };
    const detections = detectFailures(params);
    const de = detections.find((d) => d.mode === "compilation-error");
    assert.ok(de);
    assert.ok(de!.evidence.includes("PROGRESS: Fixed 1 error(s)"));
  });

  it("provides specific Java hints for illegal start of type", () => {
    const params: DetectParams = {
      response: "",
      planFiles: [],
      actualChangedFiles: [],
      verifyOutput: "[ERROR] /path/to/Service.java:[45,1] 非法的类型开始",
      patchApplyError: null,
    };
    const detections = detectFailures(params);
    const de = detections.find((d) => d.mode === "compilation-error");
    assert.ok(de);
    assert.ok(de!.repairHint.includes("missing semicolon ';'"));
  });
});
