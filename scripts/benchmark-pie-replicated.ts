/**
 * PIE Phase E — Replicated A/B Benchmark
 *
 * Design (responding to N=1 anecdote vs CONSTITUTION §5 实证驱动):
 *   - all benchmark fixtures × replications × 2 configs (Project Card on/off)
 *   - Randomized order with seed (avoids time-confounded ON/OFF segregation)
 *   - Hard cleanup per trial (cleanBenchmarkWorktreeHard) — no state leak between reps
 *   - Cross-repo parallel by default, with optional per-repo worktree lanes
 *     (`--lanes-per-repo=N`) scheduled by LPT using historical duration estimates.
 *     Repos that require shared Maven local-repo cleanup stay single-lane to
 *     avoid deleting artifacts while another lane is running Maven.
 *
 * Output: docs/reports/runlogs/<runId>-pie-replicated/
 *   - results.json — array of {fixtureId, config, rep, ...TaskResult}
 *   - per-trial subdirs identical to single-run benchmark artifacts
 *
 * Usage:
 *   ./packages/core/node_modules/.bin/tsx scripts/benchmark-pie-replicated.ts \
 *     [--reps=N (default 3)] [--filter=<prefix>] [--seed=<int>] \
 *     [--lanes-per-repo=N (default 1)] [--estimate-results=<results.json>]
 */

import { DeepSeekClient } from "../packages/provider/dist/client.js";
import { readApiKey } from "../packages/repo/dist/config-loader.js";
import { loadAllFixtures } from "../packages/eval/dist/task-fixtures.js";
import type { LoadedFixture } from "../packages/eval/dist/task-fixtures.js";
import {
  classifyTaskFailure,
  runTask,
  cleanBenchmarkWorktreeHard,
} from "../packages/eval/dist/benchmark-runner.js";
import {
  loadFailureMatrix,
  type FailureMatrixFixtureGovernance,
  selectFailureMatrixFixtureGovernance,
  summarizeFailureMatrix,
} from "../packages/eval/dist/failure-matrix.js";
import { injectCardContext } from "../packages/core/dist/inject-card-context.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const FIXTURES_DIR = path.join(PROJECT_ROOT, "packages/eval/src/fixtures");
const BENCH_ROOT = path.join(os.homedir(), "dsh-bench");
const REPOS_DIR = path.join(BENCH_ROOT, "repos");
const REPORTS_ROOT = path.join(PROJECT_ROOT, "docs", "reports", "runlogs");

const args = process.argv.slice(2);
const repsArg = args.find((a) => a.startsWith("--reps="));
const REPS = repsArg ? parseInt(repsArg.slice(7), 10) : 3;
const filterArg = args.find((a) => a.startsWith("--filter="));
const FILTER = filterArg ? filterArg.slice(9) : null;
const seedArg = args.find((a) => a.startsWith("--seed="));
const SEED = seedArg ? parseInt(seedArg.slice(7), 10) : Date.now();
const lanesArg = args.find((a) => a.startsWith("--lanes-per-repo="));
const LANES_PER_REPO = lanesArg ? Math.max(1, parseInt(lanesArg.slice(17), 10)) : 1;
const estimateResultsArg = args.find((a) => a.startsWith("--estimate-results="));
const DEFAULT_ESTIMATE_RESULTS = path.join(REPORTS_ROOT, "260514020257-pie-replicated", "results.json");
const ESTIMATE_RESULTS = estimateResultsArg ? path.resolve(estimateResultsArg.slice(19)) : DEFAULT_ESTIMATE_RESULTS;
const DEFAULT_TRIAL_ESTIMATE_MS = 5 * 60 * 1000;

const CONFIGS = ["card_on", "card_off"] as const;
type Config = (typeof CONFIGS)[number];

// Maven groupIds to clean per repo (mitigates stale-jar leak)
const REPO_MAVEN_GROUPID: Record<string, string | null> = {
  "release-hub": "io/releasehub",
  loamlog: null, // no Maven
  "pi-proof-forge": null, // no Maven
};

function gitShortHash(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf-8", cwd: PROJECT_ROOT, timeout: 3000 }).trim();
  } catch {
    return "unknown";
  }
}

// Deterministic PRNG (mulberry32) for reproducible shuffles
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

interface Trial {
  fixture: LoadedFixture;
  config: Config;
  rep: number;
  repoPath: string;
}

