import { execFileSync, execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import type { DeepSeekClient } from "@dsh/provider";
import { detectProtocolOpsFromText, readTaskState } from "@dsh/core";
import type { PatchRecord, ProtocolOp, TaskState } from "@dsh/core";
import { runPlan, runPreflight, runPatch, runVerify, runRepair, runHandoff } from "@dsh/core";
import { writeDshConfig, getBaseBranch, assembleIntelligence, toLegacyTechStack } from "@dsh/repo";
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
  failureClass?: TaskFailureClass;
  plan?: {
    summary: string;
    files: string[];
    strategy: string;
    verify_strategy?: string;
    verify_commands?: string[];
  };
  expectedProtocolOps: ProtocolOp[];
  actualProtocolOps: ProtocolOp[];
  toolRounds: number;
  toolCalls: { name: string; status: string }[];
  patchRounds: number;
  patchRoundActions: { round: number; action: string; toolCalls?: { name: string; status: string }[] }[];
  verifyOutput: { command: string }[];
  diagnostics?: TaskDiagnostics;
}

export type TaskFailureClass =
  | "provider_network_error"
  | "model_protocol_plan_invalid"
  | "cleanup_failure"
  | "patch_apply_failure"
  | "verification_failure"
  | "repair_exhausted"
  | "handoff_failure"
  | "unknown_failure";

