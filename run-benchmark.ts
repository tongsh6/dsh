import { DeepSeekClient } from "./packages/provider/dist/client.js";
import { readApiKey } from "./packages/repo/dist/config-loader.js";
import { loadAllFixtures } from "./packages/eval/dist/task-fixtures.js";
import { runTask, formatEvaluationReport } from "./packages/eval/dist/benchmark-runner.js";
import type { TaskResult } from "./packages/eval/dist/benchmark-runner.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "packages/eval/src/fixtures");
const BENCH_ROOT = path.join(os.homedir(), "dsh-bench");
const REPOS_DIR = path.join(BENCH_ROOT, "repos");
const REPORTS_DIR = path.join(__dirname, "docs", "reports");

const args = process.argv.slice(2);
const isCi = args.includes("--ci");
const filterArg = args.find((a) => a.startsWith("--filter="));
const filterPrefix = filterArg ? filterArg.slice("--filter=".length) : null;
const parallelArg = args.find((a) => a.startsWith("--parallel="));
const parallelCount = parallelArg ? parseInt(parallelArg.slice("--parallel=".length), 10) : 3;

function gitShortHash(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf-8", timeout: 3000 }).trim();
  } catch {
    return "unknown";
  }
}

function gitFile(cwd: string, args: string[], timeoutMs = 15_000): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
}

const allFixtures = loadAllFixtures(fixturesDir);
const benchFixtures = allFixtures
  .filter((f) => f.id.startsWith("pi-") || f.id.startsWith("loam-") || f.id.startsWith("rh-"))
  .filter((f) => !filterPrefix || f.id.startsWith(filterPrefix))
  .sort((a, b) => a.id.localeCompare(b.id));

console.log(`Loaded ${benchFixtures.length} fixtures (parallel=${parallelCount}):`);
benchFixtures.forEach((f) => console.log(`  - ${f.id}: ${f.category}`));
console.log();

const REPO_NAME_MAP: Record<string, string> = {
  "pi-proof-forge": path.join(REPOS_DIR, "pi-proof-forge"),
  loamlog: path.join(REPOS_DIR, "loamlog"),
  "release-hub": path.join(REPOS_DIR, "release-hub"),
};

const REPO_PREFIX_MAP: Record<string, string> = {
  "pi-": REPO_NAME_MAP["pi-proof-forge"],
  "loam-": REPO_NAME_MAP["loamlog"],
  "rh-": REPO_NAME_MAP["release-hub"],
};

function resolveRepoPath(fixture: typeof benchFixtures[0]): string {
  if (fixture.repoPath) return fixture.repoPath;
  if (fixture.benchmarkRef?.repo) return REPO_NAME_MAP[fixture.benchmarkRef.repo];
  for (const [prefix, repoPath] of Object.entries(REPO_PREFIX_MAP)) {
    if (fixture.id.startsWith(prefix)) return repoPath;
  }
  throw new Error(`Cannot resolve repo path for fixture ${fixture.id}`);
}

// ---- Worktree management ----

const WORKTREES_DIR_NAME = ".dsh-worktrees";

