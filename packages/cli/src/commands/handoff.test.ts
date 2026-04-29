import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { handoffCommand } from "./handoff.js";

describe("handoffCommand", () => {
  let tmp: string;
  let originalCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cli-handoff-"));
    fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
    originalCwd = process.cwd();
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("generates markdown handoff from verified state", async () => {
    fs.writeFileSync(path.join(tmp, ".dsh", "task-state.json"), JSON.stringify({
      version: "0.1",
      status: "verified",
      task: { description: "修复登录 token 刷新 bug", type: "bugfix", created_at: "2026-04-29T10:00:00Z" },
      plan: {
        summary: "在 token.ts 新增 refreshIfExpired()",
        files: ["src/auth/login.ts", "src/auth/token.ts"],
        risks: ["异步竞态", "token 过期窗口"],
        raw_xml: "<PLAN>修复 token 刷新逻辑</PLAN>",
      },
      patches: [{
        round: 1,
        patch: "--- a/src/auth/token.ts\n+++ b/src/auth/token.ts\n@@ -1,3 +1,5 @@\n+function refreshIfExpired() {}",
        apply_status: "ok",
        files_changed: ["src/auth/token.ts", "src/auth/login.ts"],
      }],
      verify_results: [{
        round: 1,
        results: [
          { command: "npm test", status: "passed", exit_code: 0, output: "Tests: 5 passed", duration_ms: 1200 },
        ],
      }],
      repair_rounds: 0,
    }), "utf-8");

    await handoffCommand({ format: "markdown" });

    const handoffDir = path.join(tmp, ".dsh", "handoff");
    const files = fs.readdirSync(handoffDir);
    assert.equal(files.length, 1);
    assert.ok(files[0]!.endsWith(".md"));

    const content = fs.readFileSync(path.join(handoffDir, files[0]!), "utf-8");
    assert.ok(content.includes("修复登录 token 刷新 bug"));
    assert.ok(content.includes("token 刷新逻辑"));
    assert.ok(content.includes("npm test"));
    assert.ok(content.includes("异步竞态"));
  });

  it("generates JSON handoff", async () => {
    fs.writeFileSync(path.join(tmp, ".dsh", "task-state.json"), JSON.stringify({
      version: "0.1",
      status: "done",
      task: { description: "添加日志", type: "feature", created_at: "2026-04-29T10:00:00Z" },
      patches: [],
      verify_results: [],
      repair_rounds: 0,
    }), "utf-8");

    await handoffCommand({ format: "json" });

    const handoffDir = path.join(tmp, ".dsh", "handoff");
    const files = fs.readdirSync(handoffDir);
    assert.equal(files.length, 1);
    assert.ok(files[0]!.endsWith(".json"));

    const content = JSON.parse(fs.readFileSync(path.join(handoffDir, files[0]!), "utf-8"));
    assert.equal(content.task.description, "添加日志");
  });

  it("warns on non-terminal state but still generates", async () => {
    fs.writeFileSync(path.join(tmp, ".dsh", "task-state.json"), JSON.stringify({
      version: "0.1",
      status: "planned",
      task: { description: "incomplete", type: "feature", created_at: "2026-04-29T10:00:00Z" },
      patches: [],
      verify_results: [],
      repair_rounds: 0,
    }), "utf-8");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    await handoffCommand({});

    console.log = origLog;
    assert.ok(logs.some((l) => l.includes("警告")));
  });
});
