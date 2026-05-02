import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import type { DeepSeekClient } from "@dsh/provider";
import type { ProtocolOp } from "./task-fixtures.js";
import type { LoadedFixture } from "./task-fixtures.js";

// ---- Existing Types ----

export interface TaskResult {
  fixtureId: string;
  category: string;
  completed: boolean;
  filesChanged: string[];
  filesExpected: string[];
  extraFiles: string[];
  scopeViolation: boolean;
  testsPassed: boolean;
  repairRounds: number;
  repairSuccess: boolean;
  ruleViolations: string[];
  manualInterventions: number;
  handoffQuality: number; // 0-3
  durationMs: number;
  error?: string;
  expectedProtocolOps: ProtocolOp[];
  actualProtocolOps: ProtocolOp[];
}

// ---- Existing Functions ----

export function createEmptyResult(fixture: LoadedFixture): TaskResult {
  return {
    fixtureId: fixture.id,
    category: fixture.category,
    completed: false,
    filesChanged: [],
    filesExpected: fixture.expectedFiles,
    extraFiles: [],
    scopeViolation: false,
    testsPassed: false,
    repairRounds: 0,
    repairSuccess: false,
    ruleViolations: [],
    manualInterventions: 0,
    handoffQuality: 0,
    durationMs: 0,
    expectedProtocolOps: (fixture.expectedProtocolOperations as ProtocolOp[]) ?? [],
    actualProtocolOps: [],
  };
}

export function scoreResult(result: TaskResult): number {
  let score = 0;

  // Task completion (40%)
  if (result.completed) score += 40;

  // Tests pass (25%)
  if (result.testsPassed) score += 25;

  // No scope violation (10%)
  if (!result.scopeViolation) score += 10;

  // No rule violations (10%)
  if (result.ruleViolations.length === 0) score += 10;

  // Repair success or no repair needed (10%)
  if (result.repairSuccess || (result.repairRounds === 0 && result.completed)) score += 10;

  // Handoff quality (5%)
  score += Math.min(result.handoffQuality * 2, 5);

  return Math.min(score, 100);
}

export interface ComparisonReport {
  toolA: { name: string; results: TaskResult[] };
  toolB: { name: string; results: TaskResult[] };
  comparison: {
    aWins: number;
    bWins: number;
    ties: number;
    aAvgScore: number;
    bAvgScore: number;
  };
}

export function compareResults(
  nameA: string,
  resultsA: TaskResult[],
  nameB: string,
  resultsB: TaskResult[],
): ComparisonReport {
  let aWins = 0;
  let bWins = 0;
  let ties = 0;

  const aScores = resultsA.map(scoreResult);
  const bScores = resultsB.map(scoreResult);

  for (let i = 0; i < Math.max(aScores.length, bScores.length); i++) {
    const a = aScores[i] ?? 0;
    const b = bScores[i] ?? 0;
    if (a > b) aWins++;
    else if (b > a) bWins++;
    else ties++;
  }

  return {
    toolA: { name: nameA, results: resultsA },
    toolB: { name: nameB, results: resultsB },
    comparison: {
      aWins,
      bWins,
      ties,
      aAvgScore: aScores.length > 0 ? aScores.reduce((s, v) => s + v, 0) / aScores.length : 0,
      bAvgScore: bScores.length > 0 ? bScores.reduce((s, v) => s + v, 0) / bScores.length : 0,
    },
  };
}

export function formatComparisonReport(report: ComparisonReport): string {
  const lines: string[] = [];
  lines.push("# Comparison Report");
  lines.push("");
  lines.push(`| Metric | ${report.toolA.name} | ${report.toolB.name} |`);
  lines.push("|--------|---------------------|---------------------|");
  lines.push(`| Wins | ${report.comparison.aWins} | ${report.comparison.bWins} |`);
  lines.push(`| Ties | ${report.comparison.ties} | |`);
  lines.push(`| Avg Score | ${report.comparison.aAvgScore.toFixed(1)} | ${report.comparison.bAvgScore.toFixed(1)} |`);
  lines.push("");

  lines.push("## Per-Task Results");
  lines.push("");
  lines.push("| Task | dsh Score | Baseline Score | Winner |");
  lines.push("|------|-----------|----------------|--------|");

  for (let i = 0; i < report.toolA.results.length; i++) {
    const aScore = scoreResult(report.toolA.results[i]!);
    const bScore = scoreResult(report.toolB.results[i]!);
    const winner = aScore > bScore ? "dsh" : bScore > aScore ? "Baseline" : "Tie";
    lines.push(`| ${report.toolA.results[i]!.fixtureId} | ${aScore} | ${bScore} | ${winner} |`);
  }

  return lines.join("\n");
}

// ---- Git helpers (internal) ----

