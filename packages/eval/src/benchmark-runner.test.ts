import { describe, it } from "node:test";
import assert from "node:assert";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  cleanBenchmarkWorktree,
  normalizeVerificationCommands,
  compileFixtureVerifications,
  createEmptyResult,
  prepareBenchmarkBranch,
  scoreResult,
  compareResults,
  formatComparisonReport,
  formatEvaluationReport,
  summarizePatchRecords,
  collectTaskDiagnostics,
} from "./benchmark-runner.js";
import type { TaskResult } from "./benchmark-runner.js";
import { detectProtocolOpsFromText } from "@dsh/core";

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
    toolRounds: 0,
    toolCalls: [],
    patchRounds: 0,
    patchRoundActions: [],
    verifyOutput: [],
    ...overrides,
  };
}

describe("cleanBenchmarkWorktree", () => {
  it("removes untracked files left by previous fixture runs", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bench-clean-"));
    try {
      execSync("git init -q", { cwd: tmp });
      execSync("git config user.email test@example.com", { cwd: tmp });
      execSync("git config user.name Test", { cwd: tmp });
      fs.writeFileSync(path.join(tmp, "tracked.txt"), "base\n", "utf-8");
      execSync("git add tracked.txt && git commit -q -m initial", { cwd: tmp });

      fs.mkdirSync(path.join(tmp, "docs"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "docs/providers.md"), "stale fixture output\n", "utf-8");

      cleanBenchmarkWorktree(tmp);

      assert.equal(fs.existsSync(path.join(tmp, "docs/providers.md")), false);
      assert.equal(fs.readFileSync(path.join(tmp, "tracked.txt"), "utf-8"), "base\n");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("normalizeVerificationCommands", () => {
  it("returns each fixture verification command as a separate entry, preserving order", () => {
    const commands = normalizeVerificationCommands([
      "test -f frontend/src/api/system.ts",
      "cd backend && mvn test -q",
      "cd frontend && pnpm typecheck",
    ]);

    assert.deepEqual(commands, [
      "test -f frontend/src/api/system.ts",
      "cd backend && mvn test -q",
      "cd frontend && pnpm typecheck",
    ]);
  });

  it("drops empty verification commands", () => {
    assert.deepEqual(normalizeVerificationCommands(["", "  ", "pnpm test"]), ["pnpm test"]);
  });
});

describe("compileFixtureVerifications", () => {
  it("returns structured verifications when present", () => {
    const result = compileFixtureVerifications({
      verifications: [
        { type: "file_contains", file: "a.ts", pattern: "x" },
        { type: "shell", command: "pnpm test", name: "tests" },
      ],
      verificationCommands: [],
    });
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { type: "file_contains", file: "a.ts", pattern: "x" });
  });

  it("falls back to verificationCommands wrapped as shell when no structured field", () => {
    const result = compileFixtureVerifications({
      verifications: undefined,
      verificationCommands: ["pnpm test", "pnpm typecheck"],
    });
    assert.deepEqual(result, [
      { type: "shell", command: "pnpm test" },
      { type: "shell", command: "pnpm typecheck" },
    ]);
  });

  it("returns empty when neither field set", () => {
    assert.deepEqual(
      compileFixtureVerifications({ verifications: undefined, verificationCommands: [] }),
      [],
    );
  });

  it("structured field wins over verificationCommands when both somehow present at runtime", () => {
    // (schema rejects this, but exercise the function precedence anyway)
    const result = compileFixtureVerifications({
      verifications: [{ type: "shell", command: "via-structured" }],
      verificationCommands: ["via-legacy"],
    });
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], { type: "shell", command: "via-structured" });
  });
});

describe("prepareBenchmarkBranch", () => {
  it("creates the fixture branch from the fixture benchmark branch", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bench-ref-"));
    try {
      execSync("git init -q", { cwd: tmp });
      execSync("git config user.email test@example.com", { cwd: tmp });
      execSync("git config user.name Test", { cwd: tmp });
      fs.writeFileSync(path.join(tmp, "tracked.txt"), "main\n", "utf-8");
      execSync("git add tracked.txt && git commit -q -m main", { cwd: tmp });
      execSync("git checkout -q -b dsh-benchmark/phase2", { cwd: tmp });
      fs.writeFileSync(path.join(tmp, "tracked.txt"), "benchmark\n", "utf-8");
      fs.writeFileSync(path.join(tmp, "anchor.txt"), "exists\n", "utf-8");
      execSync("git add tracked.txt anchor.txt && git commit -q -m benchmark", { cwd: tmp });
      execSync("git checkout -q master", { cwd: tmp });

      prepareBenchmarkBranch(tmp, {
        id: "fixture-branch",
        benchmarkRef: { branch: "dsh-benchmark/phase2" },
        preflightFiles: ["anchor.txt"],
      });

      assert.equal(execSync("git branch --show-current", { cwd: tmp, encoding: "utf-8" }).trim(), "dsh-bench-fixture-branch");
      assert.equal(fs.readFileSync(path.join(tmp, "tracked.txt"), "utf-8"), "benchmark\n");
      assert.equal(fs.existsSync(path.join(tmp, "anchor.txt")), true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails before running a fixture when a preflight tracked file is absent", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bench-preflight-"));
    try {
      execSync("git init -q", { cwd: tmp });
      execSync("git config user.email test@example.com", { cwd: tmp });
      execSync("git config user.name Test", { cwd: tmp });
      fs.writeFileSync(path.join(tmp, "tracked.txt"), "base\n", "utf-8");
      execSync("git add tracked.txt && git commit -q -m initial", { cwd: tmp });

      assert.throws(
        () =>
          prepareBenchmarkBranch(tmp, {
            id: "fixture-preflight",
            preflightFiles: ["missing.ts"],
          }),
        /preflight failed.*missing\.ts/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

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
      preflightFiles: [],
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
    assert.deepEqual(result.expectedProtocolOps, ["PATCH"]);
    assert.deepEqual(result.actualProtocolOps, []);
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

describe("summarizePatchRecords", () => {
  it("aggregates files and protocol operations across all patch attempts", () => {
    const summary = summarizePatchRecords([
      {
        files_changed: ["src/a.ts"],
        patch: '<PATCH file="src/a.ts">x</PATCH>',
      } as any,
      {
        files_changed: [],
        patch: "<empty>",
      } as any,
      {
        files_changed: ["src/b.test.ts"],
        patch: '<CREATE path="src/b.test.ts">test</CREATE>',
      } as any,
    ]);

    assert.deepEqual(summary.filesChanged, ["src/a.ts", "src/b.test.ts"]);
    assert.ok(summary.actualProtocolOps.includes("PATCH"));
    assert.ok(summary.actualProtocolOps.includes("CREATE"));
  });
});

describe("collectTaskDiagnostics", () => {
  it("preserves full verification output for post-run diagnosis", () => {
    const longOutput = `[ERROR] COMPILATION ERROR :\n${"x".repeat(1200)}\n[ERROR] Foo.java:[42,7] ';' expected`;
    const diagnostics = collectTaskDiagnostics({
      version: "0.1",
      status: "repair_exhausted",
      task: { description: "fix", type: "bugfix", created_at: "2026-05-13T00:00:00.000Z" },
      patches: [{ round: 1, patch: "<PATCH>...</PATCH>", apply_status: "ok", files_changed: ["Foo.java"] }],
      patch_rounds: [],
      tool_rounds: [],
      preflight_results: [],
      verify_results: [{
        round: 1,
        results: [{
          command: "maven_test",
          status: "failed",
          exit_code: 1,
          output: longOutput,
          duration_ms: 10,
        }],
      }],
      static_scan_runs: [],
      static_repair_results: [],
      repair_rounds: 1,
      managed_files: [],
    });

    assert.equal(diagnostics.finalStatus, "repair_exhausted");
    assert.equal(diagnostics.verifyResults[0]!.results[0]!.output, longOutput);
    assert.ok(diagnostics.verifyResults[0]!.results[0]!.output.length > 1000);
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
    assert.ok(md.includes("# 对比报告"));
    assert.ok(md.includes("dsh"));
  });
});

// ---- New tests ----

describe("patch_rounds in TaskResult", () => {
  it("defaults patchRounds to 0 and patchRoundActions to []", () => {
    const r = makeResult();
    assert.equal(r.patchRounds, 0);
    assert.deepEqual(r.patchRoundActions, []);
  });

  it("stores patch loop stats", () => {
    const r = makeResult({
      patchRounds: 3,
      patchRoundActions: [
        { round: 1, action: "tools" },
        { round: 2, action: "change" },
        { round: 3, action: "done" },
      ],
    });
    assert.equal(r.patchRounds, 3);
    assert.equal(r.patchRoundActions.length, 3);
    assert.equal(r.patchRoundActions[1]!.action, "change");
  });
});

describe("formatEvaluationReport with patch loop", () => {
  it("includes Patch Loop 行为 section when results have patch_rounds", () => {
    const results: TaskResult[] = [
      makeResult({
        fixtureId: "t1", category: "bugfix", completed: true, testsPassed: true,
        patchRounds: 3,
        patchRoundActions: [
          { round: 1, action: "tools" },
          { round: 2, action: "change" },
          { round: 3, action: "done" },
        ],
      }),
    ];
    const report = formatEvaluationReport(results);
    assert.ok(report.includes("## Patch Loop 行为"));
    assert.ok(report.includes("done 主动终止率"));
    assert.ok(report.includes("t1"));
    assert.ok(report.includes("✓"), "done column should show checkmark");
  });

  it("shows N/A for done rate when no patch loop data", () => {
    const results: TaskResult[] = [makeResult({ fixtureId: "t1" })];
    const report = formatEvaluationReport(results);
    assert.ok(report.includes("N/A"));
  });

  it("handles mixed patch loop and non-patch results", () => {
    const results: TaskResult[] = [
      makeResult({
        fixtureId: "t1", completed: true, testsPassed: true,
        patchRounds: 4,
        patchRoundActions: [
          { round: 1, action: "change" },
          { round: 2, action: "change" },
          { round: 3, action: "change" },
          { round: 4, action: "done" },
        ],
      }),
      makeResult({ fixtureId: "t2", patchRounds: 0, patchRoundActions: [] }),
    ];
    const report = formatEvaluationReport(results);
    // Should show 1/2 fixtures with patch loop
    assert.ok(report.includes("1/2"));
    // Should show correct averages
    assert.ok(report.includes("4.0")); // avg rounds for t1 only
  });
});

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

    assert.ok(report.includes("# DSH 评测报告"));
    assert.ok(report.includes("## 概览"));
    assert.ok(report.includes("pi-001"));
    assert.ok(report.includes("pi-002"));
    assert.ok(report.includes("## 协议操作覆盖"));
    assert.ok(report.includes("## 失败分析"));
    assert.ok(report.includes("范围越界"));
  });

  it("handles empty results", () => {
    const report = formatEvaluationReport([]);
    assert.ok(report.includes("## 概览"));
    assert.ok(report.includes("0/0"));
  });
});

// ---- Protocol op detection tests ----

describe("detectProtocolOpsFromText", () => {
  it("returns empty array for empty string", () => {
    assert.deepEqual(detectProtocolOpsFromText(""), []);
  });

  it("detects CREATE", () => {
    const ops = detectProtocolOpsFromText('<CREATE path="src/foo.ts">content</CREATE>');
    assert.ok(ops.includes("CREATE"));
    assert.equal(ops.length, 1);
  });

  it("detects PATCH without type=search", () => {
    const ops = detectProtocolOpsFromText('<PATCH file="src/foo.ts">content</PATCH>');
    assert.ok(ops.includes("PATCH"));
    assert.ok(!ops.includes("SEARCH_REPLACE"));
  });

  it("detects SEARCH_REPLACE for PATCH with type=search", () => {
    const ops = detectProtocolOpsFromText('<PATCH type="search" file="src/foo.ts">content</PATCH>');
    assert.ok(ops.includes("SEARCH_REPLACE"));
    assert.ok(!ops.includes("PATCH"));
  });

  it("detects DELETE", () => {
    const ops = detectProtocolOpsFromText('<DELETE path="src/foo.ts" />');
    assert.ok(ops.includes("DELETE"));
  });

  it("detects RENAME", () => {
    const ops = detectProtocolOpsFromText('<RENAME from="a.ts" to="b.ts" />');
    assert.ok(ops.includes("RENAME"));
  });

  it("detects INSERT", () => {
    const ops = detectProtocolOpsFromText('<INSERT anchor="fn" position="before">x</INSERT>');
    assert.ok(ops.includes("INSERT"));
  });

  it("detects multiple ops in same text", () => {
    const text = '<CREATE path="a.ts">c</CREATE>\n<PATCH file="b.ts">d</PATCH>\n<DELETE path="c.ts" />';
    const ops = detectProtocolOpsFromText(text);
    assert.ok(ops.includes("CREATE"));
    assert.ok(ops.includes("PATCH"));
    assert.ok(ops.includes("DELETE"));
  });

  it("does not confuse type=search in unrelated tag with PATCH", () => {
    const text = '<PATCH file="src/foo.ts">content</PATCH>\n<OTHER type="search">x</OTHER>';
    const ops = detectProtocolOpsFromText(text);
    assert.ok(ops.includes("PATCH"), "PATCH should be detected regardless of type=search in unrelated tag");
  });

  it("detects both PATCH and SEARCH_REPLACE when both tags present", () => {
    const text = '<PATCH file="a.ts">d</PATCH>\n<PATCH type="search" file="b.ts">s</PATCH>';
    const ops = detectProtocolOpsFromText(text);
    assert.ok(ops.includes("PATCH"));
    assert.ok(ops.includes("SEARCH_REPLACE"));
  });
});