interface ScheduledLane<T> {
  laneIndex: number;
  estimatedMs: number;
  trials: T[];
}

interface WorkerLane {
  repoName: string;
  sourceRepoPath: string;
  lanePath: string;
  laneIndex: number;
  estimatedMs: number;
  trials: Trial[];
}

interface TrialResult extends Record<string, unknown> {
  fixtureId: string;
  config: Config;
  rep: number;
  trialIndex: number;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
  completed?: boolean;
  testsPassed?: boolean;
  failureClass?: string;
}

interface PatchObservabilitySummary {
  totalPatchRecords: number;
  emptyPatchRecords: number;
  literalEmptyPatchRecords: number;
  failedEmptyPatchRecords: number;
  failedNonEmptyPatchRecords: number;
  dsmlSalvageAppliedRecords: number;
  dsmlSalvageAppliedRounds: number;
  partialCoverageRecords: number;
  repairEmptyPatchStalls: number;
  repairNoCoverageProgressStalls: number;
  repairSemanticHintRecords: number;
  blockedWriteShellGuidanceRecords: number;
  renameIntentDetectedRecords: number;
  deterministicReferenceRepairRecords: number;
  deterministicAssertionRepairRecords: number;
}

interface NativeEditObservabilitySummary {
  applyPatchToolCalls: number;
  applyPatchSuccessRecords: number;
  applyPatchErrorRecords: number;
  applyPatchInvalidRounds: number;
  toolCallChangeRecords: number;
  contentXmlChangeRecords: number;
}

interface ReplicatedBenchmarkMetadata {
  runId: string;
  seed: number;
  reps: number;
  configs: readonly Config[];
  fixtureCount: number;
  totalTrials: number;
  patchFlags?: {
    editsAsNativeTool: boolean;
    editsAsNativeToolEnv: string | null;
  };
  failureMatrixFixtures: readonly FailureMatrixFixtureGovernance[];
  summary?: {
    card_on_pass: number;
    card_on_total: number;
    card_off_pass: number;
    card_off_total: number;
    failureClasses?: Record<Config, Record<string, number>>;
    patchObservability?: Record<Config, PatchObservabilitySummary>;
    nativeEditObservability?: Record<Config, NativeEditObservabilitySummary>;
  };
}

function currentPatchFlags(): ReplicatedBenchmarkMetadata["patchFlags"] {
  const env = process.env["PATCH_EDITS_AS_NATIVE_TOOL"];
  return {
    editsAsNativeTool: env !== undefined && env !== "" && env !== "false" && env !== "0",
    editsAsNativeToolEnv: env ?? null,
  };
}

function summarizeFailureClasses(results: readonly TrialResult[]): Record<Config, Record<string, number>> {
  return {
    card_on: summarizeFailureClassesForConfig(results, "card_on"),
    card_off: summarizeFailureClassesForConfig(results, "card_off"),
  };
}

function summarizeFailureClassesForConfig(
  results: readonly TrialResult[],
  config: Config,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results.filter((r) => r.config === config && !r.testsPassed)) {
    const failureClass = result.failureClass ?? classifyTrialFailure(result) ?? "unknown_failure";
    counts[failureClass] = (counts[failureClass] ?? 0) + 1;
  }
  return counts;
}

function classifyTrialFailure(result: TrialResult): string | undefined {
  const diagnostics = result.diagnostics && typeof result.diagnostics === "object"
    ? result.diagnostics as Parameters<typeof classifyTaskFailure>[0]["diagnostics"]
    : undefined;
  const planDiagnostics = result.planDiagnostics && typeof result.planDiagnostics === "object"
    ? result.planDiagnostics as Parameters<typeof classifyTaskFailure>[0]["planDiagnostics"]
    : undefined;
  return classifyTaskFailure({
    testsPassed: result.testsPassed === true,
    completed: result.completed === true,
    error: typeof result.error === "string" ? result.error : undefined,
    diagnostics,
    planDiagnostics,
  });
}

function summarizePatchObservability(
  results: readonly TrialResult[],
): Record<Config, PatchObservabilitySummary> {
  return {
    card_on: summarizePatchObservabilityForConfig(results, "card_on"),
    card_off: summarizePatchObservabilityForConfig(results, "card_off"),
  };
}

