import { describe, it } from "node:test";
import assert from "node:assert";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  cleanBenchmarkWorktree,
  cleanBenchmarkWorktreeHard,
  normalizeVerificationCommands,
  compileFixtureVerifications,
  createEmptyResult,
  prepareBenchmarkBranch,
  scoreResult,
  compareResults,
  formatComparisonReport,
  formatEvaluationReport,
  summarizePatchRecords,
  summarizePatchDiagnostics,
  summarizePatchRoundActions,
  collectTaskDiagnostics,
  collectPlanDiagnostics,
  classifyTaskFailure,
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
      plan_contract_attempts: [],
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
      deepseek_usage: [],
      repair_rounds: 1,
      managed_files: [],
    });

    assert.equal(diagnostics.finalStatus, "repair_exhausted");
    assert.equal(diagnostics.verifyResults[0]!.results[0]!.output, longOutput);
    assert.ok(diagnostics.verifyResults[0]!.results[0]!.output.length > 1000);
  });

  it("preserves patch observability fields for post-run diagnosis", () => {
    const diagnostics = collectTaskDiagnostics({
      version: "0.1",
      status: "repair_exhausted",
      task: { description: "fix", type: "bugfix", created_at: "2026-05-20T00:00:00.000Z" },
      patches: [
        {
          round: 1,
          phase: "patch",
          patch: "<PATCH>...</PATCH>",
          apply_status: "partial_ok",
          files_changed: ["src/a.ts"],
          coverage: "partial",
          covered_required_files: ["src/a.ts"],
          missing_required_files: ["src/b.ts"],
          coverage_finalization_attempted: true,
          plan_file_contract_version: "v2",
          patch_partial_reason: "missing_required_files: [src/b.ts]",
        },
        {
          round: 1,
          phase: "repair",
          patch: "<empty>",
          apply_status: "failed",
          files_changed: [],
          dsml_salvage_applied: true,
          repair_target_files: ["src/anthropic.ts"],
          repair_semantic_hints: ["rename_intent", "file_contains_failed: src/a.ts"],
          blocked_write_shell_guidance: true,
          rename_intent_detected: true,
          deterministic_reference_repair: true,
          deterministic_assertion_repair: true,
        },
      ],
      patch_rounds: [{
        round: 1,
        action: "invalid",
        invalid_reason: "no action",
        dsml_salvage_applied: true,
        duration_ms: 10,
      }],
      tool_rounds: [],
      plan_contract_attempts: [],
      preflight_results: [],
      verify_results: [],
      static_scan_runs: [],
      static_repair_results: [],
      deepseek_usage: [],
      repair_rounds: 1,
      managed_files: [],
    });

    assert.equal(diagnostics.patches[0]!.phase, "patch");
    assert.equal(diagnostics.patches[0]!.coverage, "partial");
    assert.deepEqual(diagnostics.patches[0]!.missing_required_files, ["src/b.ts"]);
    assert.equal(diagnostics.patches[1]!.phase, "repair");
    assert.equal(diagnostics.patches[1]!.empty_patch, true);
    assert.equal(diagnostics.patches[1]!.literal_empty_patch, true);
    assert.equal(diagnostics.patches[1]!.dsml_salvage_applied, true);
    assert.deepEqual(diagnostics.patches[1]!.repair_target_files, ["src/anthropic.ts"]);
    assert.deepEqual(diagnostics.patches[1]!.repair_semantic_hints, ["rename_intent", "file_contains_failed: src/a.ts"]);
    assert.equal(diagnostics.patches[1]!.blocked_write_shell_guidance, true);
    assert.equal(diagnostics.patches[1]!.rename_intent_detected, true);
    assert.equal(diagnostics.patches[1]!.deterministic_reference_repair, true);
    assert.equal(diagnostics.patches[1]!.deterministic_assertion_repair, true);
  });
});

