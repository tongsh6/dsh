import { DeepSeekClient } from "./packages/provider/dist/client.js";
import { loadAllFixtures } from "./packages/eval/dist/task-fixtures.js";
import { runTask, formatEvaluationReport } from "./packages/eval/dist/benchmark-runner.js";
import type { TaskResult } from "./packages/eval/dist/benchmark-runner.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "packages/eval/src/fixtures");
const DSH_REPO = __dirname;
const PI_REPO = "/tmp/pi-proof-forge";

const allFixtures = loadAllFixtures(fixturesDir);
const benchFixtures = allFixtures
  .filter((f) => f.id.startsWith("pi-") || f.id.startsWith("dsh-"))
  .sort((a, b) => a.id.localeCompare(b.id));

console.log(`Loaded ${benchFixtures.length} fixtures:`);
benchFixtures.forEach((f) => console.log(`  - ${f.id}: ${f.category}`));
console.log();

const client = DeepSeekClient.fromEnv();
const startTime = Date.now();

const results: TaskResult[] = [];
for (const fixture of benchFixtures) {
  const repoPath = fixture.repoPath ?? (fixture.id.startsWith("dsh-") ? DSH_REPO : PI_REPO);
  console.log(`\n=== Running ${fixture.id} on ${path.basename(repoPath)} ===`);
  const result = await runTask(fixture, repoPath, client);
  results.push(result);
  const status = result.testsPassed ? "PASS" : (result.completed ? "PARTIAL" : "FAIL");
  console.log(`  -> ${status} (${(result.durationMs / 1000).toFixed(1)}s)`);
  if (result.error) console.log(`  -> Error: ${result.error}`);
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
const report = formatEvaluationReport(results);
console.log("\n" + report);
console.log(`\nTotal time: ${elapsed}s`);
