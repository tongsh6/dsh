import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EVIDENCE_POLICIES,
  FAILURE_STATUSES,
  FAILURE_TYPES,
  loadFailureMatrix,
  selectFailureMatrixFixtureGovernance,
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

  it("selects governance metadata for benchmark fixture ids", () => {
    const matrix = loadFailureMatrix();
    const entries = selectFailureMatrixFixtureGovernance(matrix, [
      "missing-fixture",
      "rh-refactor-branch-orchestrator-create",
      "rh-refactor-branch-orchestrator-create",
      "pi-bugfix-count-defs",
    ]);

    assert.deepEqual(
      entries.map((entry) => entry.fixture),
      ["rh-refactor-branch-orchestrator-create", "pi-bugfix-count-defs"],
    );
    assert.equal(entries[0]!.evidencePolicy, "label_required");
    assert.equal(entries[0]!.comparabilityRisk, true);
    assert.equal(entries[1]!.evidencePolicy, "exclude_from_phase3_exit");
    assert.equal(entries[1]!.contamination, "neutralized_prompt_contamination");
  });

  it("enforces evidence policies for comparability and contamination governance", () => {
    const matrix = loadFailureMatrix();

    for (const entry of matrix.entries) {
      if (entry.governance?.comparabilityRisk === true) {
        assert.equal(
          entry.governance.evidencePolicy,
          "label_required",
          `${entry.fixture}: comparability risk must be explicitly labeled in benchmark evidence`,
        );
      }

      if (entry.governance?.contamination) {
        assert.equal(
          entry.governance.evidencePolicy,
          "exclude_from_phase3_exit",
          `${entry.fixture}: contaminated historical evidence must be excluded from Phase 3 exit evidence`,
        );
      }
    }
  });
});
