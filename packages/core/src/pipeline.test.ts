import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "js-yaml";
import { runPlan, runPatch, runVerify, runRepair, runHandoff, runFullPipeline } from "./pipeline.js";
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

  it("throws when response has no PLAN block", async () => {
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
        /需要 planned 或 repairing/,
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

    // Update task plan to reference the source file
    const taskState = JSON.parse(fs.readFileSync(path.join(tmp, ".dsh", "task-state.json"), "utf-8"));
    taskState.plan.files = ["src/utils.ts"];
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
});

// ---- runVerify Tests ----

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
      // Sequence: plan → patch → done (shared across all phases)
      const client = mockClientSequence([VALID_PLAN_RESPONSE, V4_PATCH_DUMMY, V4_DONE]);
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
});
