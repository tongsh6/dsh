import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EVIDENCE_POLICIES,
  FAILURE_STATUSES,
  FAILURE_TYPES,
  loadFailureMatrix,
  summarizeFailureMatrix,
} from "./failure-matrix.js";

describe("failure matrix", () => {
  it("loads the machine-readable failure matrix", () => {
    const matrix = loadFailureMatrix();
    assert.equal(matrix.version, 1);
    assert.match(matrix.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(matrix.entries.length > 0);

    for (const entry of matrix.entries) {
      assert.ok(entry.fixture, "fixture is required");
      assert.ok(entry.repo, `${entry.fixture}: repo is required`);
      assert.ok(FAILURE_TYPES.includes(entry.failureType), `${entry.fixture}: invalid failureType`);
      assert.ok(FAILURE_STATUSES.includes(entry.status), `${entry.fixture}: invalid status`);
      assert.ok(entry.lastEvidence, `${entry.fixture}: lastEvidence is required`);
      assert.ok(entry.notes, `${entry.fixture}: notes are required`);
      if (entry.governance?.evidencePolicy) {
        assert.ok(
          EVIDENCE_POLICIES.includes(entry.governance.evidencePolicy),
          `${entry.fixture}: invalid evidence policy`,
        );
      }
      if (entry.governance?.comparabilityRisk) {
        assert.ok(
          entry.governance.evidencePolicy,
          `${entry.fixture}: comparability risk requires an evidence policy`,
        );
      }
    }
  });

  it("summarizes governance categories for benchmark metadata", () => {
    const summary = summarizeFailureMatrix(loadFailureMatrix());
    assert.equal(summary.total > 0, true);
    assert.equal(summary.fixedPendingReplication > 0, true);
    assert.equal(summary.highVariance > 0, true);
    assert.equal(summary.confirmedStable > 0, true);
    assert.equal(summary.comparabilityRisk, 6);
    assert.equal(summary.labelRequired, 6);
    assert.equal(summary.phase3ExitExcluded > 0, true);
  });
});
