import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPlanFileContract } from "./plan-file-contract.js";
import { validatePatchCoverage, computeCoverageDelta } from "./patch-coverage.js";

describe("validatePatchCoverage", () => {
  it("does not require coverage for context files", () => {
    const contract = buildPlanFileContract({
      file_contract: {
        requiredTargetFiles: ["a.ts"],
        contextFiles: ["b.ts"],
      },
    });
    const result = validatePatchCoverage({ contract, appliedChangedFiles: ["a.ts"] });
    assert.equal(result.fullRequiredCoverage, true);
    assert.deepEqual(result.missingRequiredFiles, []);
  });

  it("does not let a missing optional file block full required coverage", () => {
    const contract = buildPlanFileContract({
      file_contract: {
        requiredTargetFiles: ["a.ts"],
        optionalTargetFiles: ["b.ts"],
      },
    });
    const result = validatePatchCoverage({ contract, appliedChangedFiles: ["a.ts"] });
    assert.equal(result.fullRequiredCoverage, true);
    assert.deepEqual(result.missingOptionalFiles, ["b.ts"]);
  });

  it("reports missing required files when not all are applied", () => {
    const contract = buildPlanFileContract({ files: ["a.ts", "c.ts"] });
    const result = validatePatchCoverage({ contract, appliedChangedFiles: ["a.ts"] });
    assert.equal(result.fullRequiredCoverage, false);
    assert.deepEqual(result.coveredRequiredFiles, ["a.ts"]);
    assert.deepEqual(result.missingRequiredFiles, ["c.ts"]);
  });

  it("records touched context and covered optional files", () => {
    const contract = buildPlanFileContract({
      file_contract: {
        requiredTargetFiles: ["a.ts"],
        optionalTargetFiles: ["b.ts"],
        contextFiles: ["c.ts"],
      },
    });
    const result = validatePatchCoverage({
      contract,
      appliedChangedFiles: ["a.ts", "b.ts", "c.ts"],
    });
    assert.deepEqual(result.coveredOptionalFiles, ["b.ts"]);
    assert.deepEqual(result.touchedContextFiles, ["c.ts"]);
  });

  it("normalizes applied paths before matching contract paths", () => {
    const contract = buildPlanFileContract({ files: ["dir/a.ts"] });
    const result = validatePatchCoverage({
      contract,
      appliedChangedFiles: ["./dir/a.ts"],
    });
    assert.equal(result.fullRequiredCoverage, true);
  });

  it("never marks a legacy contract strict-failure eligible", () => {
    const contract = buildPlanFileContract({ files: ["a.ts", "b.ts"] });
    const result = validatePatchCoverage({ contract, appliedChangedFiles: [] });
    assert.equal(result.strictFailureEligible, false);
  });

  it("marks an explicit_v2 all-high-confidence contract strict-failure eligible", () => {
    const contract = buildPlanFileContract({
      file_contract: {
        requiredTargetFiles: [
          { path: "a.ts", confidence: "high" },
          { path: "b.ts", confidence: "high" },
        ],
      },
    });
    const result = validatePatchCoverage({ contract, appliedChangedFiles: [] });
    assert.equal(result.strictFailureEligible, true);
  });

  it("is not strict-failure eligible when any required entry is below high confidence", () => {
    const contract = buildPlanFileContract({
      file_contract: {
        requiredTargetFiles: [
          { path: "a.ts", confidence: "high" },
          { path: "b.ts", confidence: "medium" },
        ],
      },
    });
    const result = validatePatchCoverage({ contract, appliedChangedFiles: [] });
    assert.equal(result.strictFailureEligible, false);
  });

  it("is not strict-failure eligible when there are no required files", () => {
    const contract = buildPlanFileContract({ files: [] });
    const result = validatePatchCoverage({ contract, appliedChangedFiles: [] });
    assert.equal(result.strictFailureEligible, false);
  });
});

describe("computeCoverageDelta", () => {
  it("is empty when re-editing an already-covered file", () => {
    const delta = computeCoverageDelta(["a.ts"], new Set(["c.ts"]));
    assert.deepEqual([...delta], []);
  });

  it("is empty when an applied file is not in the plan", () => {
    const delta = computeCoverageDelta(["helper.ts"], new Set(["c.ts"]));
    assert.deepEqual([...delta], []);
  });

  it("returns a required file that this round newly covered", () => {
    const delta = computeCoverageDelta(["c.ts"], new Set(["c.ts"]));
    assert.deepEqual([...delta], ["c.ts"]);
  });

  it("normalizes applied paths before matching missing required files", () => {
    const delta = computeCoverageDelta(["./c.ts"], new Set(["c.ts"]));
    assert.deepEqual([...delta], ["c.ts"]);
  });
});
