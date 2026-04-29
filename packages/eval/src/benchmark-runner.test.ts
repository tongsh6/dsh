import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyResult,
  scoreResult,
  compareResults,
  formatComparisonReport,
} from "./benchmark-runner.js";
import type { LoadedFixture } from "./task-fixtures.js";

function makeFixture(overrides: Partial<LoadedFixture> = {}): LoadedFixture {
  return {
    id: "test-task",
    description: "Test task",
    category: "bugfix",
    taskPrompt: "Fix it",
    expectedFiles: ["src/a.ts"],
    expectPass: true,
    verificationCommands: ["npm test"],
    architectureRules: [],
    filePath: "/tmp/test-task.yaml",
    ...overrides,
  };
}

describe("createEmptyResult", () => {
  it("creates zeroed result from fixture", () => {
    const fixture = makeFixture();
    const result = createEmptyResult(fixture);
    assert.equal(result.fixtureId, "test-task");
    assert.equal(result.completed, false);
    assert.equal(result.testsPassed, false);
    assert.equal(result.scopeViolation, false);
    assert.equal(result.repairRounds, 0);
    assert.equal(result.ruleViolations.length, 0);
    assert.equal(result.manualInterventions, 0);
    assert.equal(result.handoffQuality, 0);
    assert.deepEqual(result.filesExpected, ["src/a.ts"]);
  });
});

describe("scoreResult", () => {
  it("gives full score for perfect result", () => {
    const fixture = makeFixture();
    const result = {
      ...createEmptyResult(fixture),
      completed: true,
      testsPassed: true,
      scopeViolation: false,
      ruleViolations: [],
      repairSuccess: true,
      repairRounds: 1,
      handoffQuality: 3,
    };
    assert.equal(scoreResult(result), 100);
  });

  it("gives partial score for completed but failed tests", () => {
    const fixture = makeFixture();
    const result = {
      ...createEmptyResult(fixture),
      completed: true,
      testsPassed: false,
      scopeViolation: false,
      ruleViolations: [],
      repairSuccess: false,
      repairRounds: 3,
      handoffQuality: 1,
    };
    const score = scoreResult(result);
    // 40 (completed) + 0 (tests) + 10 (no scope) + 10 (no rules) + 0 (repair) + 2 (handoff) = 62
    assert.equal(score, 62);
  });

  it("penalizes scope violations", () => {
    const fixture = makeFixture();
    const result = {
      ...createEmptyResult(fixture),
      completed: true,
      testsPassed: true,
      scopeViolation: true,
      ruleViolations: [],
      repairSuccess: true,
      repairRounds: 1,
      handoffQuality: 2,
    };
    const score = scoreResult(result);
    // 40 + 25 + 0 + 10 + 10 + 4 = 89
    assert.equal(score, 89);
  });

  it("penalizes rule violations", () => {
    const fixture = makeFixture();
    const result = {
      ...createEmptyResult(fixture),
      completed: true,
      testsPassed: true,
      scopeViolation: false,
      ruleViolations: ["violated no-console rule"],
      repairSuccess: false,
      repairRounds: 2,
      handoffQuality: 1,
    };
    const score = scoreResult(result);
    // 40 + 25 + 10 + 0 + 0 + 2 = 77
    assert.equal(score, 77);
  });

  it("caps score at 100", () => {
    const fixture = makeFixture();
    const result = {
      ...createEmptyResult(fixture),
      completed: true,
      testsPassed: true,
      scopeViolation: false,
      ruleViolations: [],
      repairSuccess: true,
      repairRounds: 2,
      handoffQuality: 5, // would give 10 extra points
    };
    assert.equal(scoreResult(result), 100);
  });

  it("gives low score for complete failure", () => {
    const fixture = makeFixture();
    const result = createEmptyResult(fixture);
    // 0 (not completed) + 0 (tests) + 10 (no scope) + 10 (no rules) + 0 (repair) + 0 (handoff) = 20
    assert.equal(scoreResult(result), 20);
  });

  it("gives zero for failure with scope and rule violations", () => {
    const fixture = makeFixture();
    const result = {
      ...createEmptyResult(fixture),
      scopeViolation: true,
      ruleViolations: ["rule-1", "rule-2"],
    };
    assert.equal(scoreResult(result), 0);
  });
});

describe("compareResults", () => {
  it("computes comparison between two tools", () => {
    const fixture = makeFixture();

    const aResults = [{
      ...createEmptyResult(fixture),
      completed: true,
      testsPassed: true,
      repairRounds: 0,
      handoffQuality: 3,
    }];
    const bResults = [{
      ...createEmptyResult(fixture),
      completed: true,
      testsPassed: false,
      repairRounds: 2,
      handoffQuality: 1,
    }];

    const report = compareResults("dsh", aResults, "baseline", bResults);
    assert.equal(report.toolA.name, "dsh");
    assert.equal(report.toolB.name, "baseline");
    assert.equal(report.comparison.aWins, 1);
    assert.equal(report.comparison.bWins, 0);
    assert.equal(report.comparison.ties, 0);
    assert.ok(report.comparison.aAvgScore > report.comparison.bAvgScore);
  });

  it("handles ties", () => {
    const fixture = makeFixture();
    const results = [{
      ...createEmptyResult(fixture),
      completed: true,
      testsPassed: true,
      handoffQuality: 2,
    }];

    const report = compareResults("A", results, "B", results);
    assert.equal(report.comparison.aWins, 0);
    assert.equal(report.comparison.bWins, 0);
    assert.equal(report.comparison.ties, 1);
  });

  it("handles different result counts", () => {
    const fixture = makeFixture();
    const aResults = [
      { ...createEmptyResult(fixture), completed: true, testsPassed: true, handoffQuality: 3 },
      { ...createEmptyResult({ ...fixture, id: "task-2" }), completed: false, testsPassed: false, handoffQuality: 0 },
    ];
    const bResults = [
      { ...createEmptyResult(fixture), completed: true, testsPassed: false, handoffQuality: 1 },
    ];

    const report = compareResults("dsh", aResults, "baseline", bResults);
    assert.equal(report.toolA.results.length, 2);
    assert.equal(report.toolB.results.length, 1);
  });
});

describe("formatComparisonReport", () => {
  it("formats report as markdown", () => {
    const fixture = makeFixture();
    const aResults = [{
      ...createEmptyResult(fixture),
      completed: true,
      testsPassed: true,
      handoffQuality: 3,
    }];
    const bResults = [{
      ...createEmptyResult(fixture),
      completed: false,
      testsPassed: false,
      handoffQuality: 0,
    }];

    const report = compareResults("dsh", aResults, "baseline", bResults);
    const formatted = formatComparisonReport(report);
    assert.ok(formatted.includes("# Comparison Report"));
    assert.ok(formatted.includes("dsh"));
    assert.ok(formatted.includes("baseline"));
    assert.ok(formatted.includes("test-task"));
  });
});
