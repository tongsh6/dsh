import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditFixtureContamination,
  auditFixturesForContamination,
} from "./fixture-audit.js";
import { loadFailureMatrix } from "./failure-matrix.js";
import { loadAllFixtures } from "./task-fixtures.js";

describe("fixture contamination audit", () => {
  it("flags literal implementation snippets in task prompts", () => {
    const findings = auditFixtureContamination({
      id: "literal-answer",
      taskPrompt:
        "Replace the implementation with re.findall(r'^\\s*' + re.escape(signature), text, re.MULTILINE).",
    });

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.ruleId, "literal_implementation_snippet");
    assert.equal(findings[0]!.severity, "strict_contamination");
  });

  it("flags DSH patch protocol coaching in task prompts", () => {
    const findings = auditFixtureContamination({
      id: "protocol-coaching",
      taskPrompt:
        "只能对 NewThing.java 使用 CREATE；ExistingThing.java 已存在，必须用 PATCH 或 SEARCH/REPLACE 做局部修改。",
    });

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.ruleId, "dsh_protocol_coaching");
    assert.equal(findings[0]!.severity, "strict_contamination");
  });

  it("flags failure-specific workaround phrases in task prompts", () => {
    const findings = auditFixtureContamination({
      id: "workaround-hint",
      taskPrompt:
        "Add tests for VersionUpdateAppService. 不要使用 @InjectMocks，避免 NPE。",
    });

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.ruleId, "failure_specific_workaround_phrase");
    assert.equal(findings[0]!.severity, "strict_contamination");
  });

  it("does not flag normal product acceptance criteria", () => {
    const findings = auditFixtureContamination({
      id: "clean-fixture",
      taskPrompt:
        "Add pagination to GET /api/users. Accept page and pageSize query parameters and keep existing response behavior stable.",
    });

    assert.deepEqual(findings, []);
  });

  it("captures the documented real-fixture contamination baseline", () => {
    const fixturesDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "fixtures",
    );
    const fixtures = loadAllFixtures(fixturesDir);
    const findings = auditFixturesForContamination(fixtures);

    const strictIds = new Set(
      findings
        .filter((finding) => finding.severity === "strict_contamination")
        .map((finding) => finding.fixtureId),
    );
    assert.deepEqual([...strictIds].sort(), []);

    const comparabilityIds = new Set(
      findings
        .filter((finding) => finding.severity === "comparability_risk")
        .map((finding) => finding.fixtureId),
    );
    assert.deepEqual([...comparabilityIds].sort(), [
      "rh-refactor-branch-orchestrator-create",
      "rh-refactor-branch-orchestrator-service-attach",
      "rh-refactor-branch-orchestrator-service-code-merge",
      "rh-refactor-branch-orchestrator-service-release-branch",
      "rh-refactor-branch-orchestrator-tests",
      "rh-test-dashboard-version",
    ]);
  });

  it("keeps comparability-risk audit findings aligned with failure matrix governance", () => {
    const fixturesDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "fixtures",
    );
    const auditIds = auditFixturesForContamination(loadAllFixtures(fixturesDir))
      .filter((finding) => finding.severity === "comparability_risk")
      .map((finding) => finding.fixtureId)
      .sort();

    const matrixIds = loadFailureMatrix().entries
      .filter((entry) => entry.governance?.comparabilityRisk === true)
      .map((entry) => entry.fixture)
      .sort();

    assert.deepEqual(matrixIds, auditIds);
  });
});