function cleanupStaleWorktrees(mainRepo: string): void {
  const worktreesRoot = path.join(mainRepo, WORKTREES_DIR_NAME);
  if (!fs.existsSync(worktreesRoot)) return;
  for (const entry of fs.readdirSync(worktreesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const wtPath = path.join(worktreesRoot, entry.name);
    try { gitFile(mainRepo, ["worktree", "remove", wtPath, "--force"], 10_000); } catch {
      try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch { /* ok */ }
    }
  }
  try { gitFile(mainRepo, ["worktree", "prune"], 10_000); } catch { /* ok */ }
}

function resolveBenchmarkRef(mainRepo: string, fixture: typeof benchFixtures[0]): string {
  const ref = fixture.benchmarkRef?.commit
    ?? fixture.benchmarkRef?.branch
    ?? "HEAD";
  // If it looks like a branch (not a 40-char SHA), try to resolve via origin/
  if (ref.length !== 40) {
    try {
      return execFileSync("git", ["rev-parse", `origin/${ref}`], { cwd: mainRepo, encoding: "utf-8", timeout: 5_000 }).trim();
    } catch {
      try {
        return execFileSync("git", ["rev-parse", ref], { cwd: mainRepo, encoding: "utf-8", timeout: 5_000 }).trim();
      } catch { /* fall through */ }
    }
  }
  return ref;
}

function createWorktree(mainRepo: string, fixtureId: string, ref: string): string {
  const worktreesRoot = path.join(mainRepo, WORKTREES_DIR_NAME);
  fs.mkdirSync(worktreesRoot, { recursive: true });
  const wtPath = path.join(worktreesRoot, fixtureId);

  if (fs.existsSync(wtPath)) {
    try { gitFile(mainRepo, ["worktree", "remove", wtPath, "--force"], 10_000); } catch { /* ok */ }
    try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch { /* ok */ }
  }
  try { gitFile(mainRepo, ["worktree", "prune"], 10_000); } catch { /* ok */ }

  // Create worktree at the resolved commit in detached HEAD.
  // Detached HEAD avoids branch-name collisions between parallel worktrees.
  gitFile(mainRepo, ["worktree", "add", "--detach", wtPath, ref], 30_000);
  return wtPath;
}

function removeWorktree(mainRepo: string, wtPath: string): void {
  try {
    gitFile(mainRepo, ["worktree", "remove", wtPath, "--force"], 15_000);
  } catch {
    try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch { /* ok */ }
  }
  try { gitFile(mainRepo, ["worktree", "prune"], 10_000); } catch { /* ok */ }
}

// ---- Semaphore pool ----

function createSemaphore(max: number) {
  let running = 0;
  const queue: (() => void)[] = [];

  function acquire(): Promise<void> {
    if (running < max) { running++; return Promise.resolve(); }
    return new Promise<void>((resolve) => queue.push(resolve));
  }

  function release(): void {
    running--;
    const next = queue.shift();
    if (next) { running++; next(); }
  }

  return { acquire, release };
}

// ---- Client ----

let client: DeepSeekClient;
try {
  const apiKey = process.env["DEEPSEEK_API_KEY"] ?? readApiKey(__dirname) ?? "";
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");
  client = new DeepSeekClient({ apiKey });
} catch (e) {
  process.stderr.write(`[benchmark] FATAL: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
}

// ---- Main ----

const runStart = new Date();
const runId = `${runStart.getFullYear().toString().slice(2)}${String(runStart.getMonth() + 1).padStart(2, "0")}${String(runStart.getDate()).padStart(2, "0")}-${String(runStart.getHours()).padStart(2, "0")}${String(runStart.getMinutes()).padStart(2, "0")}${String(runStart.getSeconds()).padStart(2, "0")}`;
const runDir = path.join(REPORTS_DIR, runId);

// Clean up stale worktrees from all repos before starting
const allRepos = new Set(benchFixtures.map((f) => resolveRepoPath(f)));
for (const repo of allRepos) {
  cleanupStaleWorktrees(repo);
}

async function runFixture(fixture: typeof benchFixtures[0]): Promise<TaskResult> {
  const mainRepo = resolveRepoPath(fixture);

  // Ensure remote refs are available in the shared repo before creating
  // worktree. Without this, prepareBenchmarkBranch may fail to resolve
  // benchmarkRef.branch that exists only as origin/<branch>.
  try { gitFile(mainRepo, ["fetch", "origin"], 30_000); } catch { /* ok */ }

  const ref = resolveBenchmarkRef(mainRepo, fixture);
  const wtPath = createWorktree(mainRepo, fixture.id, ref);

  const tag = `[${fixture.id}]`;
  console.log(`\n=== ${tag} started on ${path.basename(mainRepo)} ===`);

  try {
    // Worktree is already at the correct ref in detached HEAD — skip
    // prepareBenchmarkBranch's checkout/branch logic which can fail when
    // multiple worktrees share a repo.
    const result = await runTask(fixture, wtPath, client, { skipBranchSetup: true });
    const status = result.testsPassed ? "PASS" : (result.completed ? "PARTIAL" : "FAIL");
    console.log(`  -> ${tag} ${status} (${(result.durationMs / 1000).toFixed(1)}s)`);
    if (result.error) console.log(`  -> ${tag} Error: ${result.error}`);
    return result;
  } finally {
    removeWorktree(mainRepo, wtPath);
  }
}

const semaphore = createSemaphore(parallelCount);
const resultPromises: Promise<TaskResult>[] = [];

for (const fixture of benchFixtures) {
  resultPromises.push(
    semaphore.acquire().then(() =>
      runFixture(fixture).finally(() => semaphore.release()),
    ),
  );
}

const allResults = await Promise.all(resultPromises);
allResults.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));

const runEnd = new Date();
const elapsed = ((runEnd.getTime() - runStart.getTime()) / 1000).toFixed(0);
const report = formatEvaluationReport(allResults);
console.log("\n" + report);
console.log(`\nTotal time: ${elapsed}s (parallel=${parallelCount})`);

// ── Archive ──
fs.mkdirSync(runDir, { recursive: true });

const metadata = {
  run_id: runId,
  started_at: runStart.toISOString(),
  completed_at: runEnd.toISOString(),
  elapsed_seconds: Number(elapsed),
  dsh_commit: gitShortHash(),
  fixture_count: benchFixtures.length,
  parallel_count: parallelCount,
  fixtures: benchFixtures.map((f) => ({
    id: f.id,
    category: f.category,
    repo: resolveRepoPath(f),
    benchmark_ref: f.benchmarkRef ?? null,
    preflight_files: f.preflightFiles,
    design_goal: f.designGoal ?? null,
    verification_goal: f.verificationGoal ?? null,
  })),
};

fs.writeFileSync(path.join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");
fs.writeFileSync(path.join(runDir, "results.json"), JSON.stringify(allResults, null, 2), "utf-8");
fs.writeFileSync(path.join(runDir, "report.md"), report, "utf-8");

console.log(`\nBenchmark artifacts saved to: ${runDir}`);

if (isCi) {
  const passCount = allResults.filter((r) => r.testsPassed).length;
  const passRate = allResults.length > 0 ? passCount / allResults.length : 0;
  console.log(`[benchmark] summary: ${passCount}/${allResults.length} passed, ${elapsed}s total`);
  if (passRate < 0.6) {
    console.error(`[benchmark] FAIL: pass rate ${(passRate * 100).toFixed(0)}% below threshold 60%`);
    process.exit(1);
  }
}