function summarizeNativeEditObservability(
  results: readonly TrialResult[],
): Record<Config, NativeEditObservabilitySummary> {
  return {
    card_on: summarizeNativeEditObservabilityForConfig(results, "card_on"),
    card_off: summarizeNativeEditObservabilityForConfig(results, "card_off"),
  };
}

function summarizeNativeEditObservabilityForConfig(
  results: readonly TrialResult[],
  config: Config,
): NativeEditObservabilitySummary {
  const summary: NativeEditObservabilitySummary = {
    applyPatchToolCalls: 0,
    applyPatchSuccessRecords: 0,
    applyPatchErrorRecords: 0,
    applyPatchInvalidRounds: 0,
    toolCallChangeRecords: 0,
    contentXmlChangeRecords: 0,
  };

  for (const result of results.filter((r) => r.config === config)) {
    const topLevelToolCalls = Array.isArray(result.toolCalls)
      ? result.toolCalls as Array<{ name?: unknown; status?: unknown }>
      : [];
    const hasTopLevelApplyPatch = topLevelToolCalls.some((toolCall) => toolCall.name === "apply_patch");
    for (const toolCall of topLevelToolCalls) {
      if (toolCall.name === "apply_patch") {
        summary.applyPatchToolCalls++;
        if (toolCall.status === "success") summary.applyPatchSuccessRecords++;
        if (toolCall.status === "error") summary.applyPatchErrorRecords++;
      }
    }

    const actions = Array.isArray(result.patchRoundActions)
      ? result.patchRoundActions as Array<{
        action?: unknown;
        invalidReason?: unknown;
        change?: { source?: unknown };
        toolCalls?: Array<{ name?: unknown; status?: unknown }>;
      }>
      : [];
    for (const action of actions) {
      if (typeof action.invalidReason === "string" && action.invalidReason.includes("apply_patch")) {
        summary.applyPatchInvalidRounds++;
      }
      if (action.action === "change") {
        if (action.change?.source === "tool_call") summary.toolCallChangeRecords++;
        if (action.change?.source === "content_xml") summary.contentXmlChangeRecords++;
      }
      if (hasTopLevelApplyPatch) continue;
      for (const toolCall of action.toolCalls ?? []) {
        if (toolCall.name === "apply_patch") {
          summary.applyPatchToolCalls++;
          if (toolCall.status === "success") summary.applyPatchSuccessRecords++;
          if (toolCall.status === "error") summary.applyPatchErrorRecords++;
        }
      }
    }
  }

  return summary;
}