export interface TaskDiagnostics {
  finalStatus: TaskState["status"];
  verifyResults: Array<{
    round: number;
    results: Array<{
      command: string;
      status: string;
      exit_code: number;
      output: string;
      duration_ms: number;
    }>;
  }>;
  patches: Array<{
    round: number;
    apply_status: string;
    files_changed: string[];
    rolled_back?: boolean;
    rollback_reason?: string;
    patch: string;
  }>;
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

export function summarizePatchRecords(
  patches: Pick<PatchRecord, "patch" | "files_changed">[],
): { filesChanged: string[]; actualProtocolOps: ProtocolOp[] } {
  const filesChanged = new Set<string>();
  const actualProtocolOps = new Set<ProtocolOp>();

  for (const patch of patches) {
    for (const file of patch.files_changed ?? []) {
      filesChanged.add(file);
    }
    for (const op of detectProtocolOpsFromText(patch.patch ?? "")) {
      actualProtocolOps.add(op);
    }
  }

  return {
    filesChanged: [...filesChanged],
    actualProtocolOps: [...actualProtocolOps],
  };
}

export function collectTaskDiagnostics(state: TaskState): TaskDiagnostics {
  return {
    finalStatus: state.status,
    verifyResults: (state.verify_results ?? []).map((round) => ({
      round: round.round,
      results: round.results.map((result) => ({
        command: result.command,
        status: result.status,
        exit_code: result.exit_code,
        output: result.output,
        duration_ms: result.duration_ms,
      })),
    })),
    patches: (state.patches ?? []).map((patch) => ({
      round: patch.round,
      apply_status: patch.apply_status,
      files_changed: patch.files_changed,
      ...(patch.rolled_back !== undefined ? { rolled_back: patch.rolled_back } : {}),
      ...(patch.rollback_reason !== undefined ? { rollback_reason: patch.rollback_reason } : {}),
      patch: patch.patch,
    })),
  };
}

export function classifyTaskFailure(
  result: Pick<TaskResult, "testsPassed" | "completed" | "error" | "diagnostics">,
): TaskFailureClass | undefined {
  if (result.testsPassed) return undefined;

  const error = result.error ?? "";
  const lowerError = error.toLowerCase();
  const finalStatus = result.diagnostics?.finalStatus;
  const verifyResults = result.diagnostics?.verifyResults ?? [];
  const patches = result.diagnostics?.patches ?? [];

  if (error.startsWith("cleanup-failed:")) return "cleanup_failure";
  if (lowerError.includes("network error") || lowerError.includes("fetch failed") || lowerError.includes("terminated")) {
    return "provider_network_error";
  }
  if (error.includes("DeepSeek 未返回有效的 FILES 块") || error.includes("DeepSeek 未返回有效的 PLAN 块")) {
    return "model_protocol_plan_invalid";
  }
  if (error.startsWith("handoff failed:")) return "handoff_failure";
  if (finalStatus === "repair_exhausted") return "repair_exhausted";
  if (finalStatus === "patch_failed") return "patch_apply_failure";
  if (finalStatus === "verification_failed") return "verification_failure";

  const hasFailedVerify = verifyResults.some((round) =>
    round.results.some((verify) => verify.status === "failed")
  );
  if (hasFailedVerify) return "verification_failure";

  const hasFailedPatch = patches.some((patch) => patch.apply_status === "failed");
  if (hasFailedPatch) return "patch_apply_failure";

  if (finalStatus === "init" || finalStatus === "planned") return "model_protocol_plan_invalid";
  if (finalStatus === "preflighted" || finalStatus === "preflight_failed") return "patch_apply_failure";

  if (!result.completed || error) return "unknown_failure";
  return "unknown_failure";
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

/**
 * Stronger cleanup for replicated/randomized benchmark trials where state leak
 * between trials would invalidate the experiment. See spec
 * docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md §5.2 + Task E.
 *
 * Cleans:
 *   - Git working tree (reset --hard + clean -fd)
 *   - .dsh runtime state (handoff/, static-scan/, snapshots/, config.yml, task-state.json)
 *   - Build outputs in tracked-source directories: target/, build/, dist/, .next/, .turbo/, coverage/
 *   - Python bytecode caches: __pycache__/, .pytest_cache/, .mypy_cache/, .ruff_cache/, *.pyc
 *   - Fixture-local Maven install artifacts in ~/.m2/repository/<groupId> when groupIdToClean is set
 *     (mitigates stale-jar inheritance across replicated trials when the
 *     fixture's patch loop writes via `mvn install -DskipTests`).
 *
 * Preserves: node_modules/, .m2/repository (except groupIdToClean), .gradle/caches/, .venv/
 * (re-installing 24×3×2 trials would add 2-4 hr wallclock).
 *
 * @param cwd Repo working tree.
 * @param baselineRef Git ref to reset --hard to (e.g. fixture.benchmarkRef.commit).
 * @param groupIdToClean Optional Maven groupId path (e.g. "io/releasehub") whose
 *   ~/.m2/repository/<groupId> tree is removed; null/undefined skips this step.
 */
export function cleanBenchmarkWorktreeHard(
  cwd: string,
  baselineRef: string,
  groupIdToClean?: string | null,
): void {
  // 1. Git: reset to baseline + remove untracked
  gitQuietFile(cwd, ["reset", "--hard", baselineRef]);
  gitQuietFile(cwd, ["clean", "-fd"]);

  // 2. dsh runtime: full .dsh wipe
  const dshDir = path.join(cwd, ".dsh");
  if (fs.existsSync(dshDir)) {
    fs.rmSync(dshDir, { recursive: true, force: true });
  }

  // 3. Build outputs (in tracked dirs, may not be gitignored)
  for (const dir of ["target", "build", "dist", ".next", ".turbo", "coverage", "out"]) {
    const p = path.join(cwd, dir);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }

  // 3.1 Submodule-level build outputs (e.g. backend/target, frontend/dist for rh-mixed)
  for (const sub of ["backend", "frontend"]) {
    for (const dir of ["target", "build", "dist", ".next", "coverage", "node_modules/.cache"]) {
      const p = path.join(cwd, sub, dir);
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    }
  }

  // 4. Python caches (recursive)
  for (const cache of [".pytest_cache", ".mypy_cache", ".ruff_cache"]) {
    const p = path.join(cwd, cache);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  cleanPythonByteCode(cwd);

  // 5. Maven local repo for fixture-specific groupId
  if (groupIdToClean) {
    const m2Path = path.join(process.env["HOME"] ?? "", ".m2", "repository", groupIdToClean);
    if (fs.existsSync(m2Path)) fs.rmSync(m2Path, { recursive: true, force: true });
  }

  // 6. Verify clean
  const status = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf-8" });
  if (status.trim() !== "") {
    throw new Error(
      `cleanBenchmarkWorktreeHard: git status not clean after cleanup:\n${status}`,
    );
  }
}

function cleanPythonByteCode(cwd: string): void {
  function walk(dir: string, depth: number): void {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory() && e.name === "__pycache__") {
        fs.rmSync(p, { recursive: true, force: true });
      } else if (e.isFile() && e.name.endsWith(".pyc")) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      } else if (e.isDirectory()) {
        walk(p, depth + 1);
      }
    }
  }
  walk(cwd, 0);
}

