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

// Parse CLI flags
const args = process.argv.slice(2);
const isCi = args.includes("--ci");
const filterArg = args.find((a) => a.startsWith("--filter="));
const filterPrefix = filterArg ? filterArg.slice("--filter=".length) : null;

function gitShortHash(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf-8", timeout: 3000 }).trim();
  } catch {
    return "unknown";
  }
}

const allFixtures = loadAllFixtures(fixturesDir);
const benchFixtures = allFixtures
  .filter((f) => f.id.startsWith("pi-") || f.id.startsWith("loam-") || f.id.startsWith("rh-"))
  .filter((f) => !filterPrefix || f.id.startsWith(filterPrefix))
  .sort((a, b) => a.id.localeCompare(b.id));

if (!isCi) {
  console.log(`Loaded ${benchFixtures.length} fixtures:`);
  benchFixtures.forEach((f) => console.log(`  - ${f.id}: ${f.category}`));
  console.log();
}

// Map fixture prefix to repo path
const REPO_PREFIX_MAP: Record<string, string> = {
  "pi-": path.join(REPOS_DIR, "pi-proof-forge"),
  "loam-": path.join(REPOS_DIR, "loamlog"),
  "rh-": path.join(REPOS_DIR, "release-hub"),
};

function resolveRepoPath(fixture: typeof benchFixtures[0]): string {
  if (fixture.repoPath) return fixture.repoPath;
  for (const [prefix, repoPath] of Object.entries(REPO_PREFIX_MAP)) {
    if (fixture.id.startsWith(prefix)) return repoPath;
  }
  throw new Error(`Cannot resolve repo path for fixture ${fixture.id}`);
}

let client: DeepSeekClient;
try {
  const apiKey = process.env["DEEPSEEK_API_KEY"] ?? readApiKey(__dirname) ?? "";
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");
  client = new DeepSeekClient({ apiKey });
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (isCi) {
    process.stdout.write(JSON.stringify({ error: "client_init_failed", message: msg }) + "\n");
  }
  // Use synchronous write to ensure flush before exit
  process.stderr.write(`[benchmark] FATAL: ${msg}\n`);
  process.exitCode = 2;
  setImmediate(() => process.exit(2));
}

const runStart = new Date();
const runId = `${runStart.getFullYear().toString().slice(2)}${String(runStart.getMonth() + 1).padStart(2, "0")}${String(runStart.getDate()).padStart(2, "0")}-${String(runStart.getHours()).padStart(2, "0")}${String(runStart.getMinutes()).padStart(2, "0")}${String(runStart.getSeconds()).padStart(2, "0")}`;
const runDir = path.join(REPORTS_DIR, runId);

const results: TaskResult[] = [];
for (const fixture of benchFixtures) {
  const repoPath = resolveRepoPath(fixture);
  if (isCi) {
    console.log(`[benchmark] starting ${fixture.id} on ${path.basename(repoPath)}`);
  } else {
    console.log(`\n=== Running ${fixture.id} on ${path.basename(repoPath)} ===`);
  }
  const result = await runTask(fixture, repoPath, client);
  results.push(result);
  const status = result.testsPassed ? "PASS" : (result.completed ? "PARTIAL" : "FAIL");
  if (isCi) {
    console.log(JSON.stringify({
      id: fixture.id,
      status: result.testsPassed ? "pass" : (result.completed ? "partial" : "fail"),
      duration_s: Number((result.durationMs / 1000).toFixed(1)),
      score: result.testsPassed ? 99 : 0, // approximate
      repair_rounds: result.repairRounds,
      expected_ops: result.expectedProtocolOps,
      actual_ops: result.actualProtocolOps,
      error: result.error ?? null,
    }));
  } else {
    console.log(`  -> ${status} (${(result.durationMs / 1000).toFixed(1)}s)`);
    if (result.error) console.log(`  -> Error: ${result.error}`);
  }
}

const runEnd = new Date();
const elapsed = ((runEnd.getTime() - runStart.getTime()) / 1000).toFixed(0);
const report = formatEvaluationReport(results);
console.log("\n" + report);
console.log(`\nTotal time: ${elapsed}s`);

// ── Archive ──
fs.mkdirSync(runDir, { recursive: true });

const metadata = {
  run_id: runId,
  started_at: runStart.toISOString(),
  completed_at: runEnd.toISOString(),
  elapsed_seconds: Number(elapsed),
  dsh_commit: gitShortHash(),
  fixture_count: benchFixtures.length,
  fixtures: benchFixtures.map((f) => ({
    id: f.id,
    category: f.category,
    repo: resolveRepoPath(f),
  })),
};

fs.writeFileSync(path.join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");
fs.writeFileSync(path.join(runDir, "results.json"), JSON.stringify(results, null, 2), "utf-8");
fs.writeFileSync(path.join(runDir, "report.md"), report, "utf-8");

if (isCi) {
  console.log(`\n[benchmark] archived to ${runDir}`);
  const passCount = results.filter((r) => r.testsPassed).length;
  console.log(`[benchmark] summary: ${passCount}/${results.length} passed, ${elapsed}s total`);
} else {
  console.log(`\nBenchmark artifacts saved to: ${runDir}`);
}

// --ci mode: exit non-zero if pass rate below threshold
if (isCi) {
  const threshold = 0.6;
  const passRate = results.length > 0 ? results.filter((r) => r.testsPassed).length / results.length : 0;
  if (passRate < threshold) {
    console.error(`[benchmark] FAIL: pass rate ${(passRate * 100).toFixed(0)}% below threshold ${(threshold * 100).toFixed(0)}%`);
    process.exit(1);
  }
}