function summarizePatchObservabilityForConfig(
  results: readonly TrialResult[],
  config: Config,
): PatchObservabilitySummary {
  const summary: PatchObservabilitySummary = {
    totalPatchRecords: 0,
    emptyPatchRecords: 0,
    literalEmptyPatchRecords: 0,
    failedEmptyPatchRecords: 0,
    failedNonEmptyPatchRecords: 0,
    dsmlSalvageAppliedRecords: 0,
    dsmlSalvageAppliedRounds: 0,
    partialCoverageRecords: 0,
    repairEmptyPatchStalls: 0,
    repairNoCoverageProgressStalls: 0,
    repairSemanticHintRecords: 0,
    blockedWriteShellGuidanceRecords: 0,
    renameIntentDetectedRecords: 0,
    deterministicReferenceRepairRecords: 0,
    deterministicAssertionRepairRecords: 0,
  };

  for (const result of results.filter((r) => r.config === config)) {
    const existing = result.patchDiagnostics && typeof result.patchDiagnostics === "object"
      ? result.patchDiagnostics as Partial<PatchObservabilitySummary>
      : null;
    if (existing) {
      summary.totalPatchRecords += existing.totalPatchRecords ?? 0;
      summary.emptyPatchRecords += existing.emptyPatchRecords ?? 0;
      summary.literalEmptyPatchRecords += existing.literalEmptyPatchRecords ?? 0;
      summary.failedEmptyPatchRecords += existing.failedEmptyPatchRecords ?? 0;
      summary.failedNonEmptyPatchRecords += existing.failedNonEmptyPatchRecords ?? 0;
      summary.dsmlSalvageAppliedRecords += existing.dsmlSalvageAppliedRecords ?? 0;
      summary.dsmlSalvageAppliedRounds += existing.dsmlSalvageAppliedRounds ?? 0;
      summary.partialCoverageRecords += existing.partialCoverageRecords ?? 0;
      summary.repairEmptyPatchStalls += existing.repairEmptyPatchStalls ?? 0;
      summary.repairNoCoverageProgressStalls += existing.repairNoCoverageProgressStalls ?? 0;
      summary.repairSemanticHintRecords += existing.repairSemanticHintRecords ?? 0;
      summary.blockedWriteShellGuidanceRecords += existing.blockedWriteShellGuidanceRecords ?? 0;
      summary.renameIntentDetectedRecords += existing.renameIntentDetectedRecords ?? 0;
      summary.deterministicReferenceRepairRecords += existing.deterministicReferenceRepairRecords ?? 0;
      summary.deterministicAssertionRepairRecords += existing.deterministicAssertionRepairRecords ?? 0;
      continue;
    }

    const diagnostics = result.diagnostics && typeof result.diagnostics === "object"
      ? result.diagnostics as { patches?: Array<Record<string, unknown>> }
      : null;
    for (const patch of diagnostics?.patches ?? []) {
      const text = typeof patch.patch === "string" ? patch.patch : "";
      const empty = isEmptyPatchText(text);
      summary.totalPatchRecords++;
      if (empty) summary.emptyPatchRecords++;
      if (isLiteralEmptyPatchText(text)) summary.literalEmptyPatchRecords++;
      if (patch.apply_status === "failed" && empty) summary.failedEmptyPatchRecords++;
      if (patch.apply_status === "failed" && !empty) summary.failedNonEmptyPatchRecords++;
      if (patch.dsml_salvage_applied === true) summary.dsmlSalvageAppliedRecords++;
      if (patch.coverage === "partial") summary.partialCoverageRecords++;
      if (patch.repair_stall_reason === "empty_patch") summary.repairEmptyPatchStalls++;
      if (patch.repair_stall_reason === "no_required_coverage_progress") summary.repairNoCoverageProgressStalls++;
      if (Array.isArray(patch.repair_semantic_hints) && patch.repair_semantic_hints.length > 0) summary.repairSemanticHintRecords++;
      if (patch.blocked_write_shell_guidance === true) summary.blockedWriteShellGuidanceRecords++;
      if (patch.rename_intent_detected === true) summary.renameIntentDetectedRecords++;
      if (patch.deterministic_reference_repair === true) summary.deterministicReferenceRepairRecords++;
      if (patch.deterministic_assertion_repair === true) summary.deterministicAssertionRepairRecords++;
    }
  }

  return summary;
}

function isEmptyPatchText(patch: string): boolean {
  const trimmed = patch.trim();
  return trimmed === "" || trimmed === "<empty>";
}

function isLiteralEmptyPatchText(patch: string): boolean {
  return patch.trim() === "<empty>";
}

