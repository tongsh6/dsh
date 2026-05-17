import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { DeepSeekClient } from "@dsh/provider";
import type { TaskState } from "@dsh/core";
import { formatRunSummary, runCommand } from "./run.js";

function baseState(status: TaskState["status"]): TaskState {
  return {
    version: "0.1",
    status,
    task: { description: "test task", type: "feature", created_at: "2026-05-14T00:00:00Z" },
    plan: {
      summary: "test",
      files: ["src/a.ts"],
      risks: [],
      raw_xml: "<PLAN>test</PLAN>",
      verify_commands: ["node --test"],
    },
    patches: [{
      round: 1,
      patch: "<PATCH>...</PATCH>",
      apply_status: status === "patch_failed" ? "failed" : "ok",
      files_changed: status === "patch_failed" ? [] : ["src/a.ts"],
    }],
    verify_results: status === "verified"
      ? [{ round: 1, results: [{ command: "node --test", status: "passed", exit_code: 0, output: "ok", duration_ms: 10 }] }]
      : [],
    repair_rounds: status === "repair_exhausted" ? 5 : 0,
    handoff_path: ".dsh/handoff/test.md",
    preflight_results: [],
    patch_rounds: [],
    tool_rounds: [],
    static_scan_runs: [],
    static_repair_results: [],
    deepseek_usage: [],
    managed_files: [],
  };
}

describe("runCommand", () => {
  let tmp: string;
  let originalCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cli-run-"));
    originalCwd = process.cwd();
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("formats verified status summary", () => {
    const lines = formatRunSummary(baseState("verified"));
    assert.ok(lines.includes("Status: verified"));
    assert.ok(lines.includes("Changed files: src/a.ts"));
    assert.ok(lines.includes("Verify summary: 1/1 passed"));
    assert.ok(lines.includes("Repair rounds: 0"));
    assert.ok(lines.includes("Handoff path: .dsh/handoff/test.md"));
  });

  it("formats repair_exhausted status summary", () => {
    const lines = formatRunSummary(baseState("repair_exhausted"));
    assert.ok(lines.includes("Status: repair_exhausted"));
    assert.ok(lines.includes("Repair rounds: 5"));
    assert.ok(lines.includes("Next action: manual intervention"));
  });

  it("formats patch_failed status summary", () => {
    const lines = formatRunSummary(baseState("patch_failed"));
    assert.ok(lines.includes("Status: patch_failed"));
    assert.ok(lines.includes("Changed files: (none)"));
    assert.ok(lines.includes("Next action: inspect patch failure"));
  });

  it("passes options through to runFullPipeline", async () => {
    const calls: unknown[] = [];
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await runCommand("do work", { type: "bugfix", dryRun: true, maxRepairRounds: "7" }, {
        createClient: () => ({}) as DeepSeekClient,
        runFullPipeline: async (params) => {
          calls.push(params);
          return baseState("verified");
        },
      });
    } finally {
      console.log = origLog;
    }

    assert.equal(calls.length, 1);
    const call = calls[0] as { description: string; taskType: string; dryRun: boolean; maxRepairRounds: number };
    assert.equal(call.description, "do work");
    assert.equal(call.taskType, "bugfix");
    assert.equal(call.dryRun, true);
    assert.equal(call.maxRepairRounds, 7);
    assert.ok(logs.some((l) => l === "Status: verified"));
  });

  it("registers dsh run in main CLI", () => {
    const main = fs.readFileSync(new URL("../main.ts", import.meta.url), "utf-8");
    assert.ok(main.includes("commands/run.js"));
    assert.ok(main.includes("command(\"run <description>\""));
  });
});
