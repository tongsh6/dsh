/**
 * PIE Phase E — Replicated A/B Benchmark
 *
 * Design (responding to N=1 anecdote vs CONSTITUTION §5 实证驱动):
 *   - 24 fixture × 3 replications × 2 configs (Project Card on/off) = 144 trials
 *   - Randomized order with seed (avoids time-confounded ON/OFF segregation)
 *   - Hard cleanup per trial (cleanBenchmarkWorktreeHard) — no state leak between reps
 *   - Cross-repo parallel (3 worker, one per repo) since repos can run independently;
 *     intra-repo serial since each repo's working tree can only host one trial at a time
 *
 * Output: docs/reports/runlogs/<runId>-pie-replicated/
 *   - results.json — array of {fixtureId, config, rep, ...TaskResult}
 *   - per-trial subdirs identical to single-run benchmark artifacts
 *
 * Usage:
 *   ./packages/core/node_modules/.bin/tsx scripts/benchmark-pie-replicated.ts \
 *     [--reps=N (default 3)] [--filter=<prefix>] [--seed=<int>]
 */

import { DeepSeekClient } from "../packages/provider/dist/client.js";
import { readApiKey } from "../packages/repo/dist/config-loader.js";
import { loadAllFixtures } from "../packages/eval/dist/task-fixtures.js";
import type { LoadedFixture } from "../packages/eval/dist/task-fixtures.js";
import {
  runTask,
  cleanBenchmarkWorktreeHard,
} from "../packages/eval/dist/benchmark-runner.js";
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

interface TrialResult extends Record<string, unknown> {
  fixtureId: string;
  config: Config;
  rep: number;
  trialIndex: number;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
}

async function main(): Promise<void> {
  const runId = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..*/, "")
    .slice(2);
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

  // ---- Group by repo (one worker per repo, intra-repo serial) ----
  const byRepo = new Map<string, Trial[]>();
  for (const t of shuffled) {
    const list = byRepo.get(t.repoPath) ?? [];
    list.push(t);
    byRepo.set(t.repoPath, list);
  }

  // Write metadata
  fs.writeFileSync(path.join(runDir, "metadata.json"), JSON.stringify({
    runId, seed: SEED, reps: REPS, configs: CONFIGS,
    dshCommit: gitShortHash(), startedAt: new Date().toISOString(),
    fixtureCount: benchFixtures.length,
    totalTrials: trials.length,
    repoBreakdown: Object.fromEntries(
      [...byRepo.entries()].map(([p, ts]) => [path.basename(p), ts.length]),
    ),
  }, null, 2));

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

  // ---- Per-repo worker (intra-repo serial) ----
  const workers = [...byRepo.entries()].map(async ([repoPath, repoTrials]) => {
    for (const t of repoTrials) {
      const myIndex = ++trialIndex;
      const startedAt = new Date().toISOString();
      const tStart = Date.now();

      console.log(`\n[${myIndex}/${trials.length}] ${t.fixture.id} (rep ${t.rep + 1}/${REPS}, ${t.config}) on ${path.basename(repoPath)}`);

      // Hard cleanup
      const baselineRef = t.fixture.benchmarkRef?.commit ?? t.fixture.benchmarkRef?.branch ?? "HEAD";
      const groupId = REPO_MAVEN_GROUPID[path.basename(repoPath)] ?? null;
      try {
        cleanBenchmarkWorktreeHard(repoPath, baselineRef, groupId);
      } catch (e) {
        console.error(`  ✖ cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
        results.push({
          fixtureId: t.fixture.id, config: t.config, rep: t.rep, trialIndex: myIndex,
          startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - tStart,
          error: `cleanup-failed: ${e instanceof Error ? e.message : String(e)}`,
          completed: false, testsPassed: false,
        });
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
          runTask(t.fixture, repoPath, client, { skipBranchSetup: false })
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
        results.push({
          fixtureId: t.fixture.id, config: t.config, rep: t.rep, trialIndex: myIndex,
          startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - tStart,
          error: `run-threw: ${e instanceof Error ? e.message : String(e)}`,
          completed: false, testsPassed: false,
        });
      }

      // Persist incrementally
      fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    }
  });

  await Promise.all(workers);

  // Final summary
  const passOn = results.filter((r) => r.config === "card_on" && r.testsPassed).length;
  const totalOn = results.filter((r) => r.config === "card_on").length;
  const passOff = results.filter((r) => r.config === "card_off" && r.testsPassed).length;
  const totalOff = results.filter((r) => r.config === "card_off").length;
  console.log(`\n=== ALL DONE ===`);
  console.log(`Card ON : ${passOn}/${totalOn} testsPassed`);
  console.log(`Card OFF: ${passOff}/${totalOff} testsPassed`);
  console.log(`Artifacts: ${runDir}`);

  fs.writeFileSync(path.join(runDir, "metadata.json"), JSON.stringify({
    runId, seed: SEED, reps: REPS, configs: CONFIGS,
    dshCommit: gitShortHash(),
    startedAt: JSON.parse(fs.readFileSync(path.join(runDir, "metadata.json"), "utf-8")).startedAt,
    completedAt: new Date().toISOString(),
    fixtureCount: benchFixtures.length,
    totalTrials: trials.length,
    summary: { card_on_pass: passOn, card_on_total: totalOn, card_off_pass: passOff, card_off_total: totalOff },
  }, null, 2));
}

await main();
