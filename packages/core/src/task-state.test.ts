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
import type { TaskStatus } from "./task-state.js";

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

  it("allows repairing -> patched (retry loop)", () => {
    assert.equal(canTransition("repairing", "patched"), true);
  });

  it("rejects invalid transitions", () => {
    assert.equal(canTransition("init", "verified"), false);
    assert.equal(canTransition("done", "planned"), false);
    assert.equal(canTransition("planned", "done"), false);
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