export function loadDurationEstimates(resultsPath: string): Map<string, number> {
  const estimates = new Map<string, number>();
  if (!fs.existsSync(resultsPath)) return estimates;

  let rows: unknown;
  try {
    rows = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
  } catch {
    return estimates;
  }
  if (!Array.isArray(rows)) return estimates;

  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const fixtureId = typeof record["fixtureId"] === "string" ? record["fixtureId"] : null;
    const elapsedMs = typeof record["elapsedMs"] === "number"
      ? record["elapsedMs"]
      : typeof record["durationMs"] === "number"
        ? record["durationMs"]
        : null;
    if (!fixtureId || !elapsedMs || elapsedMs <= 0) continue;
    const list = buckets.get(fixtureId) ?? [];
    list.push(elapsedMs);
    buckets.set(fixtureId, list);
  }

  for (const [fixtureId, values] of buckets.entries()) {
    estimates.set(fixtureId, values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  return estimates;
}

export function scheduleLpt<T extends { fixture: { id: string } }>(
  trials: T[],
  laneCount: number,
  estimates: ReadonlyMap<string, number>,
  defaultEstimateMs = DEFAULT_TRIAL_ESTIMATE_MS,
): ScheduledLane<T>[] {
  const count = Math.max(1, laneCount);
  const lanes: ScheduledLane<T>[] = Array.from({ length: count }, (_, laneIndex) => ({
    laneIndex,
    estimatedMs: 0,
    trials: [],
  }));

  const weighted = trials.map((trial, index) => ({
    trial,
    index,
    estimatedMs: estimates.get(trial.fixture.id) ?? defaultEstimateMs,
  }));
  weighted.sort((a, b) => b.estimatedMs - a.estimatedMs || a.index - b.index);

  for (const item of weighted) {
    const lane = lanes.reduce((best, candidate) =>
      candidate.estimatedMs < best.estimatedMs ? candidate : best,
    );
    lane.trials.push(item.trial);
    lane.estimatedMs += item.estimatedMs;
  }

  return lanes;
}

export function formatReplicatedBenchmarkReport(
  metadata: ReplicatedBenchmarkMetadata,
  results: readonly TrialResult[],
): string {
  const passOn = metadata.summary?.card_on_pass ?? results.filter((r) => r.config === "card_on" && r.testsPassed).length;
  const totalOn = metadata.summary?.card_on_total ?? results.filter((r) => r.config === "card_on").length;
  const passOff = metadata.summary?.card_off_pass ?? results.filter((r) => r.config === "card_off" && r.testsPassed).length;
  const totalOff = metadata.summary?.card_off_total ?? results.filter((r) => r.config === "card_off").length;
  const governedFixtures = metadata.failureMatrixFixtures.filter((entry) =>
    entry.evidencePolicy !== "standard" ||
    entry.comparabilityRisk ||
    entry.requiresReplicatedConfirmation
  );

  const lines: string[] = [];
  lines.push("# PIE Replicated Benchmark Summary");
  lines.push("");
  lines.push("## Run");
  lines.push("");
  lines.push(`- runId: ${metadata.runId}`);
  lines.push(`- seed: ${metadata.seed}`);
  lines.push(`- reps: ${metadata.reps}`);
  lines.push(`- fixtures: ${metadata.fixtureCount}`);
  lines.push(`- trials: ${results.length}/${metadata.totalTrials}`);
  if (metadata.patchFlags) {
    lines.push(`- patch.edits_as_native_tool: ${metadata.patchFlags.editsAsNativeTool}`);
  }
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push(`- Card ON: ${passOn}/${totalOn}`);
  lines.push(`- Card OFF: ${passOff}/${totalOff}`);
  lines.push("");
  lines.push("## Failure Classification");
  lines.push("");
  lines.push("Failure classes do not change testsPassed; they separate protocol/provider failures from implementation failures.");
  lines.push("");
  const failureClasses = metadata.summary?.failureClasses ?? summarizeFailureClasses(results);
  const classes = [...new Set([
    ...Object.keys(failureClasses.card_on ?? {}),
    ...Object.keys(failureClasses.card_off ?? {}),
  ])].sort();
  if (classes.length === 0) {
    lines.push("No failed trials.");
  } else {
    lines.push("| Failure Class | Card ON | Card OFF |");
    lines.push("|---------------|---------|----------|");
    for (const failureClass of classes) {
      lines.push(`| ${failureClass} | ${failureClasses.card_on?.[failureClass] ?? 0} | ${failureClasses.card_off?.[failureClass] ?? 0} |`);
    }
  }
  lines.push("");
  lines.push("## Patch Observability");
  lines.push("");
  lines.push("These counters are derived from per-trial patch diagnostics and make empty repair/patch attempts and DSML salvage auditable.");
  lines.push("");
  const patchObservability = metadata.summary?.patchObservability ?? summarizePatchObservability(results);
  lines.push("| Metric | Card ON | Card OFF |");
  lines.push("|--------|---------|----------|");
  for (const metric of [
    "totalPatchRecords",
    "emptyPatchRecords",
    "literalEmptyPatchRecords",
    "failedEmptyPatchRecords",
    "failedNonEmptyPatchRecords",
    "dsmlSalvageAppliedRecords",
    "dsmlSalvageAppliedRounds",
    "partialCoverageRecords",
    "repairEmptyPatchStalls",
    "repairNoCoverageProgressStalls",
    "repairSemanticHintRecords",
    "blockedWriteShellGuidanceRecords",
    "renameIntentDetectedRecords",
    "deterministicReferenceRepairRecords",
    "deterministicAssertionRepairRecords",
  ] as const) {
    lines.push(`| ${metric} | ${patchObservability.card_on?.[metric] ?? 0} | ${patchObservability.card_off?.[metric] ?? 0} |`);
  }
  lines.push("");
  lines.push("## Native Edit Tool Observability");
  lines.push("");
  lines.push("These counters show whether the opt-in native edit path was actually used, separately from overall pass rate.");
  lines.push("");
  const nativeEditObservability = metadata.summary?.nativeEditObservability ?? summarizeNativeEditObservability(results);
  lines.push("| Metric | Card ON | Card OFF |");
  lines.push("|--------|---------|----------|");
  for (const metric of [
    "applyPatchToolCalls",
    "applyPatchSuccessRecords",
    "applyPatchErrorRecords",
    "applyPatchInvalidRounds",
    "toolCallChangeRecords",
    "contentXmlChangeRecords",
  ] as const) {
    lines.push(`| ${metric} | ${nativeEditObservability.card_on?.[metric] ?? 0} | ${nativeEditObservability.card_off?.[metric] ?? 0} |`);
  }
  lines.push("");
  lines.push("## Evidence Governance");
  lines.push("");
  lines.push("This section is generated from metadata.failureMatrixFixtures.");
  lines.push("");

  if (governedFixtures.length === 0) {
    lines.push("No governed fixtures were included in this run.");
  } else {
    lines.push("| Fixture | Policy | Comparability Risk | Status | Notes |");
    lines.push("|---------|--------|--------------------|--------|-------|");
    for (const entry of governedFixtures) {
      const notes = entry.governanceNotes ?? entry.notes;
      lines.push(
        `| ${entry.fixture} | ${entry.evidencePolicy} | ${entry.comparabilityRisk ? "yes" : "no"} | ${entry.status} | ${notes.replace(/\|/g, "\\|")} |`,
      );
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function createLaneWorktree(sourceRepoPath: string, lanePath: string): void {
  fs.rmSync(lanePath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(lanePath), { recursive: true });
  execFileSync("git", ["worktree", "add", "--detach", lanePath, "HEAD"], {
    cwd: sourceRepoPath,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
}

function removeLaneWorktree(sourceRepoPath: string, lanePath: string): void {
  try {
    execFileSync("git", ["worktree", "remove", "--force", lanePath], {
      cwd: sourceRepoPath,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
  } catch {
    fs.rmSync(lanePath, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const runId = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..*/, "")
    .slice(2);
  const startedAt = new Date().toISOString();
  const runDir = path.join(REPORTS_ROOT, `${runId}-pie-replicated`);
  fs.mkdirSync(runDir, { recursive: true });

  // ---- Load + filter fixtures ----
  const allFixtures = loadAllFixtures(FIXTURES_DIR);
  const benchFixtures = allFixtures
    .filter((f) => /^(pi-|loam-|rh-)/.test(f.id))
    .filter((f) => !FILTER || f.id.startsWith(FILTER));

  console.log(`Loaded ${benchFixtures.length} fixtures × ${REPS} reps × ${CONFIGS.length} configs`);
  console.log(`Total trials: ${benchFixtures.length * REPS * CONFIGS.length}`);
  console.log(`Seed: ${SEED}`);
  console.log(`Lanes per repo: ${LANES_PER_REPO}`);

  // ---- Build trial list ----
  const trials: Trial[] = [];
  for (const f of benchFixtures) {
    const repo = f.benchmarkRef?.repo;
    if (!repo) {
      console.warn(`SKIP ${f.id}: missing benchmarkRef.repo`);
      continue;
    }
    const repoPath = path.join(REPOS_DIR, repo);
    if (!fs.existsSync(repoPath)) {
      console.warn(`SKIP ${f.id}: repo ${repoPath} not found`);
      continue;
    }
    for (const config of CONFIGS) {
      for (let rep = 0; rep < REPS; rep++) {
        trials.push({ fixture: f, config, rep, repoPath });
      }
    }
  }

  // ---- Randomized order ----
  const rng = mulberry32(SEED);
  const shuffled = shuffle(trials, rng);

  // ---- Group by repo, then split each repo into one or more serial lanes ----
  const byRepo = new Map<string, Trial[]>();
  for (const t of shuffled) {
    const list = byRepo.get(t.repoPath) ?? [];
    list.push(t);
    byRepo.set(t.repoPath, list);
  }

  const durationEstimates = loadDurationEstimates(ESTIMATE_RESULTS);
  const failureMatrix = loadFailureMatrix();
  const failureMatrixSummary = summarizeFailureMatrix(failureMatrix);
  const failureMatrixFixtures = selectFailureMatrixFixtureGovernance(
    failureMatrix,
    benchFixtures.map((fixture) => fixture.id),
  );
  if (durationEstimates.size > 0) {
    console.log(`Loaded duration estimates for ${durationEstimates.size} fixtures from ${ESTIMATE_RESULTS}`);
  } else {
    console.log(`No duration estimates found at ${ESTIMATE_RESULTS}; using default trial weights`);
  }

  const worktreesRoot = path.join(BENCH_ROOT, "worktrees", `${runId}-pie-replicated`);
  const workerLanes: WorkerLane[] = [];
  for (const [repoPath, repoTrials] of byRepo.entries()) {
    const repoName = path.basename(repoPath);
    const effectiveLanes = REPO_MAVEN_GROUPID[repoName] ? 1 : LANES_PER_REPO;
    if (effectiveLanes < LANES_PER_REPO) {
      console.warn(`Repo ${repoName}: using 1 lane because Maven local-repo cleanup is not safe to parallelize`);
    }
    const scheduled = scheduleLpt(repoTrials, effectiveLanes, durationEstimates);
    for (const lane of scheduled) {
      const lanePath = lane.laneIndex === 0
        ? repoPath
        : path.join(worktreesRoot, `${repoName}-lane-${lane.laneIndex}`);
      workerLanes.push({
        repoName,
        sourceRepoPath: repoPath,
        lanePath,
        laneIndex: lane.laneIndex,
        estimatedMs: lane.estimatedMs,
        trials: lane.trials,
      });
    }
  }

  // Write metadata
  const initialMetadata: ReplicatedBenchmarkMetadata & Record<string, unknown> = {
    runId, seed: SEED, reps: REPS, configs: CONFIGS,
    lanesPerRepo: LANES_PER_REPO,
    estimateResults: fs.existsSync(ESTIMATE_RESULTS) ? ESTIMATE_RESULTS : null,
    dshCommit: gitShortHash(), startedAt,
    patchFlags: currentPatchFlags(),
    fixtureCount: benchFixtures.length,
    totalTrials: trials.length,
    failureMatrixSummary,
    failureMatrixFixtures,
    repoBreakdown: Object.fromEntries(
      [...byRepo.entries()].map(([p, ts]) => [path.basename(p), ts.length]),
    ),
    lanes: workerLanes.map((lane) => ({
      repo: lane.repoName,
      laneIndex: lane.laneIndex,
      trials: lane.trials.length,
      estimatedMs: lane.estimatedMs,
      worktree: lane.lanePath,
      requestedLanesPerRepo: LANES_PER_REPO,
    })),
  };
  fs.writeFileSync(path.join(runDir, "metadata.json"), JSON.stringify(initialMetadata, null, 2));

  // ---- Init DeepSeek client ----
  const apiKey = readApiKey(PROJECT_ROOT);
  if (!apiKey) {
    console.error("ERROR: DEEPSEEK_API_KEY not found; cannot run benchmark");
    process.exit(1);
  }
  const client = new DeepSeekClient({ apiKey });

  // ---- Results sink ----
  const results: TrialResult[] = [];
  const resultsPath = path.join(runDir, "results.json");
  let trialIndex = 0;

  for (const lane of workerLanes.filter((l) => l.laneIndex > 0)) {
    createLaneWorktree(lane.sourceRepoPath, lane.lanePath);
  }

  // ---- Per-lane worker (repo lane serial; multiple lanes per repo optional) ----
  const workers = workerLanes.map(async (lane) => {
    for (const t of lane.trials) {
      const repoPath = lane.lanePath;
      const myIndex = ++trialIndex;
      const startedAt = new Date().toISOString();
      const tStart = Date.now();

      console.log(`\n[${myIndex}/${trials.length}] ${t.fixture.id} (rep ${t.rep + 1}/${REPS}, ${t.config}) on ${lane.repoName}/lane-${lane.laneIndex}`);

      // Hard cleanup
      const baselineRef = t.fixture.benchmarkRef?.commit ?? t.fixture.benchmarkRef?.branch ?? "HEAD";
      const groupId = REPO_MAVEN_GROUPID[path.basename(repoPath)] ?? null;
      try {
        cleanBenchmarkWorktreeHard(repoPath, baselineRef, groupId);
      } catch (e) {
        console.error(`  ✖ cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
        const failedResult: TrialResult = {
          fixtureId: t.fixture.id, config: t.config, rep: t.rep, trialIndex: myIndex,
          startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - tStart,
          error: `cleanup-failed: ${e instanceof Error ? e.message : String(e)}`,
          completed: false, testsPassed: false,
        };
        failedResult.failureClass = classifyTrialFailure(failedResult);
        results.push(failedResult);
        fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
        continue;
      }

      // Card injection flag isolated via AsyncLocalStorage — no env mutation
      // (env mutation across concurrent workers caused the race condition
      // that may have biased the previous 144-trial dataset).
      const injectFlag = t.config !== "card_off";

      // Run task within ALS context — runTask's async chain (and its
      // descendants buildRepoContext etc.) observe this flag, independent
      // of other concurrent workers' flags.
      try {
        const result = await injectCardContext.run(injectFlag, () =>
          runTask(t.fixture, repoPath, client, { skipBranchSetup: true })
        );
        const completedAt = new Date().toISOString();
        results.push({
          fixtureId: t.fixture.id, config: t.config, rep: t.rep, trialIndex: myIndex,
          startedAt, completedAt, elapsedMs: Date.now() - tStart,
          ...(result as unknown as Record<string, unknown>),
        });
        console.log(`  -> ${result.testsPassed ? "PASS" : "FAIL"} (${((Date.now() - tStart) / 1000).toFixed(0)}s, repair=${result.repairRounds})`);
      } catch (e) {
        console.error(`  ✖ trial threw: ${e instanceof Error ? e.message : String(e)}`);
        const failedResult: TrialResult = {
          fixtureId: t.fixture.id, config: t.config, rep: t.rep, trialIndex: myIndex,
          startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - tStart,
          error: `run-threw: ${e instanceof Error ? e.message : String(e)}`,
          completed: false, testsPassed: false,
        };
        failedResult.failureClass = classifyTrialFailure(failedResult);
        results.push(failedResult);
      }

      // Persist incrementally
      fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    }
  });

  try {
    await Promise.all(workers);
  } finally {
    for (const lane of workerLanes.filter((l) => l.laneIndex > 0).reverse()) {
      removeLaneWorktree(lane.sourceRepoPath, lane.lanePath);
    }
    fs.rmSync(worktreesRoot, { recursive: true, force: true });
  }

  // Final summary
  const passOn = results.filter((r) => r.config === "card_on" && r.testsPassed).length;
  const totalOn = results.filter((r) => r.config === "card_on").length;
  const passOff = results.filter((r) => r.config === "card_off" && r.testsPassed).length;
  const totalOff = results.filter((r) => r.config === "card_off").length;
  console.log(`\n=== ALL DONE ===`);
  console.log(`Card ON : ${passOn}/${totalOn} testsPassed`);
  console.log(`Card OFF: ${passOff}/${totalOff} testsPassed`);
  console.log(`Artifacts: ${runDir}`);

  const finalMetadata: ReplicatedBenchmarkMetadata & Record<string, unknown> = {
    runId, seed: SEED, reps: REPS, configs: CONFIGS,
    lanesPerRepo: LANES_PER_REPO,
    estimateResults: fs.existsSync(ESTIMATE_RESULTS) ? ESTIMATE_RESULTS : null,
    dshCommit: gitShortHash(),
    startedAt,
    completedAt: new Date().toISOString(),
    patchFlags: currentPatchFlags(),
    fixtureCount: benchFixtures.length,
    totalTrials: trials.length,
    failureMatrixSummary,
    failureMatrixFixtures,
    repoBreakdown: Object.fromEntries(
      [...byRepo.entries()].map(([p, ts]) => [path.basename(p), ts.length]),
    ),
    lanes: workerLanes.map((lane) => ({
      repo: lane.repoName,
      laneIndex: lane.laneIndex,
      trials: lane.trials.length,
      estimatedMs: lane.estimatedMs,
      worktree: lane.lanePath,
      requestedLanesPerRepo: LANES_PER_REPO,
    })),
    summary: {
      card_on_pass: passOn,
      card_on_total: totalOn,
      card_off_pass: passOff,
      card_off_total: totalOff,
      failureClasses: summarizeFailureClasses(results),
      patchObservability: summarizePatchObservability(results),
      nativeEditObservability: summarizeNativeEditObservability(results),
    },
  };
  fs.writeFileSync(path.join(runDir, "metadata.json"), JSON.stringify(finalMetadata, null, 2));
  fs.writeFileSync(path.join(runDir, "summary.md"), formatReplicatedBenchmarkReport(finalMetadata, results));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
