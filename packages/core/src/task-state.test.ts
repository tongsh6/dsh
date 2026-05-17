import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createTaskState,
  readTaskState,
  writeTaskState,
  transition,
  canTransition,
  taskStateSchema,
} from "./task-state.js";

describe("canTransition", () => {
  it("allows init -> planned", () => {
    assert.equal(canTransition("init", "planned"), true);
  });

  it("allows planned -> patched", () => {
    assert.equal(canTransition("planned", "patched"), true);
  });

  it("allows patched -> verified", () => {
    assert.equal(canTransition("patched", "verified"), true);
  });

  it("allows patched -> verification_failed", () => {
    assert.equal(canTransition("patched", "verification_failed"), true);
  });

  it("allows verification_failed -> repairing", () => {
    assert.equal(canTransition("verification_failed", "repairing"), true);
  });

  it("allows verification_failed -> repair_exhausted", () => {
    assert.equal(canTransition("verification_failed", "repair_exhausted"), true);
  });

  it("allows repairing -> patched (retry loop)", () => {
    assert.equal(canTransition("repairing", "patched"), true);
  });

  it("rejects invalid transitions", () => {
    assert.equal(canTransition("init", "verified"), false);
    assert.equal(canTransition("done", "planned"), false);
    assert.equal(canTransition("planned", "done"), false);
  });

  it("allows planned -> patch_failed", () => {
    assert.equal(canTransition("planned", "patch_failed"), true);
  });

  it("allows patch_failed -> repairing", () => {
    assert.equal(canTransition("patch_failed", "repairing"), true);
  });

  it("allows patch_failed -> repair_exhausted", () => {
    assert.equal(canTransition("patch_failed", "repair_exhausted"), true);
  });

  it("allows patch_failed -> verification_failed", () => {
    assert.equal(canTransition("patch_failed", "verification_failed"), true);
  });

  it("rejects patch_failed -> done directly", () => {
    assert.equal(canTransition("patch_failed", "done"), false);
  });
});

describe("createTaskState", () => {
  it("creates init state with task fields", () => {
    const state = createTaskState("修复 bug", "bugfix");
    assert.equal(state.version, "0.1");
    assert.equal(state.status, "init");
    assert.equal(state.task.description, "修复 bug");
    assert.equal(state.task.type, "bugfix");
    assert.ok(state.task.created_at.endsWith("Z"));
    assert.deepEqual(state.patches, []);
    assert.equal(state.repair_rounds, 0);
  });
});

describe("transition", () => {
  it("transitions to valid status", () => {
    const state = createTaskState("test", "feature");
    const next = transition(state, "planned");
    assert.equal(next.status, "planned");
    assert.equal(next.task.description, "test"); // other fields preserved
  });

  it("throws on invalid transition", () => {
    const state = createTaskState("test", "feature");
    assert.throws(() => transition(state, "verified"), /Invalid state transition/);
  });
});

describe("writeTaskState / readTaskState", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-core-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes and reads back task state", () => {
    const state = createTaskState("修复登录", "bugfix");
    const planned = transition(state, "planned");
    writeTaskState(tmp, planned);

    const read = readTaskState(tmp);
    assert.ok(read !== null);
    assert.equal(read!.status, "planned");
    assert.equal(read!.task.description, "修复登录");
  });

  it("writes evidence sidecar files from task state", () => {
    const state = createTaskState("fix parser", "bugfix", "parser test passes");
    const planned = transition(state, "planned");
    planned.plan = {
      summary: "fix parser",
      files: ["src/parser.ts"],
      risks: ["parser edge cases"],
      raw_xml: "<PLAN>fix parser</PLAN>",
      verify_commands: ["pnpm test"],
    };
    planned.patches.push({
      round: 1,
      patch: "<PATCH>...</PATCH>",
      apply_status: "ok",
      files_changed: ["src/parser.ts"],
    });
    planned.patch_rounds.push({
      round: 1,
      action: "tools",
      tool_calls: [{
        name: "read_file",
        arguments: { path: "src/parser.ts" },
        status: "success",
        summary: "read parser",
      }],
      duration_ms: 10,
    });
    planned.verify_results.push({
      round: 1,
      results: [{
        command: "pnpm test",
        status: "failed",
        exit_code: 1,
        output: "expected parser failure",
        duration_ms: 20,
      }],
    });

    writeTaskState(tmp, planned);

    assert.ok(fs.readFileSync(path.join(tmp, ".dsh", "current-goal.md"), "utf-8").includes("fix parser"));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, ".dsh", "changed-files.json"), "utf-8")), ["src/parser.ts"]);
    assert.ok(fs.readFileSync(path.join(tmp, ".dsh", "tool-calls.jsonl"), "utf-8").includes("read_file"));
    assert.ok(fs.readFileSync(path.join(tmp, ".dsh", "failure-evidence.md"), "utf-8").includes("expected parser failure"));
    assert.ok(fs.readFileSync(path.join(tmp, ".dsh", "handoff.md"), "utf-8").includes("parser edge cases"));
  });

  it("returns null when no state file", () => {
    const read = readTaskState(tmp);
    assert.equal(read, null);
  });
});

