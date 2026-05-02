import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createEmptyResult,
  scoreResult,
  compareResults,
  formatComparisonReport,
  formatEvaluationReport,
} from "./benchmark-runner.js";
import type { TaskResult } from "./benchmark-runner.js";

/** Create a minimal TaskResult for tests with default values. */
function makeResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    fixtureId: "t",
    category: "bugfix",
    completed: false,
    filesChanged: [],
    filesExpected: [],
    extraFiles: [],
    scopeViolation: false,
    testsPassed: false,
    repairRounds: 0,
    repairSuccess: false,
    ruleViolations: [],
    manualInterventions: 0,
    handoffQuality: 0,
    durationMs: 0,
    expectedProtocolOps: [],
    actualProtocolOps: [],
    ...overrides,
  };
}

// ---- Existing score tests ----

describe("createEmptyResult", () => {
  it("creates zeroed result from fixture", () => {
    const fixture = {
      id: "test-1",
      description: "test",
      category: "bugfix" as const,
      taskPrompt: "fix it",
      expectedFiles: [],
      expectPass: true,
      verificationCommands: [],
      architectureRules: [],
      expectedProtocolOperations: ["PATCH" as const],
      filePath: "/tmp/test.yaml",
    };
    const result = createEmptyResult(fixture);
    assert.equal(result.fixtureId, "test-1");
    assert.equal(result.completed, false);
    assert.equal(result.testsPassed, false);
    assert.equal(result.repairRounds, 0);
    assert.equal(result.handoffQuality, 0);
    assert.equal(result.scopeViolation, false);
  });
});

describe("scoreResult", () => {
  it("gives full score for perfect result", () => {
    const r = makeResult({ completed: true, testsPassed: true, handoffQuality: 3 });
    assert.equal(scoreResult(r), 100); // 40+25+10+10+10+5(min(6,5))
  });

  it("gives partial score for completed but failed tests", () => {
    const r = makeResult({ completed: true, testsPassed: false, repairRounds: 2, handoffQuality: 2 });
    const s = scoreResult(r);
    assert.ok(s >= 40 && s < 95);
  });

  it("gives low score for complete failure", () => {
    const r = makeResult({ completed: false, repairRounds: 3, ruleViolations: ["r1"], manualInterventions: 2 });
    const s = scoreResult(r);
    assert.ok(s < 30);
  });
});

describe("compareResults", () => {
  it("computes comparison between two tools", () => {
    const a = makeResult({ fixtureId: "t1", completed: true, testsPassed: true, handoffQuality: 3 });
    const b = makeResult({ fixtureId: "t1", completed: false });
    const report = compareResults("dsh", [a], "baseline", [b]);
    assert.equal(report.comparison.aWins, 1);
    assert.equal(report.comparison.bWins, 0);
  });
});

describe("formatComparisonReport", () => {
  it("formats report as markdown", () => {
    const a = makeResult({ fixtureId: "t1", completed: true, testsPassed: true, handoffQuality: 3 });
    const report = compareResults("dsh", [a], "baseline", [makeResult({ fixtureId: "t1", completed: false })]);
    const md = formatComparisonReport(report);
    assert.ok(md.includes("# Comparison Report"));
    assert.ok(md.includes("dsh"));
  });
});

// ---- New tests ----

describe("formatEvaluationReport", () => {
  it("generates markdown report from results", () => {
    const results: TaskResult[] = [
      makeResult({
        fixtureId: "pi-001", category: "bugfix", completed: true,
        filesChanged: ["tools/check.py"], filesExpected: ["tools/check.py"],
        testsPassed: true, handoffQuality: 3, durationMs: 45000,
        expectedProtocolOps: ["PATCH"], actualProtocolOps: ["PATCH"],
      }),
      makeResult({
        fixtureId: "pi-002", category: "test", completed: true,
        filesChanged: ["tests/test_handler.py", "src/unrelated.py"],
        filesExpected: ["tests/test_handler.py"], extraFiles: ["src/unrelated.py"],
        scopeViolation: true, testsPassed: false, repairRounds: 2,
        ruleViolations: ["modified unrelated file"],
        manualInterventions: 1, handoffQuality: 1, durationMs: 120000,
        expectedProtocolOps: ["CREATE"], actualProtocolOps: ["CREATE"],
      }),
    ];

    const report = formatEvaluationReport(results);

    assert.ok(report.includes("# DSH Evaluation Report"));
    assert.ok(report.includes("## Overview"));
    assert.ok(report.includes("pi-001"));
    assert.ok(report.includes("pi-002"));
    assert.ok(report.includes("## Protocol Operation Coverage"));
    assert.ok(report.includes("## Failure Analysis"));
    assert.ok(report.includes("scope creep"));
  });

  it("handles empty results", () => {
    const report = formatEvaluationReport([]);
    assert.ok(report.includes("## Overview"));
    assert.ok(report.includes("0/0"));
  });
});
