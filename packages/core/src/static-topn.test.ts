import { describe, it } from "node:test";
import assert from "node:assert";
import {
  selectTopFindings,
  scoreFindings,
  resolveTopNConfig,
  buildReason,
  formatScoredFindings,
} from "./static-topn.js";
import type { StaticScanFinding } from "./task-state.js";
import type { TopNConfig } from "./static-topn.js";

// ---- Helpers ----

function makeFinding(overrides: Partial<StaticScanFinding> = {}): StaticScanFinding {
  return {
    id: "test-1",
    scanner: "eslint",
    file: "src/foo.ts",
    line: 42,
    column: 3,
    severity: "error",
    category: "style",
    message: "Avoid console.log",
    rule: "no-console",
    ...overrides,
  };
}

const defaultConfig: TopNConfig = {
  topN: 5,
  weights: {
    severity: 400,
    changedFile: 300,
    security: 200,
    buildBlocking: 150,
    ruleConfidence: 50,
  },
};

// ---- Resolve Config ----

describe("resolveTopNConfig", () => {
  it("returns defaults for empty config", () => {
    const config = resolveTopNConfig({});
    assert.equal(config.topN, 5);
    assert.equal(config.weights.severity, 400);
    assert.equal(config.weights.changedFile, 300);
    assert.equal(config.weights.security, 200);
    assert.equal(config.weights.buildBlocking, 150);
    assert.equal(config.weights.ruleConfidence, 50);
  });

  it("reads custom topN", () => {
    const config = resolveTopNConfig({ static_scan: { top_n: 10 } });
    assert.equal(config.topN, 10);
  });

  it("reads custom weights", () => {
    const config = resolveTopNConfig({
      static_scan: {
        selection: { weights: { severity: 100, security: 500 } },
      },
    });
    assert.equal(config.weights.severity, 100);
    assert.equal(config.weights.security, 500);
    assert.equal(config.weights.changedFile, 300); // default
  });

  it("clamps weight of 0 correctly", () => {
    const config = resolveTopNConfig({
      static_scan: { selection: { weights: { severity: 0 } } },
    });
    assert.equal(config.weights.severity, 0);
  });
});

// ---- Score Dimensions ----

describe("scoreFindings", () => {
  it("gives weighted severity for critical finding", () => {
    const f = [makeFinding({ severity: "critical" })];
    const scored = scoreFindings(f, [], defaultConfig.weights);
    assert.equal(scored[0]!.dimensions.severity, 400); // 1.0 * 400
  });

  it("gives weighted severity for error finding", () => {
    const f = [makeFinding({ severity: "error" })];
    const scored = scoreFindings(f, [], defaultConfig.weights);
    assert.equal(scored[0]!.dimensions.severity, 200); // 0.5 * 400
  });

  it("gives zero severity score for info finding", () => {
    const f = [makeFinding({ severity: "info" })];
    const scored = scoreFindings(f, [], defaultConfig.weights);
    assert.equal(scored[0]!.dimensions.severity, 0);
  });

  it("gives weighted changedFile score when file in changedFiles", () => {
    const f = [makeFinding({ file: "src/foo.ts" })];
    const scored = scoreFindings(f, ["src/foo.ts"], defaultConfig.weights);
    assert.equal(scored[0]!.dimensions.changedFile, 300);
  });

  it("gives zero changedFile score when file not in changedFiles", () => {
    const f = [makeFinding({ file: "src/bar.ts" })];
    const scored = scoreFindings(f, ["src/foo.ts"], defaultConfig.weights);
    assert.equal(scored[0]!.dimensions.changedFile, 0);
  });

  it("gives weighted security score for security category", () => {
    const f = [makeFinding({ category: "security", severity: "critical" })];
    const scored = scoreFindings(f, [], defaultConfig.weights);
    assert.equal(scored[0]!.dimensions.security, 200);
  });

  it("gives weighted security score for secret category", () => {
    const f = [makeFinding({ category: "secret" })];
    const scored = scoreFindings(f, [], defaultConfig.weights);
    assert.equal(scored[0]!.dimensions.security, 200);
  });

  it("gives weighted buildBlocking for error+bug finding", () => {
    const f = [makeFinding({ severity: "error", category: "bug" })];
    const scored = scoreFindings(f, [], defaultConfig.weights);
    assert.equal(scored[0]!.dimensions.buildBlocking, 150);
  });

  it("does not give buildBlocking for warning+type finding", () => {
    const f = [makeFinding({ severity: "warning", category: "type" })];
    const scored = scoreFindings(f, [], defaultConfig.weights);
    assert.equal(scored[0]!.dimensions.buildBlocking, 0);
  });

  it("gives weighted ruleConfidence when rule is not null", () => {
    const f = [makeFinding({ rule: "no-console" })];
    const scored = scoreFindings(f, [], defaultConfig.weights);
    assert.equal(scored[0]!.dimensions.ruleConfidence, 50);
  });

  it("gives zero ruleConfidence when rule is null", () => {
    const f = [makeFinding({ rule: null })];
    const scored = scoreFindings(f, [], defaultConfig.weights);
    assert.equal(scored[0]!.dimensions.ruleConfidence, 0);
  });

  it("scannerOrder is negative and increases with index", () => {
    const findings = [makeFinding(), makeFinding({ id: "test-2" }), makeFinding({ id: "test-3" })];
    const scored = scoreFindings(findings, [], defaultConfig.weights);
    assert.ok(scored[0]!.dimensions.scannerOrder > scored[1]!.dimensions.scannerOrder);
    assert.ok(scored[1]!.dimensions.scannerOrder > scored[2]!.dimensions.scannerOrder);
  });
});