describe("summarizePatchDiagnostics", () => {
  it("counts empty patches, DSML salvage, and missing required files", () => {
    const summary = summarizePatchDiagnostics({
      version: "0.1",
      status: "repair_exhausted",
      task: { description: "fix", type: "bugfix", created_at: "2026-05-20T00:00:00.000Z" },
      patches: [
        {
          round: 1,
          phase: "patch",
          patch: "<PATCH>...</PATCH>",
          apply_status: "partial_ok",
          files_changed: ["src/a.ts"],
          coverage: "partial",
          missing_required_files: ["src/b.ts"],
        },
        {
          round: 1,
          phase: "repair",
          patch: "",
          apply_status: "failed",
          files_changed: [],
        },
        {
          round: 2,
          phase: "repair",
          patch: "<PATCH>broken</PATCH>",
          apply_status: "failed",
          files_changed: [],
          dsml_salvage_applied: true,
          repair_semantic_hints: ["file_contains_failed: src/b.ts"],
          blocked_write_shell_guidance: true,
          rename_intent_detected: true,
          deterministic_reference_repair: true,
          deterministic_assertion_repair: true,
        },
      ],
      patch_rounds: [
        { round: 1, action: "invalid", dsml_salvage_applied: true, duration_ms: 1 },
      ],
      tool_rounds: [],
      plan_contract_attempts: [],
      preflight_results: [],
      verify_results: [],
      static_scan_runs: [],
      static_repair_results: [],
      deepseek_usage: [],
      repair_rounds: 2,
      managed_files: [],
    });

    assert.equal(summary.totalPatchRecords, 3);
    assert.deepEqual(summary.byPhase, { patch: 1, repair: 2 });
    assert.equal(summary.emptyPatchRecords, 1);
    assert.equal(summary.failedEmptyPatchRecords, 1);
    assert.equal(summary.failedNonEmptyPatchRecords, 1);
    assert.equal(summary.dsmlSalvageAppliedRecords, 1);
    assert.equal(summary.dsmlSalvageAppliedRounds, 2);
    assert.equal(summary.partialCoverageRecords, 1);
    assert.equal(summary.repairSemanticHintRecords, 1);
    assert.equal(summary.blockedWriteShellGuidanceRecords, 1);
    assert.equal(summary.renameIntentDetectedRecords, 1);
    assert.equal(summary.deterministicReferenceRepairRecords, 1);
    assert.equal(summary.deterministicAssertionRepairRecords, 1);
    assert.deepEqual(summary.missingRequiredFiles, ["src/b.ts"]);
  });
});

describe("classifyTaskFailure", () => {
  it("classifies structured plan diagnostics without relying on localized error text", () => {
    assert.equal(
      classifyTaskFailure(makeResult({
        error: "plan failed",
        planDiagnostics: {
          finalizeAttempts: 1,
          repairAttempts: 1,
          protocolRecovered: false,
          failureReason: "missing_files",
          finalResponseExcerpt: "<PLAN>...</PLAN>",
        },
        diagnostics: {
          finalStatus: "init",
          verifyResults: [],
          patches: [],
        },
      })),
      "model_protocol_plan_invalid",
    );
  });

  it("classifies invalid plan protocol before patching", () => {
    assert.equal(
      classifyTaskFailure(makeResult({
        error: "DeepSeek 未返回有效的 FILES 块",
        diagnostics: {
          finalStatus: "init",
          verifyResults: [],
          patches: [],
        },
      })),
      "model_protocol_plan_invalid",
    );
  });

  it("classifies provider network failures separately from implementation failures", () => {
    assert.equal(
      classifyTaskFailure(makeResult({
        error: "Network error: fetch failed",
        diagnostics: {
          finalStatus: "preflighted",
          verifyResults: [],
          patches: [],
        },
      })),
      "provider_network_error",
    );
  });

  it("classifies repair exhaustion using final task status", () => {
    assert.equal(
      classifyTaskFailure(makeResult({
        completed: true,
        diagnostics: {
          finalStatus: "repair_exhausted",
          verifyResults: [{
            round: 1,
            results: [{
              command: "pnpm test",
              status: "failed",
              exit_code: 1,
              output: "AssertionError",
              duration_ms: 10,
            }],
          }],
          patches: [],
        },
      })),
      "repair_exhausted",
    );
  });
});

