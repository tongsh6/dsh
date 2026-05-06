import { spawnSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { loadAllFixtures } from "../packages/eval/dist/task-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "packages/eval/src/fixtures");
const REPOS_DIR = path.join(os.homedir(), "dsh-bench", "repos");
const REPORTS_DIR = path.join(__dirname, "..", "docs", "reports");
const SKIP = new Set(["task-", "hallucinated", "overconfidence", "patch-drift", "rule-blindness", "scope-creep"]);
const REPOS: Record<string, string> = {
  "pi-": path.join(REPOS_DIR, "pi-proof-forge"),
  "loam-": path.join(REPOS_DIR, "loamlog"),
  "rh-": path.join(REPOS_DIR, "release-hub"),
};
const filter = (process.argv.find((a) => a.startsWith("--filter=")) ?? "").slice("--filter=".length) || null;
const TIMEOUT_MS = 600_000;

function git(cwd: string, args: string) {
  try { execSync(`git ${args}`, { cwd, stdio: "pipe", timeout: 15000, encoding: "utf-8" }); }
  catch {}
}

/** Run opencode with proper process lifecycle management.
 *  Uses spawnSync (not execSync) to avoid shell wrapping that leaves
 *  orphaned opencode processes on timeout. */
function runOpenCode(cwd: string, prompt: string): { ok: boolean; error?: string } {
  const result = spawnSync("opencode", [
    "run", "-m", "deepseek/deepseek-v4-pro", "--variant", "high",
    "--print-logs", prompt,
  ], {
    cwd,
    timeout: TIMEOUT_MS,
    maxBuffer: 50 * 1024 * 1024,
    encoding: "utf-8",
    // stdio: "pipe" is default — captures stdout/stderr
  });

  const ok = result.status === 0;
  const errSig = result.signal ? `signal=${result.signal}` : "";
  const errMsg = result.error?.message ?? "";
  return {
    ok,
    error: ok ? undefined : (errSig || errMsg || `exit=${result.status}`),
  };
}

(async () => {
  const fixtures = loadAllFixtures(FIXTURES_DIR)
    .filter((f: any) => f.id && ![...SKIP].some((t) => f.id.startsWith(t)))
    .filter((f: any) => !filter || f.id.startsWith(filter))
    .sort((a: any, b: any) => a.id.localeCompare(b.id));

  console.log(`OC bench: ${fixtures.length} fixtures`);
  const results: any[] = [];

  for (const f of fixtures) {
    const pre = Object.keys(REPOS).find((k) => f.id.startsWith(k));
    if (!pre) { console.log(`skip ${f.id}`); continue; }
    const repo = REPOS[pre]!;
    const branch = `oc-${f.id}`;
    const start = Date.now();

    git(repo, `checkout main`);
    git(repo, `branch -D ${branch}`);
    git(repo, `checkout -b ${branch}`);

    const { ok, error } = runOpenCode(repo, f.taskPrompt);

    let files: string[] = [];
    try {
      const out = execSync("git diff --name-only HEAD", { cwd: repo, encoding: "utf-8", timeout: 5000 }).trim();
      files = out ? out.split("\n").filter(Boolean) : [];
    } catch {}

    let passed = false;
    if (ok && f.verificationCommands?.length > 0) {
      passed = f.verificationCommands.every((cmd: string) => {
        try { execSync(cmd, { cwd: repo, stdio: "pipe", timeout: 60_000 }); return true; }
        catch { return false; }
      });
    }

    const secs = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`  ${f.id}: ${passed ? "PASS" : ok ? "FAIL" : "ERR"} (${secs}s)`);

    results.push({
      fixtureId: f.id, category: f.category,
      completed: ok, testsPassed: passed,
      filesChanged: files, error, durationMs: Date.now() - start,
    });

    git(repo, `reset --hard`);
    git(repo, `checkout main`);
    git(repo, `branch -D ${branch}`);
  }

  const runId = `oc-${Date.now().toString(36)}`;
  const dir = path.join(REPORTS_DIR, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(results, null, 2), "utf-8");
  console.log(`\n-> ${dir}`);
})();