function gitQuiet(cwd: string, args: string): void {
  try {
    execSync(`git ${args}`, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
  } catch {
    // best effort
  }
}

function prepareBranch(cwd: string, taskId: string): void {
  const branchName = `dsh-bench-${taskId}`;
  gitQuiet(cwd, "checkout main");
  gitQuiet(cwd, `branch -D ${branchName}`);
  gitQuiet(cwd, `checkout -b ${branchName}`);
}

function resetToMain(cwd: string): void {
  gitQuiet(cwd, "reset --hard");
  gitQuiet(cwd, "checkout main");
}

// ---- Benchmark execution ----

export async function runTask(
  fixture: LoadedFixture,
  repoPath: string,
  client: DeepSeekClient,
): Promise<TaskResult> {
  const startTime = Date.now();
  const result = createEmptyResult(fixture);
  let repairRounds = 0;
  let repairSuccess = false;
  let handoffQuality = 0;

  try {
    // 1. Git prepare
    prepareBranch(repoPath, fixture.id);

    // 2. Setup dsh config
    const { runPlan, runPatch, runVerify, runRepair, runHandoff } = await import("@dsh/core");
    const yaml = await import("js-yaml");

    const dshDir = path.join(repoPath, ".dsh");
    fs.mkdirSync(dshDir, { recursive: true });

    const config = {
      project: { name: path.basename(repoPath), language: "python", package_manager: "pip" },
      verify: {
        test: fixture.verificationCommands[0] ?? "",
        lint: "",
        typecheck: "",
      },
      rules: { files: [] },
      deepseek: {
        default_model: "deepseek-v4-pro",
        flash_model: "deepseek-v4-flash",
        max_repair_rounds: fixture.maxRepairRounds ?? 3,
        thinking_default: true,
        api_key: "",
      },
    };
    fs.writeFileSync(
      path.join(dshDir, "config.yml"),
      yaml.dump(config, { lineWidth: -1, noRefs: true }),
      "utf-8",
    );

    // 3. Plan
    let state = await runPlan({
      cwd: repoPath,
      client,
      description: fixture.taskPrompt,
      taskType: fixture.category as "bugfix" | "feature" | "refactor" | "test" | "docs",
    });

    // 4. Patch (auto)
    state = await runPatch({ cwd: repoPath, client, auto: true });

    // Record files changed
    result.filesChanged = state.patches.at(-1)?.files_changed ?? [];

    // Detect actual protocol ops from the stored patch text (best-effort)
    result.actualProtocolOps = detectProtocolOpsFromText(state.patches.at(-1)?.patch ?? "");

    // 5. Verify
    if (fixture.verificationCommands.length > 0) {
      try {
        state = await runVerify({ cwd: repoPath });

        if (state.status === "verification_failed") {
          // 6. Repair
          try {
            state = await runRepair({
              cwd: repoPath,
              client,
              maxRounds: fixture.maxRepairRounds ?? 3,
            });
            repairRounds = state.repair_rounds;
            repairSuccess = state.status === "verified";
          } catch (repairErr) {
            result.error = `repair failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}`;
          }
        }
      } catch (verifyErr) {
        const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
        if (msg.includes("没有配置验证命令")) {
          // No verify commands configured — non-critical
        } else {
          result.error = `verify failed: ${msg}`;
        }
      }
    }

    // 7. Handoff
    try {
      await runHandoff({ cwd: repoPath });
      handoffQuality = 2;
    } catch (e) {
      console.warn(`[benchmark] handoff failed for ${fixture.id}: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 8. Assess results
    result.completed = true;
    result.testsPassed = state.status === "verified";

    // Scope check
    const extraFiles = result.filesChanged.filter(
      (f: string) => !fixture.expectedFiles.some((ef: string) => f.endsWith(ef) || ef.endsWith(f)),
    );
    result.extraFiles = extraFiles;
    result.scopeViolation = extraFiles.length > 0;

  } catch (err) {
    result.completed = false;
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    resetToMain(repoPath);
  }

  result.repairRounds = repairRounds;
  result.repairSuccess = repairSuccess;
  result.handoffQuality = handoffQuality;
  result.durationMs = Date.now() - startTime;

  return result;
}

export async function runAll(
  fixtures: LoadedFixture[],
  repoPath: string,
  client: DeepSeekClient,
): Promise<TaskResult[]> {
  const results: TaskResult[] = [];
  for (const fixture of fixtures) {
    const result = await runTask(fixture, repoPath, client);
    results.push(result);
  }
  return results;
}

// ---- Detect protocol ops from patch text ----

export function detectProtocolOpsFromText(patchText: string): ProtocolOp[] {
  const ops: ProtocolOp[] = [];
  const found = new Set<ProtocolOp>();

  // Match each protocol tag individually to avoid cross-tag interference
  for (const match of patchText.matchAll(/<(\w+)(\s[^>]*)?>/gi)) {
    const tag = match[1]!.toUpperCase();
    const attrs = match[2] ?? "";

    if (tag === "CREATE") found.add("CREATE");
    if (tag === "INSERT") found.add("INSERT");
    if (tag === "DELETE") found.add("DELETE");
    if (tag === "RENAME") found.add("RENAME");
    if (tag === "PATCH") {
      if (/type\s*=\s*"search"/i.test(attrs)) {
        found.add("SEARCH_REPLACE");
      } else {
        found.add("PATCH");
      }
    }
  }

  for (const op of found) ops.push(op);
  return ops;
}

const ALL_PROTOCOL_OPS: readonly ProtocolOp[] = ["CREATE", "PATCH", "SEARCH_REPLACE", "INSERT", "DELETE", "RENAME"];

// ---- Report ----

export function formatEvaluationReport(results: TaskResult[]): string {
  const lines: string[] = [];

  lines.push("# DSH Evaluation Report");
  lines.push("");

  // Overview
  const completed = results.filter((r) => r.completed).length;
  const total = results.length;
  const avgScore = total > 0
    ? results.reduce((s, r) => s + scoreResult(r), 0) / total
    : 0;
  const repairAttempted = results.filter((r) => r.repairRounds > 0).length;
  const repairSucceeded = results.filter((r) => r.repairSuccess).length;
  const avgRepairRounds = repairAttempted > 0
    ? results.filter((r) => r.repairRounds > 0).reduce((s, r) => s + r.repairRounds, 0) / repairAttempted
    : 0;
  const avgInterventions = total > 0
    ? results.reduce((s, r) => s + r.manualInterventions, 0) / total
    : 0;

  lines.push("## Overview");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Task completion rate | ${completed}/${total} (${total > 0 ? ((completed / total) * 100).toFixed(0) : 0}%) |`);
  lines.push(`| Average score | ${avgScore.toFixed(1)} |`);
  lines.push(`| Repair success rate | ${repairSucceeded}/${repairAttempted || "N/A"} |`);
  lines.push(`| Avg repair rounds | ${avgRepairRounds.toFixed(1)} |`);
  lines.push(`| Avg manual interventions | ${avgInterventions.toFixed(1)} |`);
  lines.push("");

  // Protocol Operation Coverage
  lines.push("## Protocol Operation Coverage");
  lines.push("");
  lines.push("| Operation | Expected (fixtures) | Actual (triggered) | Success Rate |");
  lines.push("|-----------|---------------------|---------------------|--------------|");
  for (const op of ALL_PROTOCOL_OPS) {
    const expected = results.filter((r) => r.expectedProtocolOps.includes(op)).length;
    const triggered = results.filter((r) => r.actualProtocolOps.includes(op)).length;
    const triggeredCompleted = results.filter(
      (r) => r.actualProtocolOps.includes(op) && r.completed,
    ).length;
    const rate = triggered > 0 ? `${((triggeredCompleted / triggered) * 100).toFixed(0)}%` : "N/A";
    lines.push(`| ${op} | ${expected} | ${triggered} | ${rate} |`);
  }
  lines.push("");

  // Per-Task Detail
  lines.push("## Per-Task Detail");
  lines.push("");

  for (const r of results) {
    const score = scoreResult(r);
    lines.push(`### ${r.fixtureId} (${r.category}) — Score: ${score}/100`);
    lines.push("");
    lines.push("| Dimension | Result |");
    lines.push("|-----------|--------|");
    lines.push(`| Completed | ${r.completed ? "✓" : "✗"} |`);
    lines.push(`| Files modified | ${r.filesChanged.join(", ") || "(none)"} |`);
    lines.push(`| Expected files | ${r.filesExpected.join(", ")} |`);
    lines.push(`| Scope violation | ${r.scopeViolation ? "✗ (extra: " + r.extraFiles.join(", ") + ")" : "✓"} |`);
    lines.push(`| Tests passed | ${r.testsPassed ? "✓" : "✗"} |`);
    lines.push(`| Repair rounds | ${r.repairRounds} |`);
    lines.push(`| Repair success | ${r.repairSuccess ? "✓" : "✗"} |`);
    lines.push(`| Rule violations | ${r.ruleViolations.length > 0 ? r.ruleViolations.join(", ") : "0"} |`);
    lines.push(`| Handoff quality | ${r.handoffQuality}/3 |`);
    lines.push(`| Duration | ${(r.durationMs / 1000).toFixed(1)}s |`);
    if (r.error) {
      lines.push(`| Error | ${r.error} |`);
    }
    lines.push("");
  }

  // Failure Analysis
  const failures = results.filter((r) => !r.completed || !r.testsPassed);
  if (failures.length > 0) {
    lines.push("## Failure Analysis");
    lines.push("");
    for (const f of failures) {
      const reasons: string[] = [];
      if (!f.completed) reasons.push("task incomplete");
      if (f.scopeViolation) reasons.push("scope creep");
      if (!f.testsPassed && !f.repairSuccess) reasons.push("repair exhausted");
      if (f.ruleViolations.length > 0) reasons.push("rule violations: " + f.ruleViolations.join(", "));
      lines.push(`- **${f.fixtureId}**: ${reasons.join("; ") || "unknown"}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
