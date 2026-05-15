import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "js-yaml";
import { runPlan, runPatch, runVerify, runRepair, runHandoff, runFullPipeline, runPreflight, resolveVerifyCommands, resolveVerifyAssertions, computeUncoveredPlanFiles } from "./pipeline.js";
import { readTaskState } from "./task-state.js";
import type { DeepSeekClient, DeepSeekResponse } from "@dsh/provider";

// Helper: create a mock DeepSeekClient that returns the given content
function mockClient(responseContent: string): DeepSeekClient {
  return {
    chat: async () => ({
      id: "test-id",
      object: "chat.completion",
      created: Date.now(),
      model: "deepseek-v4-pro",
      choices: [{
        index: 0,
        message: { role: "assistant" as const, content: responseContent },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }),
    chatStream: async function* () { yield undefined as any; },
  } as unknown as DeepSeekClient;
}

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

const VALID_PLAN_RESPONSE = `
<PLAN>
## Goal
Fix the count_definitions function
## Files Involved
- tools/check_v2_constraints.py
## Strategy
Replace str.count with re.findall
</PLAN>
<FILES>
- tools/check_v2_constraints.py
</FILES>
<RISKS>
- Regex might be slightly slower
- Edge case: multi-line def signatures
</RISKS>
`;

const V4_PATCH_DUMMY = `<PATCH>
--- a/dummy.py
+++ b/dummy.py
@@ -1 +1,2 @@
 # test
+# fixed
</PATCH>`;

const V4_DONE = `<DONE/>`;

const V4_PATCH_DUMMY_LINT = `<PATCH>
--- a/dummy.py
+++ b/dummy.py
@@ -1,2 +1,3 @@
 # test
 # fixed
+# lint fixed
</PATCH>`;

// keep old name for compat
const VALID_PATCH_RESPONSE = `
<PLAN>
## Goal
Fix bug
## Files Involved
- dummy.py
## Strategy
Fix it
</PLAN>
<FILES>
- dummy.py
</FILES>
<PATCH>
--- a/dummy.py
+++ b/dummy.py
@@ -1 +1,2 @@
 # test
+# fixed
</PATCH>
<VERIFY>
echo ok
</VERIFY>
<RISKS>
- Minor risk
</RISKS>
`;

const _STATIC_REPAIR_PATCH_RESPONSE = `
<PLAN>
## Goal
Fix selected static scan finding
## Strategy
Add the missing lint marker comment
</PLAN>
<FILES>
- dummy.py
</FILES>
<PATCH>
--- a/dummy.py
+++ b/dummy.py
@@ -1,2 +1,3 @@
 # test
 # fixed
+# lint fixed
</PATCH>
<VERIFY>
node scan.mjs
</VERIFY>
<RISKS>
- Scanner expectations may change
- Comment-only fix may not satisfy future stricter rules
</RISKS>
`;

// Helper: setup temp dir with minimal config and files
async function setupTempDir(status: string = "init"): Promise<string> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
  fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".dsh", "config.yml"),
    yaml.dump({
      project: { name: "test", language: "python" },
      verify: { test: "echo ok" },
      rules: { files: [] },
      deepseek: {},
    }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(tmp, ".dsh", "task-state.json"),
    JSON.stringify({
      version: "0.1",
      status,
      task: { description: "Fix bug", type: "bugfix", created_at: new Date().toISOString() },
      plan: status !== "init" ? { summary: "Fix bug", files: ["dummy.py"], risks: [], raw_xml: "<PLAN>Fix bug</PLAN>" } : undefined,
      patches: [],
      verify_results: [],
      repair_rounds: 0,
    }, null, 2),
    "utf-8",
  );
  fs.writeFileSync(path.join(tmp, "dummy.py"), "# test", "utf-8");
  return tmp;
}

// ---- runPlan Tests ----

