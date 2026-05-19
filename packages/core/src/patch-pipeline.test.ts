import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shouldEnterCoverageFinalization,
  decidePatchStatus,
  type PatchLoopState,
} from "./patch-pipeline.js";
import { canTransition } from "./task-state.js";

function loopState(over: Partial<PatchLoopState> = {}): PatchLoopState {
  return {
    round: 5,
    maxRounds: 30,
    hasStartedPatching: true,
    coveredRequiredFiles: new Set<string>(),
    missingRequiredFiles: new Set<string>(["c.ts"]),
    invalidStreak: 0,
    consecutiveToolsOnly: 0,
    roundsSinceCoverageProgress: 0,
    validChangesWithoutCoverageProgress: 0,
    coverageFinalizationAttempted: false,
    modelSaidDoneWithMissing: false,
    ...over,
  };
}

describe("shouldEnterCoverageFinalization", () => {
  it("is false when there are no missing required files", () => {
    assert.equal(
      shouldEnterCoverageFinalization(loopState({ missingRequiredFiles: new Set() })),
      false,
    );
  });

  it("is false once finalization has already been attempted", () => {
    assert.equal(
      shouldEnterCoverageFinalization(
        loopState({ coverageFinalizationAttempted: true, roundsSinceCoverageProgress: 99 }),
      ),
      false,
    );
  });

  it("is true when the model said DONE with missing required files", () => {
    assert.equal(
      shouldEnterCoverageFinalization(loopState({ modelSaidDoneWithMissing: true })),
      true,
    );
  });

  it("is true when too many rounds passed without coverage progress", () => {
    assert.equal(
      shouldEnterCoverageFinalization(loopState({ roundsSinceCoverageProgress: 5 })),
      true,
    );
  });

  it("is true when valid changes keep landing without covering a required file", () => {
    assert.equal(
      shouldEnterCoverageFinalization(loopState({ validChangesWithoutCoverageProgress: 2 })),
      true,
    );
  });

  it("is true on a long tools-only stall after patching started", () => {
    assert.equal(
      shouldEnterCoverageFinalization(loopState({ consecutiveToolsOnly: 8 })),
      true,
    );
  });

  it("is true when few rounds remain", () => {
    assert.equal(shouldEnterCoverageFinalization(loopState({ round: 28 })), true);
  });

  it("is true on an invalid streak after patching started", () => {
    assert.equal(shouldEnterCoverageFinalization(loopState({ invalidStreak: 3 })), true);
  });

  it("ignores stall counters before patching has started", () => {
    assert.equal(
      shouldEnterCoverageFinalization(
        loopState({
          hasStartedPatching: false,
          roundsSinceCoverageProgress: 99,
          consecutiveToolsOnly: 99,
          invalidStreak: 99,
        }),
      ),
      false,
    );
  });
});

describe("decidePatchStatus", () => {
  it("fails when no change was applied", () => {
    const d = decidePatchStatus({
      hasOkChanges: false,
      fullRequiredCoverage: false,
      missingRequiredFiles: ["a.ts"],
      strictFailureEligible: false,
      strictGateEnabled: false,
      coverageFinalizationAttempted: false,
    });
    assert.equal(d.status, "patch_failed");
  });

  it("patches when required coverage is full", () => {
    const d = decidePatchStatus({
      hasOkChanges: true,
      fullRequiredCoverage: true,
      missingRequiredFiles: [],
      strictFailureEligible: false,
      strictGateEnabled: false,
      coverageFinalizationAttempted: false,
    });
    assert.equal(d.status, "patched");
    assert.equal(d.coverage, "full");
  });

  it("returns patch_partial when required files are still missing", () => {
    const d = decidePatchStatus({
      hasOkChanges: true,
      fullRequiredCoverage: false,
      missingRequiredFiles: ["c.ts"],
      strictFailureEligible: false,
      strictGateEnabled: false,
      coverageFinalizationAttempted: true,
    });
    assert.equal(d.status, "patch_partial");
    assert.equal(d.coverage, "partial");
  });

  it("does not hard-fail a legacy contract even when the strict gate is enabled", () => {
    const d = decidePatchStatus({
      hasOkChanges: true,
      fullRequiredCoverage: false,
      missingRequiredFiles: ["c.ts"],
      strictFailureEligible: false,
      strictGateEnabled: true,
      coverageFinalizationAttempted: true,
    });
    assert.equal(d.status, "patch_partial");
  });

  it("hard-fails an explicit_v2 high-confidence contract when the strict gate is enabled and finalization was attempted", () => {
    const d = decidePatchStatus({
      hasOkChanges: true,
      fullRequiredCoverage: false,
      missingRequiredFiles: ["c.ts"],
      strictFailureEligible: true,
      strictGateEnabled: true,
      coverageFinalizationAttempted: true,
    });
    assert.equal(d.status, "patch_failed");
  });

  it("does not hard-fail before finalization has been attempted", () => {
    const d = decidePatchStatus({
      hasOkChanges: true,
      fullRequiredCoverage: false,
      missingRequiredFiles: ["c.ts"],
      strictFailureEligible: true,
      strictGateEnabled: true,
      coverageFinalizationAttempted: false,
    });
    assert.equal(d.status, "patch_partial");
  });
});

describe("patch_partial state transitions", () => {
  it("can be reached from planned", () => {
    assert.equal(canTransition("planned", "patch_partial"), true);
  });

  it("routes to repair", () => {
    assert.equal(canTransition("patch_partial", "repairing"), true);
    assert.equal(canTransition("patch_partial", "verification_failed"), true);
  });

  it("never transitions straight to patched", () => {
    assert.equal(canTransition("patch_partial", "patched"), false);
  });
});