// ---- Select Top N ----

describe("selectTopFindings", () => {
  it("selects top N findings by total score", () => {
    // High: critical + changed file
    const high = makeFinding({ id: "high", severity: "critical", file: "src/a.ts" });
    // Medium: error only
    const medium = makeFinding({ id: "medium", severity: "error", file: "src/b.ts" });
    // Low: warning only
    const low = makeFinding({ id: "low", severity: "warning", file: "src/c.ts" });

    const selected = selectTopFindings([low, medium, high], ["src/a.ts"], {
      topN: 2,
      weights: defaultConfig.weights,
    });
    assert.equal(selected.length, 2);
    assert.equal(selected[0]!.finding.id, "high");
    assert.equal(selected[1]!.finding.id, "medium");
  });

  it("scannerOrder breaks ties deterministically", () => {
    const a = makeFinding({ id: "a" });
    const b = makeFinding({ id: "b" });
    // Both identical — a appears first in list, so scannerOrder higher
    const selected = selectTopFindings([a, b], [], {
      topN: 1,
      weights: defaultConfig.weights,
    });
    assert.equal(selected[0]!.finding.id, "a");
  });

  it("weight of 0 disables a dimension", () => {
    const withSecret = makeFinding({ id: "secret", category: "secret", severity: "error" });
    const withoutSecret = makeFinding({ id: "style", category: "style", severity: "error" });

    // With security weight = 200: secret adds 200, wins over style
    const withSec = selectTopFindings([withoutSecret, withSecret], [], {
      topN: 1,
      weights: { ...defaultConfig.weights, security: 200 },
    });
    assert.equal(withSec[0]!.finding.id, "secret");

    // With security weight = 0: both have identical score, first in array wins
    const withoutSec = selectTopFindings([withoutSecret, withSecret], [], {
      topN: 1,
      weights: { ...defaultConfig.weights, security: 0 },
    });
    assert.equal(withoutSec[0]!.finding.id, "style");
  });

  it("returns empty when no findings", () => {
    const selected = selectTopFindings([], [], defaultConfig);
    assert.deepEqual(selected, []);
  });
});

// ---- Reason ----

describe("buildReason", () => {
  it("generates reason for all active dimensions", () => {
    const reason = buildReason({
      severity: 200, changedFile: 300, security: 0, buildBlocking: 150, ruleConfidence: 50, scannerOrder: -0.001,
    });
    // 200/400 = 0.5 → "error"
    assert.ok(reason.includes("error severity (200)"), reason);
    assert.ok(reason.includes("changed file (300)"), reason);
    assert.ok(reason.includes("build blocking (150)"), reason);
    assert.ok(reason.includes("rule confidence (50)"), reason);
    assert.ok(!reason.includes("security"), reason);
  });

  it("generates reason with only scanner order when all zero", () => {
    const reason = buildReason({
      severity: 0, changedFile: 0, security: 0, buildBlocking: 0, ruleConfidence: 0, scannerOrder: -0.001,
    });
    assert.equal(reason, "scanner order");
  });

  it("generates single dimension reason for critical", () => {
    const reason = buildReason({
      severity: 400, changedFile: 0, security: 0, buildBlocking: 0, ruleConfidence: 0, scannerOrder: -0.001,
    });
    assert.ok(reason.includes("critical severity (400)"), reason);
  });
});

// ---- Format ----

describe("formatScoredFindings", () => {
  it("formats scored findings with total scores", () => {
    const finding = makeFinding({ id: "test-1", severity: "error", rule: "no-console", message: "Avoid console.log" });
    const scored = scoreFindings([finding], ["src/foo.ts"], defaultConfig.weights);
    const result = formatScoredFindings(scored);
    assert.ok(result.includes("1."));
    assert.ok(result.includes("test-1"));
    assert.ok(result.includes("error"));
    assert.ok(result.includes("(no-console)"));
    assert.ok(result.includes("Avoid console.log"));
    assert.ok(result.includes("[total="));
  });

  it("returns empty string for empty array", () => {
    assert.equal(formatScoredFindings([]), "");
  });
});
