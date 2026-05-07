import { execFileSync, execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import type { DeepSeekClient } from "@dsh/provider";
import { detectProtocolOpsFromText, readTaskState } from "@dsh/core";
import type { ProtocolOp } from "@dsh/core";
import { runPlan, runPatch, runVerify, runRepair, runHandoff } from "@dsh/core";
import { writeDshConfig, getBaseBranch, detectTechStack } from "@dsh/repo";
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
  toolRounds: number;
  toolCalls: { name: string; status: string }[];
  patchRounds: number;
  patchRoundActions: { round: number; action: string; toolCalls?: { name: string; status: string }[] }[];
  verifyOutput: { command: string }[];
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
    toolRounds: 0,
    toolCalls: [],
    patchRounds: 0,
    patchRoundActions: [],
    verifyOutput: [],
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

function gitQuietFile(cwd: string, args: string[]): void {
  try {
    execFileSync("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
  } catch (e: unknown) {
    const err = e as { message?: string };
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${err?.message ?? String(e)}`,
      { cause: e },
    );
  }
}

export function cleanBenchmarkWorktree(cwd: string): void {
  gitQuiet(cwd, "reset --hard");
  gitQuiet(cwd, "clean -fd");
}

export function normalizeVerificationCommands(commands: string[]): string[] {
  return commands.map((cmd) => cmd.trim()).filter(Boolean);
}

function installFrontendDeps(cwd: string): void {
  const pkgJson = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgJson)) return;
  try {
    execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd, stdio: "pipe", timeout: 120_000 });
  } catch {
    // non-fatal
  }
}

function installBackendDeps(cwd: string): void {
  const pomXml = path.join(cwd, "pom.xml");
  if (!fs.existsSync(pomXml)) return;
  try {
    execFileSync("mvn", ["dependency:resolve", "-q"], { cwd, stdio: "pipe", timeout: 180_000 });
  } catch {
    // non-fatal
  }
}

function installBenchmarkDeps(repoPath: string): void {
  installFrontendDeps(path.join(repoPath, "frontend"));
  installBackendDeps(path.join(repoPath, "backend"));
}

function resolveBenchmarkRunRef(cwd: string, fixture: Pick<LoadedFixture, "benchmarkRef">): string {
  return fixture.benchmarkRef?.commit
    ?? fixture.benchmarkRef?.branch
    ?? getBaseBranch(cwd);
}

function resolveBenchmarkReturnRef(cwd: string, fixture: Pick<LoadedFixture, "benchmarkRef">): string {
  return fixture.benchmarkRef?.branch
    ?? fixture.benchmarkRef?.commit
    ?? getBaseBranch(cwd);
}

function assertPreflightFiles(cwd: string, fixture: Pick<LoadedFixture, "id" | "preflightFiles">): void {
  const missing: string[] = [];
  for (const file of fixture.preflightFiles ?? []) {
    try {
      execFileSync("git", ["ls-files", "--error-unmatch", "--", file], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
      });
    } catch {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `fixture ${fixture.id} preflight failed: tracked file(s) missing from benchmark base: ${missing.join(", ")}`,
    );
  }
}

export function prepareBenchmarkBranch(
  cwd: string,
  fixture: Pick<LoadedFixture, "id" | "benchmarkRef" | "preflightFiles">,
): void {
  const base = resolveBenchmarkRunRef(cwd, fixture);
  const branchName = `dsh-bench-${fixture.id}`;
  cleanBenchmarkWorktree(cwd);
  gitQuietFile(cwd, ["checkout", base]);
  cleanBenchmarkWorktree(cwd);
  assertPreflightFiles(cwd, fixture);
  gitQuiet(cwd, `branch -D ${branchName}`);
  gitQuietFile(cwd, ["checkout", "-b", branchName]);
  cleanBenchmarkWorktree(cwd);
}

function resetToBenchmarkBase(cwd: string, fixture: Pick<LoadedFixture, "benchmarkRef">): void {
  const base = resolveBenchmarkReturnRef(cwd, fixture);
  cleanBenchmarkWorktree(cwd);
  gitQuietFile(cwd, ["checkout", base]);
  cleanBenchmarkWorktree(cwd);
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
    prepareBenchmarkBranch(repoPath, fixture);

    // 1b. Install deps so verify commands (pnpm typecheck / mvn test) work
    installBenchmarkDeps(repoPath);

    // 2. Clean stale state from previous runs + setup
    const dshDir = path.join(repoPath, ".dsh");
    fs.rmSync(path.join(dshDir, "task-state.json"), { force: true });
    fs.mkdirSync(dshDir, { recursive: true });
    const stack = detectTechStack(repoPath);

    // writeDshConfig merges with existing — only override verify + deepseek, preserve project metadata
    writeDshConfig(repoPath, {
      project: {
        name: path.basename(repoPath),
        language: stack.language,
        package_manager: stack.packageManager ?? "unknown",
      },
      verify: {
        commands: normalizeVerificationCommands(fixture.verificationCommands),
        test: "",
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

    // Record tool usage — prefer v0.4 patch_rounds data when available
    if (state.patch_rounds && state.patch_rounds.length > 0) {
      // v0.4: tools are tracked inside patch_rounds as "tools" action rounds
      const toolActionRounds = state.patch_rounds.filter((pr) => pr.action === "tools");
      result.toolRounds = toolActionRounds.length;
      result.toolCalls = toolActionRounds.flatMap((pr) =>
        (pr.tool_calls ?? []).map((tc) => ({ name: tc.name, status: tc.status })),
      );
    } else {
      // v0.3: tools are in tool_rounds
      result.toolRounds = state.tool_rounds?.length ?? 0;
      result.toolCalls = (state.tool_rounds ?? []).flatMap((tr) =>
        tr.calls.map((c) => ({ name: c.name, status: c.status })),
      );
    }

    // Record patch loop stats (v0.4)
    result.patchRounds = state.patch_rounds?.length ?? 0;
    result.patchRoundActions = (state.patch_rounds ?? []).map((pr) => ({
      round: pr.round,
      action: pr.action,
      toolCalls:
        pr.action === "tools" && pr.tool_calls
          ? pr.tool_calls.map((tc) => ({ name: tc.name, status: tc.status }))
          : undefined,
    }));

    // 5. Verify
    if (fixture.verificationCommands.length > 0) {
      try {
        state = await runVerify({ cwd: repoPath });
        // Capture verify output for diagnosis
        result.verifyOutput = (state.verify_results ?? []).map((vr) => ({
          command: (vr.results as Array<{ status: string; command: string; output: string }> | undefined)
            ?.map((r) => `${r.status}: ${r.command}\n${r.output?.slice(0, 500)}`)
            .join("\n") ?? "",
        }));

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
    // Recover stats from disk — even when the pipeline throws, task-state.json
    // is already written. Without this, tool_rounds/files_changed get reported
    // as zero/empty for any patch-failed fixture.
    const stateOnDisk = readTaskState(repoPath);
    if (stateOnDisk) {
      result.patchRounds = stateOnDisk.patch_rounds?.length ?? 0;
      result.patchRoundActions = (stateOnDisk.patch_rounds ?? []).map((pr) => ({
        round: pr.round,
        action: pr.action,
        toolCalls:
          pr.action === "tools" && pr.tool_calls
            ? pr.tool_calls.map((tc) => ({ name: tc.name, status: tc.status }))
            : undefined,
      }));

      if (result.patchRounds > 0) {
        // v0.4: consolidate from patch_rounds
        const toolsRounds = result.patchRoundActions.filter((a) => a.action === "tools");
        result.toolRounds = toolsRounds.length;
        result.toolCalls = toolsRounds.flatMap((a) => a.toolCalls ?? []);
      } else {
        result.toolRounds = stateOnDisk.tool_rounds?.length ?? 0;
        result.toolCalls = (stateOnDisk.tool_rounds ?? []).flatMap((tr) =>
          tr.calls.map((c) => ({ name: c.name, status: c.status })),
        );
      }

      const lastPatch = stateOnDisk.patches.at(-1);
      if (lastPatch) {
        result.filesChanged = lastPatch.files_changed;
        result.actualProtocolOps = detectProtocolOpsFromText(lastPatch.patch);
      }
    }
  } finally {
    resetToBenchmarkBase(repoPath, fixture);
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
  // 工具使用统计
  const toolUsedResults = results.filter((r) => r.toolRounds > 0);
  const totalToolCalls = results.reduce((s, r) => s + r.toolCalls.length, 0);
  const totalToolRounds = results.reduce((s, r) => s + r.toolRounds, 0);
  const toolSuccessCalls = results.reduce((s, r) => s + r.toolCalls.filter((c) => c.status === "success").length, 0);

  lines.push("## 工具使用");
  lines.push("");
  lines.push("| 指标 | 数值 |");
  lines.push("|--------|-------|");
  lines.push(`| 使用工具的 fixture | ${toolUsedResults.length}/${total} |`);
  lines.push(`| 工具调用总轮次 | ${totalToolRounds} |`);
  lines.push(`| 工具调用总次数 | ${totalToolCalls} |`);
  lines.push(`| 调用成功率 | ${totalToolCalls > 0 ? ((toolSuccessCalls / totalToolCalls) * 100).toFixed(0) + "%" : "N/A"} |`);
  if (totalToolCalls > 0) {
    // Per-tool breakdown (only known tool names; model sometimes hallucinates
    // protocol operation names as tools — those are aggregated under "其他无效调用")
    const VALID_TOOL_NAMES = new Set(["read_file", "grep_files", "exec_shell"]);
    const toolCounts: Record<string, { total: number; success: number }> = {};
    let invalidTotal = 0;
    let invalidSuccess = 0;
    for (const r of results) {
      for (const c of r.toolCalls) {
        if (VALID_TOOL_NAMES.has(c.name)) {
          if (!toolCounts[c.name]) toolCounts[c.name] = { total: 0, success: 0 };
          toolCounts[c.name]!.total++;
          if (c.status === "success") toolCounts[c.name]!.success++;
        } else {
          invalidTotal++;
          if (c.status === "success") invalidSuccess++;
        }
      }
    }
    lines.push("");
    lines.push("| 工具 | 调用次数 | 成功率 |");
    lines.push("|--------|-----------|--------|");
    for (const [name, counts] of Object.entries(toolCounts)) {
      const rate = ((counts.success / counts.total) * 100).toFixed(0) + "%";
      lines.push(`| ${name} | ${counts.total} | ${rate} |`);
    }
    if (invalidTotal > 0) {
      const rate = ((invalidSuccess / invalidTotal) * 100).toFixed(0) + "%";
      lines.push(`| 其他无效调用 | ${invalidTotal} | ${rate} |`);
    }
  }
  lines.push("");

  // Patch Loop 行为统计
  const resultsWithPatchLoop = results.filter((r) => r.patchRounds > 0);
  const avgPatchRounds = resultsWithPatchLoop.length > 0
    ? resultsWithPatchLoop.reduce((s, r) => s + r.patchRounds, 0) / resultsWithPatchLoop.length
    : 0;
  const allActions = resultsWithPatchLoop.flatMap((r) => r.patchRoundActions.map((a) => a.action));
  const avgChanges = resultsWithPatchLoop.length > 0
    ? allActions.filter((a) => a === "change").length / resultsWithPatchLoop.length
    : 0;
  const avgInvalid = resultsWithPatchLoop.length > 0
    ? allActions.filter((a) => a === "invalid").length / resultsWithPatchLoop.length
    : 0;
  const _doneCount = allActions.filter((a) => a === "done").length;
  const doneRate = resultsWithPatchLoop.length > 0
    ? ((resultsWithPatchLoop.filter((r) => r.patchRoundActions.some((a) => a.action === "done")).length / resultsWithPatchLoop.length) * 100).toFixed(0) + "%"
    : "N/A";
  const toolActionCount = allActions.filter((a) => a === "tools").length;

  lines.push("## Patch Loop 行为");
  lines.push("");
  lines.push("| 指标 | 数值 |");
  lines.push("|--------|-------|");
  lines.push(`| 使用 patch loop 的 fixture | ${resultsWithPatchLoop.length}/${total} |`);
  lines.push(`| 平均 patch round 数 | ${avgPatchRounds.toFixed(1)} |`);
  lines.push(`| 平均 change 块数 | ${avgChanges.toFixed(1)} |`);
  lines.push(`| 平均 invalid 轮数 | ${avgInvalid.toFixed(1)} |`);
  lines.push(`| 工具调用 action 数 | ${toolActionCount} |`);
  lines.push(`| done 主动终止率 | ${doneRate} |`);
  lines.push("");

  // Per-fixture breakdown
  if (resultsWithPatchLoop.length > 0) {
    lines.push("| Fixture | Rounds | Changes | Invalid | Tools | Done |");
    lines.push("|----------|--------|---------|---------|-------|------|");
    for (const r of resultsWithPatchLoop) {
      const actions = r.patchRoundActions.map((a) => a.action);
      const c = actions.filter((a) => a === "change").length;
      const i = actions.filter((a) => a === "invalid").length;
      const t = actions.filter((a) => a === "tools").length;
      const d = actions.includes("done") ? "✓" : "✗";
      lines.push(`| ${r.fixtureId} | ${r.patchRounds} | ${c} | ${i} | ${t} | ${d} |`);
    }
    lines.push("");
  }

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
    lines.push(`| 工具调用 | ${r.toolRounds > 0 ? r.toolRounds + " 轮, " + r.toolCalls.length + " 次" : "无"} |`);
    if (r.toolCalls.length > 0 && !r.patchRounds) {
      // v0.3: per-call breakdown is short enough
      const tc = r.toolCalls.map((c) => `${c.name}(${c.status === "success" ? "✓" : "✗"})`).join(", ");
      lines.push(`| 工具详情 | ${tc} |`);
    }
    if (r.patchRounds > 0) {
      const actions = r.patchRoundActions.map((a) => a.action);
      const changes = actions.filter((a) => a === "change").length;
      const done = actions.includes("done") ? "✓" : "✗";
      lines.push(`| Patch Loop | ${r.patchRounds} rounds, ${changes} changes, DONE=${done} |`);
      if (r.toolCalls.length > 0) {
        const VALID_TOOL_NAMES = new Set(["read_file", "grep_files", "exec_shell"]);
        const toolCounts: Record<string, number> = {};
        let toolSuccess = 0;
        let totalCalls = 0;
        for (const tc of r.toolCalls) {
          if (!VALID_TOOL_NAMES.has(tc.name)) continue;
          toolCounts[tc.name] = (toolCounts[tc.name] ?? 0) + 1;
          if (tc.status === "success") toolSuccess++;
          totalCalls++;
        }
        const detail = Object.entries(toolCounts)
          .map(([name, count]) => `${name}(${count})`)
          .join(", ");
        lines.push(`| 工具详情 | ${detail} (${totalCalls > 0 ? ((toolSuccess / totalCalls) * 100).toFixed(0) : 0}% 成功) |`);
      }
    }
    if (r.verifyOutput?.length > 0) {
      for (const vo of r.verifyOutput) {
        if (vo.command) lines.push(`| 验证输出 | ${vo.command.replace(/\n/g, "\\n").slice(0, 300)} |`);
      }
    }
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
