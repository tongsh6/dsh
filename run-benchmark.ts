import { DeepSeekClient } from "./packages/provider/dist/client.js";
import { loadAllFixtures } from "./packages/eval/dist/task-fixtures.js";
import { runAll, formatEvaluationReport } from "./packages/eval/dist/benchmark-runner.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "packages/eval/src/fixtures");
const repoPath = "/tmp/pi-proof-forge";

const allFixtures = loadAllFixtures(fixturesDir);
const piFixtures = allFixtures
  .filter((f) => f.id.startsWith("pi-"))
  .sort((a, b) => a.id.localeCompare(b.id));

console.log(`Loaded ${piFixtures.length} fixtures:`);
piFixtures.forEach((f) => console.log(`  - ${f.id}: ${f.category}`));
console.log();

const client = DeepSeekClient.fromEnv();
console.log(`Repo: ${repoPath}`);
console.log();

const startTime = Date.now();
const results = await runAll(piFixtures, repoPath, client);
const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

const report = formatEvaluationReport(results);
console.log(report);
console.log(`\nTotal time: ${elapsed}s`);