describe("taskStateSchema", () => {
  it("parses valid state", () => {
    const valid = {
      version: "0.1",
      status: "init",
      task: {
        description: "test",
        type: "bugfix",
        created_at: "2026-01-01T00:00:00Z",
      },
      patches: [],
      verify_results: [],
      repair_rounds: 0,
    };
    const parsed = taskStateSchema.parse(valid);
    assert.equal(parsed.status, "init");
  });

  it("parses old JSON without patch_rounds (backward compat)", () => {
    const oldState = {
      version: "0.1",
      status: "patched",
      task: {
        description: "test",
        type: "bugfix",
        created_at: "2026-01-01T00:00:00Z",
      },
      patches: [{
        round: 1,
        patch: "--- a/foo.ts\n+++ b/foo.ts\n@@ -1,3 +1,3 @@\n-x\n+y",
        apply_status: "ok",
        files_changed: ["foo.ts"],
      }],
      tool_rounds: [],
      verify_results: [],
      repair_rounds: 0,
    };
    const parsed = taskStateSchema.parse(oldState);
    assert.equal(parsed.status, "patched");
    assert.deepEqual(parsed.patch_rounds, []);
    assert.equal(parsed.patches.length, 1);
  });

  it("parses new JSON with patch_rounds", () => {
    const newState = {
      version: "0.1",
      status: "patched",
      task: {
        description: "test",
        type: "feature",
        created_at: "2026-01-01T00:00:00Z",
      },
      patches: [],
      patch_rounds: [
        {
          round: 1,
          action: "tools",
          tool_calls: [{
            name: "read_file",
            arguments: { file: "src/foo.ts", limit: 5, nested: { raw: true } },
            status: "success",
            summary: "read src/foo.ts",
          }],
          duration_ms: 500,
        },
        {
          round: 2,
          action: "change",
          change: {
            op: "PATCH",
            file: "src/foo.ts",
            apply_status: "ok",
            raw_block: "<PATCH>...</PATCH>",
          },
          reasoning_excerpt: "修改 foo.ts",
          duration_ms: 300,
        },
        {
          round: 3,
          action: "done",
          duration_ms: 100,
        },
      ],
      tool_rounds: [],
      verify_results: [],
      repair_rounds: 0,
    };
    const parsed = taskStateSchema.parse(newState);
    assert.equal(parsed.patch_rounds.length, 3);
    assert.equal(parsed.patch_rounds[0].action, "tools");
    assert.equal(parsed.patch_rounds[1].action, "change");
    assert.equal(parsed.patch_rounds[1].change!.op, "PATCH");
    assert.equal(parsed.patch_rounds[1].change!.apply_status, "ok");
    assert.equal(parsed.patch_rounds[2].action, "done");
  });

  it("accepts partial_ok apply_status on PatchRecord", () => {
    const state = {
      version: "0.1",
      status: "patched",
      task: {
        description: "test",
        type: "bugfix",
        created_at: "2026-01-01T00:00:00Z",
      },
      patches: [{
        round: 1,
        patch: "--- a/foo.ts\n+++ b/foo.ts\n@@ -1,3 +1,3 @@\n-x\n+y",
        apply_status: "partial_ok",
        files_changed: ["foo.ts", "bar.ts"],
      }],
      tool_rounds: [],
      verify_results: [],
      repair_rounds: 0,
    };
    const parsed = taskStateSchema.parse(state);
    assert.equal(parsed.patches[0].apply_status, "partial_ok");
  });

  it("accepts patch_failed status", () => {
    const state = {
      version: "0.1",
      status: "patch_failed",
      task: {
        description: "test",
        type: "bugfix",
        created_at: "2026-01-01T00:00:00Z",
      },
      patches: [],
      tool_rounds: [],
      verify_results: [],
      repair_rounds: 0,
    };
    const parsed = taskStateSchema.parse(state);
    assert.equal(parsed.status, "patch_failed");
  });

  it("rejects invalid status", () => {
    const invalid = {
      version: "0.1",
      status: "BOGUS",
      task: {
        description: "test",
        type: "bugfix",
        created_at: "2026-01-01T00:00:00Z",
      },
      patches: [],
      verify_results: [],
      repair_rounds: 0,
    };
    assert.throws(() => taskStateSchema.parse(invalid));
  });
});