describe("collectPlanDiagnostics", () => {
  it("reads plan contract attempts from task state", () => {
    const diagnostics = collectPlanDiagnostics({
      version: "0.1",
      status: "init",
      task: { description: "fix", type: "bugfix", created_at: "2026-05-18T00:00:00.000Z" },
      patches: [],
      patch_rounds: [],
      tool_rounds: [],
      plan_contract_attempts: [
        {
          stage: "finalize",
          attempt: 1,
          status: "invalid",
          failure_reason: "missing_files",
          response_excerpt: "<PLAN>bad</PLAN>",
          response_sha256: "abc",
          tool_rounds_before_finalize: 5,
          created_at: "2026-05-18T00:00:00.000Z",
        },
        {
          stage: "protocol_repair",
          attempt: 1,
          status: "valid",
          response_excerpt: "<PLAN>ok</PLAN>",
          response_sha256: "def",
          tool_rounds_before_finalize: 5,
          protocol_recovered: true,
          created_at: "2026-05-18T00:00:01.000Z",
        },
      ],
      preflight_results: [],
      verify_results: [],
      static_scan_runs: [],
      static_repair_results: [],
      deepseek_usage: [],
      repair_rounds: 0,
      managed_files: [],
    });

    assert.equal(diagnostics?.finalizeAttempts, 1);
    assert.equal(diagnostics?.repairAttempts, 1);
    assert.equal(diagnostics?.protocolRecovered, true);
    assert.equal(diagnostics?.failureReason, "missing_files");
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

  it("preserves native edit tool-call argument summaries", () => {
    const actions = summarizePatchRoundActions([
      {
        round: 1,
        action: "invalid",
        invalid_reason: "apply_patch.protocol_op must be one of CREATE/PATCH/SEARCH_REPLACE/INSERT/DELETE/RENAME",
        duration_ms: 4,
        tool_calls: [
          {
            name: "apply_patch",
            status: "error",
            arguments: { filename: "src/a.ts", body_length: 21 },
            summary: "invalid native edit args",
          },
        ],
      },
      {
        round: 2,
        action: "change",
        duration_ms: 5,
        tool_calls: [
          {
            name: "apply_patch",
            status: "success",
            arguments: { protocol_op: "CREATE", path: "src/a.ts", content_length: 21 },
            summary: "applied",
          },
        ],
        change: {
          op: "CREATE",
          file: "src/a.ts",
          source: "tool_call",
          apply_status: "ok",
          raw_block: '<CREATE path="src/a.ts">...</CREATE>',
        },
      },
    ]);

    assert.deepEqual(actions[0]?.toolCalls?.[0]?.arguments, {
      filename: "src/a.ts",
      body_length: 21,
    });
    assert.deepEqual(actions[1]?.toolCalls?.[0]?.arguments, {
      protocol_op: "CREATE",
      path: "src/a.ts",
      content_length: 21,
    });
    assert.equal(actions[1]?.change?.source, "tool_call");
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
    assert.ok(report.includes("## PLAN 协议诊断"));
    assert.ok(report.includes("## 失败分析"));
    assert.ok(report.includes("范围越界"));
  });

  it("includes protocol recovery statistics", () => {
    const report = formatEvaluationReport([
      makeResult({
        fixtureId: "recovered",
        completed: true,
        testsPassed: false,
        planDiagnostics: {
          finalizeAttempts: 1,
          repairAttempts: 1,
          protocolRecovered: true,
          failureReason: "missing_files",
        },
      }),
      makeResult({
        fixtureId: "tool-call",
        planDiagnostics: {
          finalizeAttempts: 1,
          repairAttempts: 1,
          protocolRecovered: false,
          failureReason: "tool_call_in_finalize",
        },
      }),
    ]);

    assert.ok(report.includes("Protocol recovered"));
    assert.ok(report.includes("missing_files"));
    assert.ok(report.includes("tool_call_in_finalize"));
    assert.ok(report.includes("Recovered 后 testsPassed"));
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

// ---- cleanBenchmarkWorktreeHard — strong cleanup for replicated A/B benchmark ----

function makeMiniRepo(): { cwd: string; baselineRef: string; cleanup: () => void } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-clean-hard-"));
  // Init repo + initial commit
  execSync("git init -q", { cwd: tmp });
  execSync("git config user.email 'test@dsh' && git config user.name 'test'", { cwd: tmp });
  fs.writeFileSync(path.join(tmp, "README.md"), "baseline\n", "utf-8");
  fs.writeFileSync(path.join(tmp, ".gitignore"), "target/\ndist/\nnode_modules/\n.dsh/\n", "utf-8");
  execSync("git add -A && git commit -q -m 'baseline'", { cwd: tmp });
  const baselineRef = execSync("git rev-parse HEAD", { cwd: tmp, encoding: "utf-8" }).trim();
  return {
    cwd: tmp, baselineRef,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

describe("cleanBenchmarkWorktreeHard", () => {
  it("resets dirty tracked files and removes untracked files", () => {
    const { cwd, baselineRef, cleanup } = makeMiniRepo();
    try {
      // Pollute: modify tracked file + add untracked
      fs.writeFileSync(path.join(cwd, "README.md"), "DIRTY\n");
      fs.writeFileSync(path.join(cwd, "scratch.txt"), "untracked\n");

      cleanBenchmarkWorktreeHard(cwd, baselineRef);

      // README restored, scratch.txt removed
      assert.equal(fs.readFileSync(path.join(cwd, "README.md"), "utf-8"), "baseline\n");
      assert.equal(fs.existsSync(path.join(cwd, "scratch.txt")), false);
    } finally { cleanup(); }
  });

  it("rm -rf .dsh runtime directory entirely (not just task-state.json)", () => {
    const { cwd, baselineRef, cleanup } = makeMiniRepo();
    try {
      fs.mkdirSync(path.join(cwd, ".dsh", "handoff"), { recursive: true });
      fs.mkdirSync(path.join(cwd, ".dsh", "snapshots"), { recursive: true });
      fs.writeFileSync(path.join(cwd, ".dsh", "config.yml"), "stale\n");
      fs.writeFileSync(path.join(cwd, ".dsh", "task-state.json"), "{}\n");
      fs.writeFileSync(path.join(cwd, ".dsh", "handoff", "report.md"), "old\n");

      cleanBenchmarkWorktreeHard(cwd, baselineRef);

      assert.equal(fs.existsSync(path.join(cwd, ".dsh")), false);
    } finally { cleanup(); }
  });

  it("removes top-level + submodule build outputs (target/dist/.next/etc)", () => {
    const { cwd, baselineRef, cleanup } = makeMiniRepo();
    try {
      fs.mkdirSync(path.join(cwd, "target", "classes"), { recursive: true });
      fs.mkdirSync(path.join(cwd, "dist"), { recursive: true });
      fs.mkdirSync(path.join(cwd, ".next"), { recursive: true });
      fs.mkdirSync(path.join(cwd, "backend", "target"), { recursive: true });
      fs.mkdirSync(path.join(cwd, "frontend", "dist"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "target", "x.class"), "");
      fs.writeFileSync(path.join(cwd, "backend", "target", "y.jar"), "");

      cleanBenchmarkWorktreeHard(cwd, baselineRef);

      for (const p of ["target", "dist", ".next", "backend/target", "frontend/dist"]) {
        assert.equal(fs.existsSync(path.join(cwd, p)), false, `${p} should be removed`);
      }
    } finally { cleanup(); }
  });

  it("recursively cleans Python __pycache__ and .pyc files", () => {
    const { cwd, baselineRef, cleanup } = makeMiniRepo();
    try {
      fs.mkdirSync(path.join(cwd, "src", "deep", "nested", "__pycache__"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "src", "deep", "nested", "__pycache__", "x.pyc"), "");
      fs.writeFileSync(path.join(cwd, "src", "stray.pyc"), "");
      fs.mkdirSync(path.join(cwd, ".pytest_cache"), { recursive: true });
      fs.mkdirSync(path.join(cwd, ".mypy_cache"), { recursive: true });

      cleanBenchmarkWorktreeHard(cwd, baselineRef);

      assert.equal(fs.existsSync(path.join(cwd, "src", "deep", "nested", "__pycache__")), false);
      assert.equal(fs.existsSync(path.join(cwd, "src", "stray.pyc")), false);
      assert.equal(fs.existsSync(path.join(cwd, ".pytest_cache")), false);
      assert.equal(fs.existsSync(path.join(cwd, ".mypy_cache")), false);
    } finally { cleanup(); }
  });

  it("does NOT cross node_modules into __pycache__ cleanup (preserves deps)", () => {
    const { cwd, baselineRef, cleanup } = makeMiniRepo();
    try {
      // node_modules is gitignored AND should be preserved by hard cleanup
      // (re-installing deps × 144 trials would add 2-4 hr wallclock).
      fs.mkdirSync(path.join(cwd, "node_modules", "fake-pkg"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "node_modules", "fake-pkg", "index.js"), "module.exports={}");
      // Plant a __pycache__ INSIDE node_modules — should NOT be touched
      fs.mkdirSync(path.join(cwd, "node_modules", "fake-pkg", "__pycache__"), { recursive: true });

      cleanBenchmarkWorktreeHard(cwd, baselineRef);

      assert.equal(fs.existsSync(path.join(cwd, "node_modules", "fake-pkg", "index.js")), true);
      assert.equal(fs.existsSync(path.join(cwd, "node_modules", "fake-pkg", "__pycache__")), true);
    } finally { cleanup(); }
  });

  it("is idempotent on already-clean cwd (no throw, no side effects)", () => {
    const { cwd, baselineRef, cleanup } = makeMiniRepo();
    try {
      // Run twice — second should noop without error
      cleanBenchmarkWorktreeHard(cwd, baselineRef);
      cleanBenchmarkWorktreeHard(cwd, baselineRef);
      assert.equal(fs.readFileSync(path.join(cwd, "README.md"), "utf-8"), "baseline\n");
    } finally { cleanup(); }
  });

  it("groupIdToClean=null/undefined skips Maven local repo step", () => {
    const { cwd, baselineRef, cleanup } = makeMiniRepo();
    try {
      // Should run without trying to access ~/.m2
      assert.doesNotThrow(() => cleanBenchmarkWorktreeHard(cwd, baselineRef));
      assert.doesNotThrow(() => cleanBenchmarkWorktreeHard(cwd, baselineRef, null));
      assert.doesNotThrow(() => cleanBenchmarkWorktreeHard(cwd, baselineRef, undefined));
    } finally { cleanup(); }
  });

  it("groupIdToClean targets only the specified subtree under ~/.m2/repository/", () => {
    const { cwd, baselineRef, cleanup } = makeMiniRepo();
    // Stage a fake ~/.m2 layout in a tmp HOME
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-fake-home-"));
    const m2 = path.join(fakeHome, ".m2", "repository");
    const targetGroup = path.join(m2, "io", "releasehub", "x");
    const otherGroup = path.join(m2, "io", "other", "x");
    fs.mkdirSync(targetGroup, { recursive: true });
    fs.mkdirSync(otherGroup, { recursive: true });
    fs.writeFileSync(path.join(targetGroup, "x.jar"), "");
    fs.writeFileSync(path.join(otherGroup, "x.jar"), "");

    const origHome = process.env["HOME"];
    process.env["HOME"] = fakeHome;
    try {
      cleanBenchmarkWorktreeHard(cwd, baselineRef, "io/releasehub");
      assert.equal(fs.existsSync(targetGroup), false, "target groupId should be cleaned");
      assert.equal(fs.existsSync(otherGroup), true, "unrelated groupId should be preserved");
    } finally {
      if (origHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = origHome;
      fs.rmSync(fakeHome, { recursive: true, force: true });
      cleanup();
    }
  });
});
