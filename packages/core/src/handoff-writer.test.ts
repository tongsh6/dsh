import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { writeHandoff } from "./handoff-writer.js";
import { createTaskState, transition } from "./task-state.js";

describe("writeHandoff", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-core-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes markdown handoff file", () => {
    let state = createTaskState("修复 token 过期 bug", "bugfix");
    state = { ...state, plan: { summary: "Add refreshIfExpired", files: ["src/auth/token.ts"], risks: ["async issue"], raw_xml: "<PLAN>...</PLAN>" } };
    state = transition(state, "planned");
    state = transition(state, "patched");
    state.verify_results = [{ round: 1, results: [{ command: "npx jest", status: "passed", exit_code: 0, output: "14 passed", duration_ms: 2000 }] }];
    state = transition(state, "verified");

    const filePath = writeHandoff(state, tmp);
    assert.ok(fs.existsSync(filePath));
    const content = fs.readFileSync(filePath, "utf-8");
    assert.ok(content.includes("修复 token 过期 bug"));
    assert.ok(content.includes("✓ 完成"));
    assert.ok(content.includes("npx jest"));
  });

  it("writes JSON handoff file", () => {
    let state = createTaskState("test", "feature");
    state = transition(state, "planned");

    const filePath = writeHandoff(state, tmp, "json");
    assert.ok(fs.existsSync(filePath));
    const json = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    assert.equal(json.status, "planned");
  });

  it("indicates repair_exhausted status", () => {
    let state = createTaskState("unfixable", "bugfix");
    state = { ...state, repair_rounds: 3 };
    state = { ...state, status: "repair_exhausted" as const };

    const filePath = writeHandoff(state, tmp);
    const content = fs.readFileSync(filePath, "utf-8");
    assert.ok(content.includes("修复未完成"));
  });
});
