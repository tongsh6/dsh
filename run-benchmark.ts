import { DeepSeekClient } from "./packages/provider/dist/client.js";
import { loadAllFixtures } from "./packages/eval/dist/task-fixtures.js";
import { runTask, formatEvaluationReport } from "./packages/eval/dist/benchmark-runner.js";
import type { TaskResult } from "./packages/eval/dist/benchmark-runner.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "packages/eval/src/fixtures");
const DSH_REPO = __dirname;
const PI_REPO = "/tmp/pi-proof-forge";
const REPORTS_DIR = path.join(__dirname, "docs", "superpowers", "reports");

// Parse CLI flags
const args = process.argv.slice(2);
const isCi = args.includes("--ci");

function gitShortHash(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf-8", timeout: 3000 }).trim();
  } catch {
    return "unknown";
  }
}

const allFixtures = loadAllFixtures(fixturesDir);
const benchFixtures = allFixtures
  .filter((f) => f.id.startsWith("pi-") || f.id.startsWith("dsh-"))
  .sort((a, b) => a.id.localeCompare(b.id));

if (!isCi) {
  console.log(`Loaded ${benchFixtures.length} fixtures:`);
  benchFixtures.forEach((f) => console.log(`  - ${f.id}: ${f.category}`));
  console.log();
}

let client: DeepSeekClient;
try {
  client = DeepSeekClient.fromEnv();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (isCi) {
    console.log(JSON.stringify({ error: "client_init_failed", message: msg }));
  }
  console.error(`[benchmark] FATAL: ${msg}`);
  process.exit(2); // exit code 2 = configuration error
}

const runStart = new Date();
const runId = `${runStart.getFullYear().toString().slice(2)}${String(runStart.getMonth() + 1).padStart(2, "0")}${String(runStart.getDate()).padStart(2, "0")}-${String(runStart.getHours()).padStart(2, "0")}${String(runStart.getMinutes()).padStart(2, "0")}${String(runStart.getSeconds()).padStart(2, "0")}`;
const runDir = path.join(REPORTS_DIR, runId);

const results: TaskResult[] = [];
for (const fixture of benchFixtures) {
  const repoPath = fixture.repoPath ?? (fixture.id.startsWith("dsh-") ? DSH_REPO : PI_REPO);
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
    repo: f.repoPath ?? (f.id.startsWith("dsh-") ? "dsh" : "pi-proof-forge"),
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
