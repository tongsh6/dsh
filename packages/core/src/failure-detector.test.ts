import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectFailures, buildRepairHints } from "./failure-detector.js";
import type { DetectParams } from "./failure-detector.js";

describe("detectFailures", () => {
  describe("overconfidence", () => {
    it("detects empty VERIFY block", () => {
      const params: DetectParams = {
        response: `<PLAN>fix</PLAN><VERIFY>\n\n</VERIFY><RISKS>- risk1</RISKS>`,
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "overconfidence"));
    });

    it("detects verify block with only comments", () => {
      const params: DetectParams = {
        response: `<VERIFY>\n# TODO: add tests\n# will do later\n</VERIFY><RISKS>- risk</RISKS>`,
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "overconfidence"));
    });

    it("sets high confidence when RISKS is trivial too", () => {
      const params: DetectParams = {
        response: `<VERIFY>\n</VERIFY><RISKS>无风险</RISKS>`,
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      const oc = detections.find((d) => d.mode === "overconfidence");
      assert.ok(oc);
      assert.equal(oc!.confidence, "high");
    });

    it("detects trivial risks with failed verification", () => {
      const params: DetectParams = {
        response: `<VERIFY>npm test</VERIFY><RISKS>无需担心</RISKS>`,
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "FAIL: 3 tests failed",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "overconfidence"));
    });

    it("does not flag when verify block has real commands", () => {
      const params: DetectParams = {
        response: `<VERIFY>\nnpm test\nnpx tsc --noEmit\n</VERIFY><RISKS>- real risk</RISKS>`,
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(!detections.some((d) => d.mode === "overconfidence"));
    });
  });

  describe("patch-drift", () => {
    it("detects patch apply failure", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: "Failed to apply patch to src/file.ts",
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "patch-drift"));
    });

    it("high confidence on hunk error", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: "patch apply failed: hunk mismatch",
      };
      const detections = detectFailures(params);
      const drift = detections.find((d) => d.mode === "patch-drift");
      assert.ok(drift);
      assert.equal(drift!.confidence, "high");
    });

    it("does not flag without patch error", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(!detections.some((d) => d.mode === "patch-drift"));
    });
  });

  describe("scope-creep", () => {
    it("detects extra files modified beyond plan", () => {
      const params: DetectParams = {
        response: "",
        planFiles: ["src/a.ts", "src/b.ts"],
        actualChangedFiles: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "scope-creep"));
    });

    it("high confidence when >2 extra files", () => {
      const params: DetectParams = {
        response: "",
        planFiles: ["src/a.ts"],
        actualChangedFiles: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      const creep = detections.find((d) => d.mode === "scope-creep");
      assert.ok(creep);
      assert.equal(creep!.confidence, "high");
    });

    it("does not flag when files match plan", () => {
      const params: DetectParams = {
        response: "",
        planFiles: ["src/a.ts", "src/b.ts"],
        actualChangedFiles: ["src/a.ts", "src/b.ts"],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(!detections.some((d) => d.mode === "scope-creep"));
    });
  });

  describe("rule-blindness", () => {
    it("detects lint/type errors in verify output", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "error TS2345: Type 'string' is not assignable to type 'number'.",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "rule-blindness"));
    });

    it("detects ESLint failures", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "✘ eslint src/ - found 5 errors",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "rule-blindness"));
    });

    it("high confidence on import errors", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "Error: Cannot find module './nonexistent'",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      const blindness = detections.find((d) => d.mode === "rule-blindness");
      assert.ok(blindness);
      assert.equal(blindness!.confidence, "high");
    });

    it("does not flag without verify output", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(!detections.some((d) => d.mode === "rule-blindness"));
    });
  });

  describe("hallucinated-api", () => {
    it("detects 'is not defined' errors", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "ReferenceError: fetchUserData is not defined",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "hallucinated-api"));
    });

    it("detects 'has no exported member' errors", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "error TS2305: Module './utils' has no exported member 'parseJson'.",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "hallucinated-api"));
    });

    it("detects 'does not exist on type' errors", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "error TS2339: Property 'validate' does not exist on type 'User'.",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "hallucinated-api"));
    });

    it("detects 'is not a function' errors", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "TypeError: user.getEmail is not a function",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "hallucinated-api"));
    });

    it("does not flag on normal test failures", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "FAIL: expected 5 but got 3",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(!detections.some((d) => d.mode === "hallucinated-api"));
    });
  });

  describe("multiple failure modes", () => {
    it("detects multiple modes simultaneously", () => {
      const params: DetectParams = {
        response: `<VERIFY>\n# skip\n</VERIFY><RISKS>不适用</RISKS>`,
        planFiles: ["src/a.ts"],
        actualChangedFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
        verifyOutput: "ReferenceError: newHelper is not defined\n✘ eslint",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      const modes = detections.map((d) => d.mode);
      // Should detect: overconfidence, scope-creep, rule-blindness, hallucinated-api
      assert.ok(modes.includes("overconfidence"));
      assert.ok(modes.includes("scope-creep"));
      assert.ok(modes.includes("rule-blindness"));
      assert.ok(modes.includes("hallucinated-api"));
    });
  });
});

describe("buildRepairHints", () => {
  it("returns null for empty detections", () => {
    assert.equal(buildRepairHints([]), null);
  });

  it("builds hints with failure pattern analysis header", () => {
    const hints = buildRepairHints([
      {
        mode: "overconfidence",
        description: "test",
        confidence: "high",
        evidence: "empty verify",
        repairHint: "Add verify commands.",
      },
    ]);
    assert.ok(hints?.includes("FAILURE PATTERN ANALYSIS"));
    assert.ok(hints?.includes("overconfidence"));
    assert.ok(hints?.includes("high confidence"));
  });

  it("puts high confidence patterns first", () => {
    const hints = buildRepairHints([
      {
        mode: "scope-creep",
        description: "",
        confidence: "medium",
        evidence: "",
        repairHint: "scope hint",
      },
      {
        mode: "hallucinated-api",
        description: "",
        confidence: "high",
        evidence: "",
        repairHint: "api hint",
      },
    ]);
    assert.ok(hints !== null);
    const highIdx = hints!.indexOf("hallucinated-api");
    const mediumIdx = hints!.indexOf("scope-creep");
    assert.ok(highIdx < mediumIdx, "high confidence should appear before medium");
  });

  it("includes repair hints for each detection", () => {
    const hints = buildRepairHints([
      {
        mode: "patch-drift",
        description: "",
        confidence: "high",
        evidence: "hunk mismatch",
        repairHint: "Use correct line numbers.",
      },
    ]);
    assert.ok(hints?.includes("Use correct line numbers."));
  });
});
