import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import type { DeepSeekClient } from "@dsh/provider";
import { detectProtocolOpsFromText } from "@dsh/core";
import type { ProtocolOp } from "@dsh/core";
import { runPlan, runPatch, runVerify, runRepair, runHandoff } from "@dsh/core";
import { writeDshConfig, getBaseBranch } from "@dsh/repo";
import { PROTOCOL_OP_SCHEMA } from "./task-fixtures.js";
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
    expectedProtocolOps: (fixture.expectedProtocolOperations ?? []).filter(
      (op): op is ProtocolOp => PROTOCOL_OP_SCHEMA.safeParse(op).success,
    ),
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
  lines.push("# 对比报告");
  lines.push("");
  lines.push(`| 指标 | ${report.toolA.name} | ${report.toolB.name} |`);
  lines.push("|--------|---------------------|---------------------|");
  lines.push(`| 胜出 | ${report.comparison.aWins} | ${report.comparison.bWins} |`);
  lines.push(`| 平局 | ${report.comparison.ties} | |`);
  lines.push(`| 均分 | ${report.comparison.aAvgScore.toFixed(1)} | ${report.comparison.bAvgScore.toFixed(1)} |`);
  lines.push("");

  lines.push("## 逐任务结果");
  lines.push("");
  lines.push("| 任务 | dsh 分数 | 基线分数 | 胜者 |");
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
  } catch (e: unknown) {
    // Only suppress "branch -D" when the branch simply doesn't exist
    if (args.startsWith("branch -D")) {
      const msg = (e as { stderr?: string }).stderr ?? "";
      if (msg.includes("not found") || msg.includes("did not match") || msg === "") return;
    }
    const err = e as { message?: string };
    throw new Error(
      `git ${args} failed in ${cwd}: ${err?.message ?? String(e)}`,
      { cause: e },
    );
  }
}

function prepareBranch(cwd: string, taskId: string): void {
  const base = getBaseBranch(cwd);
  const branchName = `dsh-bench-${taskId}`;
  gitQuiet(cwd, `checkout ${base}`);
  gitQuiet(cwd, `branch -D ${branchName}`);
  gitQuiet(cwd, `checkout -b ${branchName}`);
}

function resetToMain(cwd: string): void {
  const base = getBaseBranch(cwd);
  gitQuiet(cwd, "reset --hard");
  gitQuiet(cwd, `checkout ${base}`);
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
    const dshDir = path.join(repoPath, ".dsh");
    fs.mkdirSync(dshDir, { recursive: true });

    // writeDshConfig merges with existing — api_key and other fields preserved
    writeDshConfig(repoPath, {
      project: { name: path.basename(repoPath), language: "python", package_manager: "pip" },
      verify: {
        test: fixture.verificationCommands[0] ?? "",
        lint: "",
        typecheck: "",
      },
      deepseek: {
        default_model: "deepseek-v4-pro",
        flash_model: "deepseek-v4-flash",
        max_repair_rounds: fixture.maxRepairRounds ?? 3,
        thinking_default: true,
      },
    });

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
      const msg = `handoff failed: ${e instanceof Error ? e.message : String(e)}`;
      result.error = msg;
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


const ALL_PROTOCOL_OPS: readonly ProtocolOp[] = ["CREATE", "PATCH", "SEARCH_REPLACE", "INSERT", "DELETE", "RENAME"];

// ---- Report ----

export function formatEvaluationReport(results: TaskResult[]): string {
  const lines: string[] = [];

  lines.push("# DSH 评测报告");
  lines.push("");

  // 概览
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

  lines.push("## 概览");
  lines.push("");
  lines.push("| 指标 | 数值 |");
  lines.push("|--------|-------|");
  lines.push(`| 任务完成率 | ${completed}/${total} (${total > 0 ? ((completed / total) * 100).toFixed(0) : 0}%) |`);
  lines.push(`| 均分 | ${avgScore.toFixed(1)} |`);
  lines.push(`| 修复成功率 | ${repairSucceeded}/${repairAttempted || "N/A"} |`);
  lines.push(`| 平均修复轮数 | ${avgRepairRounds.toFixed(1)} |`);
  lines.push(`| 平均人工介入 | ${avgInterventions.toFixed(1)} |`);
  lines.push("");

  // 协议操作覆盖
  lines.push("## 协议操作覆盖");
  lines.push("");
  lines.push("| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |");
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

  // 逐任务详情
  lines.push("## 逐任务详情");
  lines.push("");

  for (const r of results) {
    const score = scoreResult(r);
    lines.push(`### ${r.fixtureId} (${r.category}) — 分数: ${score}/100`);
    lines.push("");
    lines.push("| 维度 | 结果 |");
    lines.push("|-----------|--------|");
    lines.push(`| 完成 | ${r.completed ? "✓" : "✗"} |`);
    lines.push(`| 修改文件 | ${r.filesChanged.join(", ") || "(无)"} |`);
    lines.push(`| 预期文件 | ${r.filesExpected.join(", ")} |`);
    lines.push(`| 范围越界 | ${r.scopeViolation ? "✗ (额外: " + r.extraFiles.join(", ") + ")" : "✓"} |`);
    lines.push(`| 测试通过 | ${r.testsPassed ? "✓" : "✗"} |`);
    lines.push(`| 修复轮数 | ${r.repairRounds} |`);
    lines.push(`| 修复成功 | ${r.repairSuccess ? "✓" : "✗"} |`);
    lines.push(`| 规则违规 | ${r.ruleViolations.length > 0 ? r.ruleViolations.join(", ") : "0"} |`);
    lines.push(`| 交接质量 | ${r.handoffQuality}/3 |`);
    lines.push(`| 耗时 | ${(r.durationMs / 1000).toFixed(1)}s |`);
    if (r.error) {
      lines.push(`| 错误 | ${r.error} |`);
    }
    lines.push("");
  }

  // 失败分析
  const failures = results.filter((r) => !r.completed || !r.testsPassed);
  if (failures.length > 0) {
    lines.push("## 失败分析");
    lines.push("");
    for (const f of failures) {
      const reasons: string[] = [];
      if (!f.completed) reasons.push("任务未完成");
      if (f.scopeViolation) reasons.push("范围越界");
      if (!f.testsPassed && !f.repairSuccess) reasons.push("修复耗尽");
      if (f.ruleViolations.length > 0) reasons.push("规则违规: " + f.ruleViolations.join(", "));
      lines.push(`- **${f.fixtureId}**: ${reasons.join("; ") || "未知"}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