export function normalizeVerificationCommands(commands: string[]): string[] {
  return commands.map((cmd) => cmd.trim()).filter(Boolean);
}

// Compile a fixture's verify declaration into a list of structured assertions
// (spec 2026-05-08-verify-protocol-structured §3.5). Precedence:
//   1. fixture.verifications[]   — used as-is
//   2. fixture.verificationCommands[] — each wrapped as { type: "shell" }
// Returns [] when neither is set.
export function compileFixtureVerifications(
  fixture: Pick<LoadedFixture, "verifications" | "verificationCommands">,
): unknown[] {
  if (fixture.verifications && fixture.verifications.length > 0) {
    return fixture.verifications;
  }
  return normalizeVerificationCommands(fixture.verificationCommands)
    .map((command) => ({ type: "shell" as const, command }));
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

export interface RunTaskOptions {
  /** When true, skip git checkout/branch creation — worktree is already at the right ref. */
  skipBranchSetup?: boolean;
}

export async function runTask(
  fixture: LoadedFixture,
  repoPath: string,
  client: DeepSeekClient,
  opts?: RunTaskOptions,
): Promise<TaskResult> {
  const startTime = Date.now();
  const result = createEmptyResult(fixture);
  let repairRounds = 0;
  let repairSuccess = false;
  let handoffQuality = 0;

  try {
    // 1. Git prepare — skip when running in a pre-configured worktree
    if (opts?.skipBranchSetup) {
      cleanBenchmarkWorktree(repoPath);
      assertPreflightFiles(repoPath, fixture);
    } else {
      prepareBenchmarkBranch(repoPath, fixture);
    }

    // 2. Clean stale state from previous runs + setup
    const dshDir = path.join(repoPath, ".dsh");
    fs.rmSync(dshDir, { recursive: true, force: true });
    fs.mkdirSync(dshDir, { recursive: true });
    const stack = toLegacyTechStack(repoPath, assembleIntelligence(repoPath));

    // The benchmark owns this runtime config; start from a clean .dsh so
    // assertions from previous fixture runs cannot leak into verification.
    writeDshConfig(repoPath, {
      project: {
        name: path.basename(repoPath),
        language: stack.language,
        package_manager: stack.packageManager ?? "unknown",
      },
      verify: {
        // Structured assertions if fixture declares verifications[]; else
        // fall back to shell-wrapped verificationCommands. (spec §3.3)
        assertions: compileFixtureVerifications(fixture),
        // Always clear legacy slots so we don't read stale state from the
        // previous run on the same worktree.
        commands: [],
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
      verificationGoal: fixture.verificationGoal,
    });

    if (state.plan) {
      result.plan = {
        summary: state.plan.summary,
        files: state.plan.files,
        strategy: state.plan.raw_xml, // raw_xml is currently where the strategy lives
        verify_strategy: state.plan.verify_strategy,
        verify_commands: state.plan.verify_commands,
      };
    }

    // 4. Preflight
    state = await runPreflight({ cwd: repoPath, client });

    // 5. Patch (auto)
    state = await runPatch({ cwd: repoPath, client, auto: true });

    // Record files changed
    const patchSummaryAfterPatch = summarizePatchRecords(state.patches);
    result.filesChanged = patchSummaryAfterPatch.filesChanged;
    result.actualProtocolOps = patchSummaryAfterPatch.actualProtocolOps;

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
    if (fixture.verificationCommands.length > 0 || (fixture.verifications && fixture.verifications.length > 0)) {
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

    // Record files changed (refreshing from state to include repair changes)
    const patchSummary = summarizePatchRecords(state.patches);
    result.filesChanged = patchSummary.filesChanged;
    result.actualProtocolOps = patchSummary.actualProtocolOps;

    // Update tool usage including preflight, patch_rounds and repair patches
    const allToolCalls: { name: string; status: string }[] = [];
    let allToolRounds = 0;

    // From tool_rounds (v0.3 format + preflight rounds which are > 1000)
    allToolRounds += state.tool_rounds?.length ?? 0;
    allToolCalls.push(...(state.tool_rounds ?? []).flatMap((tr) =>
      tr.calls.map((c) => ({ name: c.name, status: c.status })),
    ));

    // From patch_rounds (v0.4 format)
    if (state.patch_rounds && state.patch_rounds.length > 0) {
      const toolActionRounds = state.patch_rounds.filter((pr) => pr.action === "tools");
      allToolRounds += toolActionRounds.length;
      allToolCalls.push(...toolActionRounds.flatMap((pr) =>
        (pr.tool_calls ?? []).map((tc) => ({ name: tc.name, status: tc.status })),
      ));
    }

    // From repair patches
    for (const p of state.patches) {
      if (p.tool_rounds && p.tool_rounds.length > 0) {
        allToolRounds += p.tool_rounds.length;
        allToolCalls.push(...p.tool_rounds.flatMap((tr) =>
          tr.calls.map((c) => ({ name: c.name, status: c.status })),
        ));
      }
    }

    result.toolRounds = allToolRounds;
    result.toolCalls = allToolCalls;

    // Scope check
    const extraFiles = result.filesChanged.filter(
      (f: string) => !fixture.expectedFiles.some((ef: string) => f.endsWith(ef) || ef.endsWith(f)),
    );
    result.extraFiles = extraFiles;
    result.scopeViolation = extraFiles.length > 0;
    result.diagnostics = collectTaskDiagnostics(state);
    result.failureClass = classifyTaskFailure(result);

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
        const toolActionRounds = result.patchRoundActions.filter((a) => a.action === "tools");
        result.toolRounds = toolActionRounds.length;
        result.toolCalls = toolActionRounds.flatMap((a) => a.toolCalls ?? []);
      } else {
        result.toolRounds = stateOnDisk.tool_rounds?.length ?? 0;
        result.toolCalls = (stateOnDisk.tool_rounds ?? []).flatMap((tr) =>
          tr.calls.map((c) => ({ name: c.name, status: c.status })),
        );
      }

      // Add preflight rounds if present (and not v0.3)
      if (result.patchRounds > 0) {
        const preflightRounds = stateOnDisk.tool_rounds?.filter(tr => tr.round >= 1000) ?? [];
        result.toolRounds += preflightRounds.length;
        result.toolCalls.push(...preflightRounds.flatMap(tr => tr.calls.map(c => ({ name: c.name, status: c.status }))));
      }

      // Add repair tools
      for (const p of stateOnDisk.patches) {
        if (p.tool_rounds && p.tool_rounds.length > 0) {
          result.toolRounds += p.tool_rounds.length;
          result.toolCalls.push(...p.tool_rounds.flatMap((tr) =>
            tr.calls.map((c) => ({ name: c.name, status: c.status })),
          ));
        }
      }

      const patchSummary = summarizePatchRecords(stateOnDisk.patches);
      result.filesChanged = patchSummary.filesChanged;
      result.actualProtocolOps = patchSummary.actualProtocolOps;
      result.diagnostics = collectTaskDiagnostics(stateOnDisk);
    }
    result.failureClass = classifyTaskFailure(result);
  } finally {
    if (!opts?.skipBranchSetup) {
      resetToBenchmarkBase(repoPath, fixture);
    }
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
    if (r.failureClass) {
      lines.push(`| 失败分类 | ${r.failureClass} |`);
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
      if (f.failureClass) reasons.push("失败分类: " + f.failureClass);
      lines.push(`- **${f.fixtureId}**: ${reasons.join("; ") || "未知"}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
