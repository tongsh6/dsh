import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import * as yaml from "js-yaml";
import { runPatch, runRepair } from "./pipeline.js";
import type { DeepSeekClient } from "@dsh/provider";
import { writeTaskState, createTaskState } from "./task-state.js";

function mockClientSequence(responseContents: string[]): DeepSeekClient {
  let index = 0;
  return {
    chat: async () => {
      const content = responseContents[Math.min(index, responseContents.length - 1)] ?? "";
      index++;
      return {
        id: "test-id",
        object: "chat.completion",
        created: Date.now(),
        model: "deepseek-v4-pro",
        choices: [{
          index: 0,
          message: { role: "assistant" as const, content },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      };
    },
    chatStream: async function* () { yield undefined as any; },
  } as unknown as DeepSeekClient;
}

const V4_PATCH_DUMMY = `<PATCH>
--- a/dummy.py
+++ b/dummy.py
@@ -1 +1,2 @@
 # test
+# fixed
</PATCH>`;

const V4_DONE = `<DONE/>`;

async function setupGitRepo(): Promise<string> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-rollback-test-"));
  execSync("git init", { cwd: tmp, stdio: "ignore" });
  execSync('git config user.email "test@example.com"', { cwd: tmp });
  execSync('git config user.name "Test User"', { cwd: tmp });
  
  fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".dsh", "config.yml"),
    yaml.dump({
      project: { name: "test", language: "python" },
      verify: { test: "python3 test_dummy.py" },
      deepseek: { initial_preflight: false },
    }),
    "utf-8",
  );
  
  fs.writeFileSync(path.join(tmp, "dummy.py"), "# test\n", "utf-8");
  fs.writeFileSync(path.join(tmp, "test_dummy.py"), "import os\nassert os.path.exists('dummy.py')\n", "utf-8");
  
  execSync("git add .", { cwd: tmp });
  execSync('git commit -m "initial"', { cwd: tmp });
  
  return tmp;
}

describe("Transactional Rollback (PHASE-3-D)", () => {
  it("runPatch tracks managed_files and creates git checkpoints", async () => {
    const tmp = await setupGitRepo();
    try {
      const state = createTaskState("Fix bug", "bugfix");
      state.status = "planned";
      state.plan = {
        summary: "Fix bug",
        files: ["dummy.py"],
        risks: [],
        raw_xml: "<PLAN>Fix bug</PLAN>",
      };
      writeTaskState(tmp, state);

      const client = mockClientSequence([V4_PATCH_DUMMY, V4_DONE]);
      const finalState = await runPatch({ cwd: tmp, client, auto: true });

      assert.equal(finalState.status, "patched");
      assert.deepEqual(finalState.managed_files, ["dummy.py"]);
      
      // Check that a stash was created and then cleaned up (since we are using runPatch directly, 
      // but wait, cleanup happens in runFullPipeline. runPatch should leave the stash if not cleaned).
      // Actually, runPatch doesn't clean up.
      const stashes = execSync("git stash list", { cwd: tmp, encoding: "utf-8" });
      assert.ok(stashes.includes("dsh-checkpoint-patch-round-1"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("runRepair rolls back on regression", async () => {
    const tmp = await setupGitRepo();
    try {
      // Create a state where verification failed
      const state = createTaskState("Fix bug", "bugfix");
      state.status = "verification_failed";
      state.plan = {
        summary: "Fix bug",
        files: ["dummy.py"],
        risks: [],
        raw_xml: "<PLAN>Fix bug</PLAN>",
        verify_commands: ["python3 test_dummy.py"]
      };
      state.patches.push({
        round: 1,
        patch: "",
        apply_status: "ok",
        files_changed: ["dummy.py"]
      });
      // Initial failure (not a regression yet, just the starting point for repair)
      state.verify_results.push({
        round: 1,
        results: [{ command: "python3 test_dummy.py", status: "failed", exit_code: 1, output: "AssertionError", duration_ms: 10 }]
      });
      writeTaskState(tmp, state);

      // Repair attempt 1: Introduce a syntax error (regression)
      const V4_REPAIR_REGRESSION = `
<PLAN>
## Root Cause Analysis
Test failed
## Repair Strategy
Introduce syntax error
</PLAN>
<FILES>
- dummy.py
</FILES>
<PATCH>
--- a/dummy.py
+++ b/dummy.py
@@ -1 +1,2 @@
 # test
+invalid syntax!
</PATCH>
`;
      // Repair attempt 2: Correct fix
      const V4_REPAIR_FIX = `
<PLAN>
## Root Cause Analysis
Syntax error introduced
## Repair Strategy
Fix it properly
</PLAN>
<FILES>
- dummy.py
</FILES>
<PATCH>
--- a/dummy.py
+++ b/dummy.py
@@ -1 +1,2 @@
 # test
+# properly fixed
</PATCH>
<DONE/>
`;

      const client = mockClientSequence([V4_REPAIR_REGRESSION, V4_REPAIR_FIX]);
      
      // We need a way to make verification fail for the regression
      // The real runRepairAssertions will run python3 test_dummy.py
      // 'invalid syntax!' in dummy.py won't break test_dummy.py unless it imports it.
      // Let's update test_dummy.py to import dummy
      fs.writeFileSync(path.join(tmp, "test_dummy.py"), "import dummy\n", "utf-8");
      execSync("git add test_dummy.py && git commit -m 'update test'", { cwd: tmp });

      const finalState = await runRepair({ cwd: tmp, client, maxRounds: 2 });

      assert.equal(finalState.status, "verified");
      assert.equal(finalState.patches.length, 3); // Initial + Regression (rolled back) + Fix
      
      const regressionPatch = finalState.patches[1]!;
      assert.equal(regressionPatch.rolled_back, true);
      assert.equal(regressionPatch.rollback_reason, "regression");

      // Verify dummy.py doesn't have the syntax error
      const content = fs.readFileSync(path.join(tmp, "dummy.py"), "utf-8");
      assert.ok(!content.includes("invalid syntax!"));
      assert.ok(content.includes("# properly fixed"));

    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