describe("runPlan", () => {
  it("generates a plan and transitions state to planned", async () => {
    const tmp = await setupTempDir();
    try {
      const client = mockClient(VALID_PLAN_RESPONSE);
      const state = await runPlan({ cwd: tmp, client, description: "Fix count_definitions bug", taskType: "bugfix" });
      assert.equal(state.status, "planned");
      assert.ok(state.plan);
      assert.equal(state.plan!.files.length, 1);
      assert.equal(state.task.type, "bugfix");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws after 2 attempts when response has no PLAN block and content is too short to use as fallback", async () => {
    const tmp = await setupTempDir();
    try {
      const client = mockClient("No plan here");
      await assert.rejects(
        () => runPlan({ cwd: tmp, client, description: "test", taskType: "bugfix" }),
        /未返回有效的 PLAN 块/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("retries once when PLAN block is missing, succeeds on second attempt", async () => {
    const tmp = await setupTempDir();
    try {
      const client = mockClientSequence(["No plan", VALID_PLAN_RESPONSE]);
      const state = await runPlan({ cwd: tmp, client, description: "test retry", taskType: "bugfix" });
      assert.equal(state.status, "planned");
      assert.ok(state.plan);
      assert.equal(state.plan!.files.length, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("retries when PLAN exists but the mandatory FILES block is empty", async () => {
    const tmp = await setupTempDir();
    try {
      let calls = 0;
      const missingFilesResponse = `<PLAN>
## Goal
Fix CSV export
## Files Involved
- backend/releasehub-application/src/main/java/io/releasehub/application/export/ExportAppService.java
- backend/releasehub-application/src/test/java/io/releasehub/application/export/ExportAppServiceTest.java
</PLAN>`;
      const client = {
        chat: async () => {
          calls++;
          const content = calls === 1 ? missingFilesResponse : VALID_PLAN_RESPONSE;
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

      const state = await runPlan({ cwd: tmp, client, description: "test files retry", taskType: "bugfix" });

      assert.equal(calls, 2);
      assert.deepEqual(state.plan!.files, ["tools/check_v2_constraints.py"]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when PLAN keeps omitting the mandatory FILES block", async () => {
    const tmp = await setupTempDir();
    try {
      const client = mockClient(`<PLAN>
## Goal
Fix CSV export
## Files Involved
- backend/releasehub-application/src/main/java/io/releasehub/application/export/ExportAppService.java
</PLAN>`);

      await assert.rejects(
        () => runPlan({ cwd: tmp, client, description: "test files missing", taskType: "bugfix" }),
        /未返回有效的 FILES 块/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---- runPatch Tests ----

describe("runPatch", () => {
  it("applies patch and transitions to patched", async () => {
    const tmp = await setupTempDir("planned");
    try {
      // v0.4: one change round + one DONE round
      const client = mockClientSequence([V4_PATCH_DUMMY, V4_DONE]);
      const state = await runPatch({ cwd: tmp, client, auto: true });
      assert.equal(state.status, "patched");
      assert.equal(state.patches.length, 1);
      assert.equal(state.patches[0]!.apply_status, "ok");
      assert.ok(state.patches[0]!.files_changed.includes("dummy.py"));
      assert.ok(state.patch_rounds.length >= 2);
      const modified = fs.readFileSync(path.join(tmp, "dummy.py"), "utf-8");
      assert.ok(modified.includes("# fixed"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when status is not planned or repairing", async () => {
    const tmp = await setupTempDir("init");
    try {
      const client = mockClient(VALID_PATCH_RESPONSE);
      await assert.rejects(
        () => runPatch({ cwd: tmp, client }),
        /需要 planned, repairing, preflighted 或 preflight_failed/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("runs static scan after patch and repairs selected top findings", async () => {
    const tmp = await setupTempDir("planned");
    try {
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "python" },
          verify: { test: "echo ok" },
          static_scan: { enabled: true, command: "node scan.mjs", top_n: 1 },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, "scan.mjs"),
        [
          "import fs from 'node:fs';",
          "const content = fs.readFileSync('dummy.py', 'utf-8');",
          "if (!content.includes('# lint fixed')) {",
          "  console.log(process.cwd() + '/dummy.py');",
          "  console.log('  2:1  error  Missing lint marker  dsh/no-marker');",
          "  process.exit(1);",
          "}",
          "console.log('clean');",
        ].join("\n"),
        "utf-8",
      );

      // Sequence: main patch → DONE → static repair patch
      const client = mockClientSequence([V4_PATCH_DUMMY, V4_DONE, V4_PATCH_DUMMY_LINT]);
      const state = await runPatch({ cwd: tmp, client, auto: true });

      assert.equal(state.status, "patched");
      assert.equal(state.static_scan_runs.length, 2);
      assert.equal(state.static_scan_runs[0]!.status, "failed");
      assert.equal(state.static_scan_runs[0]!.selected_top_n.length, 1);
      assert.equal(state.static_repair_results.length, 1);
      assert.equal(state.static_repair_results[0]!.apply_status, "ok");
      assert.equal(state.static_repair_results[0]!.post_scan_status, "passed");
      assert.equal(state.static_repair_results[0]!.remaining_findings, 0);
      assert.ok(fs.existsSync(path.join(tmp, state.static_scan_runs[0]!.output_path)));
      assert.ok(fs.readFileSync(path.join(tmp, "dummy.py"), "utf-8").includes("# lint fixed"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("executes tool calls in loop before applying patch", async () => {
    const tmp = await setupTempDir("planned");

    // Create a source file that the tool will read
    const sourceDir = path.join(tmp, "src");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, "utils.ts"),
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
      "utf-8",
    );

    // plan.files aligns with what V4_PATCH_DUMMY patches (dummy.py); the
    // src/utils.ts file is a read-only exploration target for the read_file
    // tool, not in the change scope.
    const taskState = JSON.parse(fs.readFileSync(path.join(tmp, ".dsh", "task-state.json"), "utf-8"));
    taskState.plan.files = ["dummy.py"];
    fs.writeFileSync(path.join(tmp, ".dsh", "task-state.json"), JSON.stringify(taskState, null, 2), "utf-8");

    let callIndex = 0;
    const responses: DeepSeekResponse[] = [
      // Round 1: model calls read_file to explore
      {
        id: "r1",
        object: "chat.completion",
        created: Date.now(),
        model: "deepseek-v4-pro",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "call_read_1",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"src/utils.ts"}',
              },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
      },
      // Round 2: model outputs patch after reading the file
      {
        id: "r2",
        object: "chat.completion",
        created: Date.now(),
        model: "deepseek-v4-pro",
        choices: [{
          index: 0,
          message: { role: "assistant", content: V4_PATCH_DUMMY },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 150, completion_tokens: 80, total_tokens: 230 },
      },
      // Round 3: model signals done
      {
        id: "r3",
        object: "chat.completion",
        created: Date.now(),
        model: "deepseek-v4-pro",
        choices: [{
          index: 0,
          message: { role: "assistant", content: V4_DONE },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 120, completion_tokens: 10, total_tokens: 130 },
      },
    ];

    const client = {
      chat: async () => {
        const res = responses[Math.min(callIndex, responses.length - 1)]!;
        callIndex++;
        return res;
      },
      chatStream: async function* () { yield undefined as any; },
    } as unknown as DeepSeekClient;

    const state = await runPatch({ cwd: tmp, client, auto: true });

    assert.equal(state.status, "patched");
    assert.ok(callIndex >= 2, `should have made >= 2 API calls (tool + patch), got ${callIndex}`);
    assert.equal(state.patches.length, 1);
    assert.ok(state.patch_rounds.length >= 3, `should have >= 3 rounds, got ${state.patch_rounds.length}`);
  });

  // ---- v0.4 patch loop behavioral tests ----

const V4_PATCH_FILE_A = `<PATCH>
--- a/dummy.py
+++ b/dummy.py
@@ -1 +1,2 @@
 # test
+# patched A
</PATCH>`;

const V4_PATCH_FILE_B = `<PATCH>
--- a/dummy.py
+++ b/dummy.py
@@ -1,2 +1,3 @@
 # test
+# patched B
</PATCH>`;

  it("single change + done → patched with 2 rounds", async () => {
    const tmp = await setupTempDir("planned");
    try {
      const client = mockClientSequence([V4_PATCH_FILE_A, V4_DONE]);
      const state = await runPatch({ cwd: tmp, client, auto: true });
      assert.equal(state.status, "patched");
      assert.equal(state.patch_rounds.length, 2);
      assert.equal(state.patch_rounds[0]!.action, "change");
      assert.equal(state.patch_rounds[1]!.action, "done");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("multi-file: 3 changes + done → patched", async () => {
    const tmp = await setupTempDir("planned");
    try {
      const client = mockClientSequence([V4_PATCH_FILE_A, V4_PATCH_FILE_B, V4_PATCH_FILE_A, V4_DONE]);
      const state = await runPatch({ cwd: tmp, client, auto: true });
      assert.equal(state.status, "patched");
      assert.equal(state.patch_rounds.length, 4);
      assert.ok(state.patches[0]!.apply_status === "ok" || state.patches[0]!.apply_status === "partial_ok");
      assert.ok(state.patches[0]!.files_changed.includes("dummy.py"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("3 consecutive invalid → patch_failed", async () => {
    const tmp = await setupTempDir("planned");
    try {
      // Return XML that parsePatchTurn treats as invalid (multiple change blocks)
      const multiBlock = `<CREATE path="a.ts">a</CREATE>
<CREATE path="b.ts">b</CREATE>`;
      const client = mockClient(multiBlock); // always returns multi-block → invalid every round
      const state = await runPatch({ cwd: tmp, client, auto: true });

      assert.equal(state.status, "patch_failed");
      // Should have exited early after 3 consecutive invalid, not 30 rounds
      assert.ok(state.patch_rounds.length <= 5, `expected <= 5 rounds, got ${state.patch_rounds.length}`);
      const invalidRounds = state.patch_rounds.filter((r) => r.action === "invalid");
      assert.ok(invalidRounds.length >= 3);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("pauses tools after initial analysis paralysis so the model must emit a change block", async () => {
    const tmp = await setupTempDir("planned");
    try {
      const toolsSeen: boolean[] = [];
      let callIndex = 0;
      const toolResponse: DeepSeekResponse = {
        id: "tool",
        object: "chat.completion",
        created: Date.now(),
        model: "deepseek-v4-pro",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "t1",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"dummy.py"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      };

      const client = {
        chat: async (request: any) => {
          toolsSeen.push(Array.isArray(request.tools));
          callIndex++;
          const content = callIndex === 11
            ? V4_PATCH_FILE_A
            : callIndex === 12
              ? V4_DONE
              : null;
          if (content) {
            return {
              id: `r${callIndex}`,
              object: "chat.completion",
              created: Date.now(),
              model: "deepseek-v4-pro",
              choices: [{ index: 0, message: { role: "assistant" as const, content }, finish_reason: "stop" as const }],
              usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
            };
          }
          return toolResponse;
        },
        chatStream: async function* () { yield undefined as any; },
      } as unknown as DeepSeekClient;

      const state = await runPatch({ cwd: tmp, client, auto: true });

      assert.equal(state.status, "patched");
      assert.equal(toolsSeen[9], true);
      assert.equal(toolsSeen[10], false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects tool calls returned while initial-stall tools are paused", async () => {
    const tmp = await setupTempDir("planned");
    try {
      const toolResponse: DeepSeekResponse = {
        id: "tool",
        object: "chat.completion",
        created: Date.now(),
        model: "deepseek-v4-pro",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "t1",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"dummy.py"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      };
      const client = {
        chat: async () => toolResponse,
        chatStream: async function* () { yield undefined as any; },
      } as unknown as DeepSeekClient;

      const state = await runPatch({ cwd: tmp, client, auto: true });

      assert.equal(state.status, "patch_failed");
      assert.ok(state.patch_rounds.length < 30);
      assert.ok(state.patch_rounds.some((r) =>
        r.action === "invalid" && r.invalid_reason?.includes("tool calls are paused")
      ));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("tool → change → done → patched with all round types recorded", async () => {
    const tmp = await setupTempDir("planned");
    try {
      let callIndex = 0;
      const responses: DeepSeekResponse[] = [
        // Round 1: tool call
        {
          id: "r1", object: "chat.completion", created: Date.now(), model: "deepseek-v4-pro",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{ id: "t1", type: "function", function: { name: "read_file", arguments: '{"path":"dummy.py"}' } }],
            },
            finish_reason: "tool_calls",
          }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        },
        // Round 2: change
        {
          id: "r2", object: "chat.completion", created: Date.now(), model: "deepseek-v4-pro",
          choices: [{ index: 0, message: { role: "assistant", content: V4_PATCH_FILE_A }, finish_reason: "stop" }],
          usage: { prompt_tokens: 60, completion_tokens: 30, total_tokens: 90 },
        },
        // Round 3: done
        {
          id: "r3", object: "chat.completion", created: Date.now(), model: "deepseek-v4-pro",
          choices: [{ index: 0, message: { role: "assistant", content: V4_DONE }, finish_reason: "stop" }],
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        },
      ];
      const client = {
        chat: async () => {
          const res = responses[Math.min(callIndex, responses.length - 1)]!;
          callIndex++;
          return res;
        },
        chatStream: async function* () { yield undefined as any; },
      } as unknown as DeepSeekClient;

      const state = await runPatch({ cwd: tmp, client, auto: true });
      assert.equal(state.status, "patched");
      assert.ok(state.patch_rounds.length >= 3);
      // Check round type sequence
      const actions = state.patch_rounds.map((r) => r.action);
      assert.ok(actions.includes("tools"), `expected tools action, got: ${actions.join(",")}`);
      assert.ok(actions.includes("change"), `expected change action, got: ${actions.join(",")}`);
      assert.ok(actions.includes("done"), `expected done action, got: ${actions.join(",")}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("change fail → model retries → eventually patched", async () => {
    const tmp = await setupTempDir("planned");
    try {
      // First change: valid diff but targets non-existent file → apply fails
      const badPatch = `<PATCH>
--- a/nonexistent.ts
+++ b/nonexistent.ts
@@ -1 +1,2 @@
-old
+new
</PATCH>`;
      const client = mockClientSequence([badPatch, V4_PATCH_FILE_A, V4_DONE]);
      const state = await runPatch({ cwd: tmp, client, auto: true });

      assert.equal(state.status, "patched");
      const changeRounds = state.patch_rounds.filter((r) => r.action === "change");
      assert.ok(changeRounds.length >= 2);
      // First change should have failed (file doesn't exist)
      assert.equal(changeRounds[0]!.change!.apply_status, "failed");
      // Second change should have succeeded
      assert.equal(changeRounds[1]!.change!.apply_status, "ok");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("exits after 3 consecutive invalid (not max rounds)", async () => {
    const tmp = await setupTempDir("planned");
    try {
      const emptyContent = "just some random text without any XML blocks";
      const client = mockClient(emptyContent);
      const state = await runPatch({ cwd: tmp, client, auto: true });

      assert.equal(state.status, "patch_failed");
      // Should exit after 3 invalid, not loop 30 times
      assert.ok(state.patch_rounds.length === 3,
        `expected 3 rounds (3 consecutive invalid → early exit), got ${state.patch_rounds.length}`);
      state.patch_rounds.forEach((r) => {
        assert.equal(r.action, "invalid");
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ---- P2 spec 2026-05-07-patch-completeness behavioral tests ----

  // Helper: stamp plan.files with a multi-file plan after setupTempDir.
  function setMultiFilePlan(tmp: string, files: string[]): void {
    const ts = JSON.parse(fs.readFileSync(path.join(tmp, ".dsh", "task-state.json"), "utf-8"));
    ts.plan.files = files;
    fs.writeFileSync(path.join(tmp, ".dsh", "task-state.json"), JSON.stringify(ts, null, 2), "utf-8");
  }

  it("accepts DONE even when plan.files not fully covered", async () => {
    const tmp = await setupTempDir("planned");
    try {
      // plan declares 2 files; first round only patches dummy.py
      setMultiFilePlan(tmp, ["dummy.py", "other.py"]);
      fs.writeFileSync(path.join(tmp, "other.py"), "# other\n", "utf-8");

      // Sequence: change A → DONE (now accepted)
      const client = mockClientSequence([V4_PATCH_FILE_A, V4_DONE]);
      const state = await runPatch({ cwd: tmp, client, auto: true });

      assert.equal(state.status, "patched", `expected patched even with uncovered files, got ${state.status}`);

      // Check for the incomplete_note in the done round
      const doneRound = state.patch_rounds.find((r) => r.action === "done");
      assert.ok(doneRound, "should have a done round");
      assert.ok(doneRound.incomplete_note?.includes("other.py"), `expected incomplete_note to mention other.py, got: ${doneRound.incomplete_note}`);

      // Final patch record should have patch_incomplete_reason
      const lastPatch = state.patches.at(-1)!;
      assert.ok(lastPatch.files_changed.includes("dummy.py"));
      assert.ok(!lastPatch.files_changed.includes("other.py"));
      assert.ok(lastPatch.patch_incomplete_reason?.includes("other.py"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("aggregate: ≥1 change ok + plan.files uncovered → patched with patch_incomplete_reason", async () => {
    const tmp = await setupTempDir("planned");
    try {
      setMultiFilePlan(tmp, ["dummy.py", "missing.py"]);

      // Model patches dummy.py then keeps emitting invalid → 3 invalid → exit
      const junk = "no xml blocks here";
      const client = mockClientSequence([V4_PATCH_FILE_A, junk, junk, junk]);
      const state = await runPatch({ cwd: tmp, client, auto: true });

      assert.equal(state.status, "patched", `expected patched (partial success) when plan.files uncovered, got ${state.status}`);

      const lastPatch = state.patches.at(-1)!;
      assert.ok(lastPatch.files_changed.includes("dummy.py"));
      assert.ok(
        lastPatch.patch_incomplete_reason?.includes("missing.py"),
        `expected patch_incomplete_reason to mention missing.py, got: ${lastPatch.patch_incomplete_reason}`,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("aggregate: ≥1 change ok + plan.files fully covered → patched (no incomplete reason)", async () => {
    const tmp = await setupTempDir("planned");
    try {
      // setupTempDir defaults plan.files=["dummy.py"]; V4_PATCH_FILE_A targets dummy.py
      const client = mockClientSequence([V4_PATCH_FILE_A, V4_DONE]);
      const state = await runPatch({ cwd: tmp, client, auto: true });

      assert.equal(state.status, "patched");
      const lastPatch = state.patches.at(-1)!;
      assert.equal(lastPatch.patch_incomplete_reason, undefined);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("3 consecutive DONE-rejects (with NO changes) exit via consecutiveInvalid guard → patch_failed", async () => {
    const tmp = await setupTempDir("planned");
    try {
      setMultiFilePlan(tmp, ["dummy.py"]);

      // refuse to do anything but DONE 3 times (no changes made)
      const client = mockClientSequence([V4_DONE, V4_DONE, V4_DONE]);
      const state = await runPatch({ cwd: tmp, client, auto: true });

      assert.equal(state.status, "patch_failed");
      const invalidRounds = state.patch_rounds.filter((r) => r.action === "invalid");
      assert.ok(invalidRounds.length >= 3, `expected ≥3 invalid rounds, got ${invalidRounds.length}`);
      assert.ok(invalidRounds.every((r) => r.invalid_reason === "done_with_no_changes"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---- runPreflight Tests ----

describe("runPreflight", () => {
  it("does not run final acceptance assertions during preflight", async () => {
    const tmp = await setupTempDir("planned");
    try {
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "python" },
          verify: {
            assertions: [
              { type: "file_exists", file: "created-after-patch.txt" },
            ],
          },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      const client = mockClient("<DONE/>");
      const state = await runPreflight({ cwd: tmp, client });
      assert.equal(state.status, "preflighted");
      assert.equal(state.preflight_results.length, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("runs explicit preflight commands when configured", async () => {
    const tmp = await setupTempDir("planned");
    try {
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "python" },
          verify: {
            preflight_commands: ["echo preflight-ok"],
            assertions: [{ type: "file_exists", file: "created-after-patch.txt" }],
          },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      const client = mockClient("<DONE/>");
      const state = await runPreflight({ cwd: tmp, client });
      assert.equal(state.status, "preflighted");
      assert.equal(state.preflight_results.length, 1);
      assert.equal(state.preflight_results[0]!.results[0]!.status, "passed");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips preflight if initial_preflight is false", async () => {
    const tmp = await setupTempDir("planned");
    try {
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({ verify: { initial_preflight: false } }),
        "utf-8"
      );
      const client = mockClient("should not be called");
      const state = await runPreflight({ cwd: tmp, client });
      assert.equal(state.status, "preflighted");
      assert.equal(state.preflight_results.length, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("preserves non-string preflight tool arguments so persisted state can be read back", async () => {
    const tmp = await setupTempDir("planned");
    try {
      let callIndex = 0;
      const responses: DeepSeekResponse[] = [
        {
          id: "preflight-tool",
          object: "chat.completion",
          created: Date.now(),
          model: "deepseek-v4-pro",
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "call_read_1",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: '{"path":"dummy.py","limit":5}',
                },
              }],
            },
            finish_reason: "tool_calls",
          }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        },
        {
          id: "preflight-done",
          object: "chat.completion",
          created: Date.now(),
          model: "deepseek-v4-pro",
          choices: [{
            index: 0,
            message: { role: "assistant", content: "<DONE/>" },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        },
      ];
      const client = {
        chat: async () => {
          const res = responses[Math.min(callIndex, responses.length - 1)]!;
          callIndex++;
          return res;
        },
        chatStream: async function* () { yield undefined as any; },
      } as unknown as DeepSeekClient;

      const state = await runPreflight({ cwd: tmp, client });
      const persisted = readTaskState(tmp);

      assert.equal(state.status, "preflighted");
      assert.ok(persisted, "persisted task-state should parse after preflight tool calls");
      assert.equal(persisted!.tool_rounds[0]!.calls[0]!.arguments.limit, 5);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---- runVerify Tests ----

describe("computeUncoveredPlanFiles", () => {
  it("returns empty when every plan file matches a changed file exactly", () => {
    assert.deepEqual(
      computeUncoveredPlanFiles(["src/a.ts", "src/b.ts"], ["src/a.ts", "src/b.ts"]),
      [],
    );
  });

  it("returns the missing plan files when only some are covered", () => {
    assert.deepEqual(
      computeUncoveredPlanFiles(
        ["backend/Foo.java", "backend/Bar.java"],
        ["backend/Foo.java"],
      ),
      ["backend/Bar.java"],
    );
  });

  it("uses endsWith matching so relative vs absolute paths match", () => {
    assert.deepEqual(
      computeUncoveredPlanFiles(["src/a.ts"], ["/repo/src/a.ts"]),
      [],
    );
    assert.deepEqual(
      computeUncoveredPlanFiles(["/repo/src/a.ts"], ["src/a.ts"]),
      [],
    );
  });

  it("returns all plan files when nothing was changed", () => {
    assert.deepEqual(
      computeUncoveredPlanFiles(["src/a.ts", "src/b.ts"], []),
      ["src/a.ts", "src/b.ts"],
    );
  });

  it("returns empty when plan files is empty", () => {
    assert.deepEqual(
      computeUncoveredPlanFiles([], ["src/a.ts"]),
      [],
    );
  });
});

describe("resolveVerifyCommands", () => {
  it("returns the commands array when set, ignoring legacy slots", () => {
    const result = resolveVerifyCommands(
      { commands: ["grep -q foo bar.txt", "pnpm test"], test: "old joined && cmd" },
      { test: true, lint: true, typecheck: true },
    );
    assert.deepEqual(result, ["grep -q foo bar.txt", "pnpm test"]);
  });

  it("falls back to test/lint/typecheck slots when commands is missing", () => {
    const result = resolveVerifyCommands(
      { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
      { test: true, lint: true, typecheck: true },
    );
    assert.deepEqual(result, ["pnpm test", "pnpm lint", "pnpm typecheck"]);
  });

  it("falls back when commands is an empty array", () => {
    const result = resolveVerifyCommands(
      { commands: [], test: "pnpm test" },
      { test: true, lint: false, typecheck: false },
    );
    assert.deepEqual(result, ["pnpm test"]);
  });

  it("returns the selected legacy slots only when explicit selection is given", () => {
    const result = resolveVerifyCommands(
      { test: "pnpm test", lint: "pnpm lint", typecheck: "pnpm typecheck" },
      { lint: true },
    );
    assert.deepEqual(result, ["pnpm lint"]);
  });

  it("returns all non-empty legacy slots when no selection is given", () => {
    const result = resolveVerifyCommands(
      { test: "pnpm test", lint: "", typecheck: "pnpm typecheck" },
      {},
    );
    assert.deepEqual(result, ["pnpm test", "pnpm typecheck"]);
  });

  it("trims whitespace and drops blank entries from commands array", () => {
    const result = resolveVerifyCommands(
      { commands: ["  pnpm test  ", "", "   ", "pnpm lint"] },
      {},
    );
    assert.deepEqual(result, ["pnpm test", "pnpm lint"]);
  });

  it("returns [] for undefined verify config", () => {
    assert.deepEqual(resolveVerifyCommands(undefined, {}), []);
  });
});

describe("resolveVerifyAssertions", () => {
  it("uses assertions field when set, ignoring commands and slots", () => {
    const result = resolveVerifyAssertions(
      {
        assertions: [{ type: "file_contains", file: "a.ts", pattern: "x" }],
        commands: ["echo legacy"],
        test: "pnpm test",
      },
      { test: true, lint: true, typecheck: true },
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]!.type, "file_contains");
  });

  it("falls back to commands when assertions empty", () => {
    const result = resolveVerifyAssertions(
      { commands: ["echo a", "echo b"] },
      { test: true, lint: true, typecheck: true },
    );
    assert.equal(result.length, 2);
    assert.ok(result.every((r) => r.type === "shell"));
    assert.equal((result[0] as { command: string }).command, "echo a");
  });

  it("falls back to test/lint/typecheck slots when both assertions and commands missing", () => {
    const result = resolveVerifyAssertions(
      { test: "pnpm test", lint: "pnpm lint" },
      { test: true, lint: true, typecheck: true },
    );
    assert.equal(result.length, 2);
    assert.ok(result.every((r) => r.type === "shell"));
  });

  it("drops unparseable assertion entries silently", () => {
    const result = resolveVerifyAssertions(
      {
        assertions: [
          { type: "file_exists", file: "a.ts" },
          { type: "garbage" },
          { type: "file_contains" }, // missing file/pattern
          { type: "shell", command: "echo ok" },
        ],
      },
      {},
    );
    assert.equal(result.length, 2);
    assert.equal(result[0]!.type, "file_exists");
    assert.equal(result[1]!.type, "shell");
  });

  it("falls back to commands when assertions parse to empty list", () => {
    const result = resolveVerifyAssertions(
      {
        assertions: [{ type: "garbage" }, { type: "still_garbage" }],
        commands: ["echo fallback"],
      },
      {},
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]!.type, "shell");
    assert.equal((result[0] as { command: string }).command, "echo fallback");
  });

  it("returns [] for undefined config", () => {
    assert.deepEqual(resolveVerifyAssertions(undefined, {}), []);
  });
});

describe("runVerify", () => {
  it("transitions to verified when all checks pass", async () => {
    const tmp = await setupTempDir("patched");
    try {
      const state = await runVerify({ cwd: tmp });
      assert.equal(state.status, "verified");
      assert.equal(state.verify_results.length, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("transitions to verification_failed on failure", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "python" },
          verify: { test: "exit 1" },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "patched",
          task: { description: "test", type: "bugfix", created_at: new Date().toISOString() },
          patches: [{ round: 1, patch: "", apply_status: "ok", files_changed: ["dummy.py"] }],
          verify_results: [],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );
      const state = await runVerify({ cwd: tmp });
      assert.equal(state.status, "verification_failed");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("scope-completeness check no longer fails verification, but records a diagnostic note", async () => {
    // (spec 2026-05-07-patch-completeness §3.5 relaxed) — we no longer fail
    // verification just because plan.files were uncovered. We let the actual
    // tests be the authoritative signal.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "python" },
          verify: { test: "echo ok" }, // verify itself passes
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "patched",
          task: { description: "fix two", type: "bugfix", created_at: new Date().toISOString() },
          plan: { summary: "fix", files: ["dummy.py", "missing.py"], risks: [], raw_xml: "<PLAN>fix</PLAN>" },
          patches: [{ round: 1, patch: "", apply_status: "ok", files_changed: ["dummy.py"] }],
          verify_results: [],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );
      const state = await runVerify({ cwd: tmp });
      assert.equal(state.status, "verified");
      const scopeRound = state.verify_results.find(vr => vr.results.some(r => r.command === "scope-completeness"));
      assert.ok(scopeRound, "should have recorded a scope-completeness diagnostic");
      const res = scopeRound.results.find(r => r.command === "scope-completeness")!;
      assert.equal(res.status, "passed");
      assert.ok(res.output.includes("missing.py"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---- runRepair Tests ----

describe("runRepair", () => {
  it("rejects when status is not verification_failed", async () => {
    const tmp = await setupTempDir("planned");
    try {
      const client = undefined as any;
      await assert.rejects(
        () => runRepair({ cwd: tmp, client }),
        /需要 verification_failed/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("runs repair loop and returns verified state on success", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "python" },
          verify: { test: "echo ok" },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "verification_failed",
          task: { description: "test", type: "bugfix", created_at: new Date().toISOString() },
          plan: { summary: "test", files: ["dummy.py"], risks: [], raw_xml: "<PLAN>test</PLAN>" },
          patches: [{ round: 1, patch: "", apply_status: "ok", files_changed: ["dummy.py"] }],
          verify_results: [{ round: 1, results: [{ command: "exit 1", status: "failed", exit_code: 1, output: "fail", duration_ms: 10 }] }],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );
      fs.writeFileSync(path.join(tmp, "dummy.py"), "# test", "utf-8");

      const client = mockClient(VALID_PATCH_RESPONSE);
      const state = await runRepair({ cwd: tmp, client, maxRounds: 1 });

      assert.equal(state.status, "verified");
      assert.ok(state.repair_rounds >= 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("injects patch_incomplete_reason hint into repair task description", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "python" },
          verify: { test: "echo ok" },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      // patch_failed state: dummy.py changed but missing.py uncovered
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "patch_failed",
          task: { description: "fix two files", type: "bugfix", created_at: new Date().toISOString() },
          plan: { summary: "fix", files: ["dummy.py", "missing.py"], risks: [], raw_xml: "<PLAN>fix</PLAN>" },
          patches: [{
            round: 1,
            patch: "",
            apply_status: "ok",
            files_changed: ["dummy.py"],
            patch_incomplete_reason: "uncovered plan files: missing.py",
          }],
          verify_results: [],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );
      fs.writeFileSync(path.join(tmp, "dummy.py"), "# test", "utf-8");
      fs.writeFileSync(path.join(tmp, "missing.py"), "# missing\n", "utf-8");

      const captured: string[] = [];
      const captureClient = {
        chat: async (req: any) => {
          for (const m of req.messages ?? []) {
            if (m.role === "user" && typeof m.content === "string") {
              captured.push(m.content);
            }
          }
          // Return a simple no-op response so the repair loop can complete
          return {
            id: "r1", object: "chat.completion", created: Date.now(), model: "deepseek-v4-pro",
            choices: [{ index: 0, message: { role: "assistant" as const, content: "<DONE/>" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
        chatStream: async function* () { yield undefined as any; },
      } as unknown as DeepSeekClient;

      await runRepair({ cwd: tmp, client: captureClient, maxRounds: 1 });

      const allUserContent = captured.join("\n---\n");
      assert.ok(
        allUserContent.includes("PATCH INCOMPLETE"),
        "repair task description should include 'PATCH INCOMPLETE' header",
      );
      assert.ok(
        allUserContent.includes("missing.py"),
        "repair task description should mention the uncovered file 'missing.py'",
      );
      assert.ok(
        allUserContent.includes("dummy.py"),
        "repair task description should list the already-modified file so the model does not duplicate edits",
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("injects source context around Java compilation errors into repair task description", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      const javaPath = "backend/releasehub-application/src/main/java/io/releasehub/application/export/ExportAppService.java";
      const absJavaPath = path.join(tmp, javaPath);
      fs.mkdirSync(path.dirname(absJavaPath), { recursive: true });
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "java" },
          verify: { test: "echo ok" },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      fs.writeFileSync(
        absJavaPath,
        [
          "package io.releasehub.application.export;",
          "",
          "public class ExportAppService {",
          "  public String exportCsv() {",
          "    String header = columns.stream()",
          "      .map(this::escapeCsv)",
          "      .collect(java.util.stream.Collectors.joining(\",\"));",
          "    return header;",
          "  }",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "verification_failed",
          task: { description: "fix CSV export", type: "bugfix", created_at: new Date().toISOString() },
          plan: { summary: "fix", files: [javaPath], risks: [], raw_xml: "<PLAN>fix</PLAN>" },
          patches: [{ round: 1, patch: "", apply_status: "ok", files_changed: [javaPath] }],
          verify_results: [{
            round: 1,
            results: [{
              command: "maven_test",
              status: "failed",
              exit_code: 1,
              output: `[ERROR] ${absJavaPath}:[5,35] ';' expected`,
              duration_ms: 10,
            }],
          }],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );

      const captured: string[] = [];
      const captureClient = {
        chat: async (req: any) => {
          for (const m of req.messages ?? []) {
            if (m.role === "user" && typeof m.content === "string") {
              captured.push(m.content);
            }
          }
          return {
            id: "r1", object: "chat.completion", created: Date.now(), model: "deepseek-v4-pro",
            choices: [{ index: 0, message: { role: "assistant" as const, content: "<DONE/>" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
        chatStream: async function* () { yield undefined as any; },
      } as unknown as DeepSeekClient;

      await runRepair({ cwd: tmp, client: captureClient, maxRounds: 1 });

      const allUserContent = captured.join("\n---\n");
      assert.ok(
        allUserContent.includes("## Verification Failure Source Context"),
        "repair task description should include a source-context section for compiler errors",
      );
      assert.ok(
        allUserContent.includes(javaPath),
        "source context should identify the failing Java file",
      );
      assert.ok(
        allUserContent.includes("5 |     String header = columns.stream()"),
        "source context should include the failing line with its line number",
      );
      assert.ok(
        allUserContent.includes("line 5, column 35"),
        "source context should include the compiler line and column",
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("injects Java codebase search results for case-sensitive compiler error identifiers", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      const testPath = "backend/releasehub-application/src/test/java/io/releasehub/application/export/ExportAppServiceTest.java";
      const enumPath = "backend/releasehub-domain/src/main/java/io/releasehub/domain/run/RunType.java";
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      fs.mkdirSync(path.dirname(path.join(tmp, testPath)), { recursive: true });
      fs.mkdirSync(path.dirname(path.join(tmp, enumPath)), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "java" },
          verify: { test: "echo ok" },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, testPath),
        [
          "package io.releasehub.application.export;",
          "",
          "import io.releasehub.domain.run.RunType;",
          "",
          "class ExportAppServiceTest {",
          "  void usesRunType() {",
          "    Object type = RunType.MERGE;",
          "  }",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, enumPath),
        [
          "package io.releasehub.domain.run;",
          "",
          "public enum RunType {",
          "    WINDOW_ORCHESTRATION,",
          "    ATTACH_ITERATION,",
          "    VERSION_UPDATE",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "verification_failed",
          task: { description: "fix CSV export", type: "bugfix", created_at: new Date().toISOString() },
          plan: { summary: "fix", files: [testPath], risks: [], raw_xml: "<PLAN>fix</PLAN>" },
          patches: [{ round: 1, patch: "", apply_status: "ok", files_changed: [testPath] }],
          verify_results: [{
            round: 1,
            results: [{
              command: "maven_test",
              status: "failed",
              exit_code: 1,
              output: `[ERROR] ${path.join(tmp, testPath)}:[7,26] cannot find symbol\n  symbol:   variable MERGE\n  location: class io.releasehub.domain.run.RunType`,
              duration_ms: 10,
            }],
          }],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );

      const captured: string[] = [];
      const captureClient = {
        chat: async (req: any) => {
          for (const m of req.messages ?? []) {
            if (m.role === "user" && typeof m.content === "string") {
              captured.push(m.content);
            }
          }
          return {
            id: "r1", object: "chat.completion", created: Date.now(), model: "deepseek-v4-pro",
            choices: [{ index: 0, message: { role: "assistant" as const, content: "<DONE/>" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
        chatStream: async function* () { yield undefined as any; },
      } as unknown as DeepSeekClient;

      await runRepair({ cwd: tmp, client: captureClient, maxRounds: 1 });

      const allUserContent = captured.join("\n---\n");
      assert.ok(
        allUserContent.includes("## Codebase Search Results"),
        "repair task description should include codebase search results for compiler identifiers",
      );
      assert.ok(
        allUserContent.includes("RunType.java"),
        "search context should include the Java enum definition file",
      );
      assert.ok(
        allUserContent.includes("WINDOW_ORCHESTRATION"),
        "search context should preserve Java case and include valid enum constants",
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("injects source context around Java stack trace frames into repair task description", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      const testPath = "backend/releasehub-application/src/test/java/io/releasehub/application/export/ExportAppServiceTest.java";
      const absTestPath = path.join(tmp, testPath);
      fs.mkdirSync(path.dirname(absTestPath), { recursive: true });
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "java" },
          verify: { test: "echo ok" },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      fs.writeFileSync(
        absTestPath,
        [
          "package io.releasehub.application.export;",
          "",
          "class ExportAppServiceTest {",
          "  Object createRunItem() {",
          "    String id = null;",
          "    return RunItem.rehydrate(id);",
          "  }",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "verification_failed",
          task: { description: "fix CSV export", type: "bugfix", created_at: new Date().toISOString() },
          plan: { summary: "fix", files: [testPath], risks: [], raw_xml: "<PLAN>fix</PLAN>" },
          patches: [{ round: 1, patch: "", apply_status: "ok", files_changed: [testPath] }],
          verify_results: [{
            round: 1,
            results: [{
              command: "maven_test",
              status: "failed",
              exit_code: 1,
              output: "java.lang.NullPointerException\n\tat io.releasehub.application.export.ExportAppServiceTest.createRunItem(ExportAppServiceTest.java:6)",
              duration_ms: 10,
            }],
          }],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );

      const captured: string[] = [];
      const captureClient = {
        chat: async (req: any) => {
          for (const m of req.messages ?? []) {
            if (m.role === "user" && typeof m.content === "string") {
              captured.push(m.content);
            }
          }
          return {
            id: "r1", object: "chat.completion", created: Date.now(), model: "deepseek-v4-pro",
            choices: [{ index: 0, message: { role: "assistant" as const, content: "<DONE/>" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
        chatStream: async function* () { yield undefined as any; },
      } as unknown as DeepSeekClient;

      await runRepair({ cwd: tmp, client: captureClient, maxRounds: 1 });

      const allUserContent = captured.join("\n---\n");
      assert.ok(allUserContent.includes("## Verification Failure Source Context"));
      assert.ok(allUserContent.includes(testPath));
      assert.ok(allUserContent.includes("6 |     return RunItem.rehydrate(id);"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("injects stuck-on-error diagnosis after repeated verify output", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "python" },
          verify: { test: "echo still failing && exit 1" },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      fs.writeFileSync(path.join(tmp, "dummy.py"), "x = 1\n", "utf-8");
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "verification_failed",
          task: { description: "fix repeated failure", type: "bugfix", created_at: new Date().toISOString() },
          plan: { summary: "fix", files: ["dummy.py"], risks: [], raw_xml: "<PLAN>fix</PLAN>" },
          patches: [{ round: 1, patch: "", apply_status: "ok", files_changed: ["dummy.py"] }],
          verify_results: [
            { round: 1, results: [{ command: "pytest", status: "failed", exit_code: 1, output: "AssertionError: same failure", duration_ms: 10 }] },
            { round: 2, results: [{ command: "pytest", status: "failed", exit_code: 1, output: "AssertionError: same failure", duration_ms: 11 }] },
          ],
          repair_rounds: 2,
        }, null, 2),
        "utf-8",
      );

      const captured: string[] = [];
      const captureClient = {
        chat: async (req: any) => {
          for (const m of req.messages ?? []) {
            if (m.role === "user" && typeof m.content === "string") {
              captured.push(m.content);
            }
          }
          return {
            id: "r1", object: "chat.completion", created: Date.now(), model: "deepseek-v4-pro",
            choices: [{ index: 0, message: { role: "assistant" as const, content: "<DONE/>" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
        chatStream: async function* () { yield undefined as any; },
      } as unknown as DeepSeekClient;

      await runRepair({ cwd: tmp, client: captureClient, maxRounds: 1 });

      const allUserContent = captured.join("\n---\n");
      assert.ok(allUserContent.includes("stuck-on-error"));
      assert.ok(allUserContent.includes("CRITICAL: Your last attempt did NOT change the error output."));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---- runHandoff Tests ----

describe("runHandoff", () => {
  it("generates handoff file and returns path", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "verified",
          task: { description: "test task", type: "bugfix", created_at: new Date().toISOString() },
          patches: [{ round: 1, patch: "", apply_status: "ok", files_changed: ["dummy.py"] }],
          verify_results: [{ round: 1, results: [{ command: "echo ok", status: "passed", exit_code: 0, output: "ok", duration_ms: 10 }] }],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );

      const filePath = await runHandoff({ cwd: tmp });
      assert.ok(filePath.includes("handoff"));
      assert.ok(fs.existsSync(filePath));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---- runFullPipeline Tests ----

describe("runFullPipeline", () => {
  it("runs plan, patch, verify, handoff in sequence", async () => {
    const tmp = await setupTempDir();
    try {
      // Plan response aligns with V4_PATCH_DUMMY (both target dummy.py) so the
      // patch fully covers plan.files (spec 2026-05-07-patch-completeness §3.3).
      const planResponse = `
<PLAN>
## Goal
Fix dummy file
## Files Involved
- dummy.py
## Strategy
Append a comment line
</PLAN>
<FILES>
- dummy.py
</FILES>
<RISKS>
- Trivial
</RISKS>
`;
      const client = mockClientSequence([planResponse, "<DONE/>", V4_PATCH_DUMMY, V4_DONE]);
      const state = await runFullPipeline({
        cwd: tmp, client, description: "Fix bug", taskType: "bugfix",
      });
      assert.equal(state.status, "verified");
      const handoffDir = path.join(tmp, ".dsh", "handoff");
      assert.ok(fs.existsSync(handoffDir));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes a handoff path when verification succeeds", async () => {
    const tmp = await setupTempDir();
    try {
      const planResponse = `
<PLAN>
## Goal
Fix dummy file
</PLAN>
<FILES>
- dummy.py
</FILES>
<RISKS>
- Trivial
</RISKS>
`;
      const client = mockClientSequence([planResponse, "<DONE/>", V4_PATCH_DUMMY, V4_DONE]);
      const state = await runFullPipeline({
        cwd: tmp, client, description: "Fix bug", taskType: "bugfix",
      });
      assert.equal(state.status, "verified");
      assert.ok(state.handoff_path, "handoff_path should be returned on final state");
      assert.ok(fs.existsSync(state.handoff_path!));
      const saved = readTaskState(tmp);
      assert.equal(saved?.handoff_path, state.handoff_path);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("still writes a handoff when verification commands are missing", async () => {
    const tmp = await setupTempDir();
    try {
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "python" },
          verify: {},
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      const planResponse = `
<PLAN>
## Goal
Fix dummy file
</PLAN>
<FILES>
- dummy.py
</FILES>
<RISKS>
- Trivial
</RISKS>
`;
      const client = mockClientSequence([planResponse, "<DONE/>", V4_PATCH_DUMMY, V4_DONE]);
      const state = await runFullPipeline({
        cwd: tmp, client, description: "Fix bug", taskType: "bugfix",
      });
      assert.equal(state.status, "patched");
      assert.ok(state.handoff_path, "missing verify commands should not skip handoff");
      assert.ok(fs.existsSync(state.handoff_path!));
      const saved = readTaskState(tmp);
      assert.equal(saved?.handoff_path, state.handoff_path);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
