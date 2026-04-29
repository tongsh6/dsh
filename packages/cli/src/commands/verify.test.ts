import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { verifyCommand } from "./verify.js";

describe("verifyCommand", () => {
  let tmp: string;
  let originalCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cli-verify-"));
    fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
    originalCwd = process.cwd();
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function writeConfig(verify: Record<string, string>) {
    const lines = ["project:", "  name: test", "  language: typescript", "verify:"];
    for (const [k, v] of Object.entries(verify)) {
      lines.push(`  ${k}: ${v}`);
    }
    lines.push("deepseek:", "  default_model: deepseek-v4-pro");
    fs.writeFileSync(path.join(tmp, ".dsh", "config.yml"), lines.join("\n"), "utf-8");
  }

  function writeState(status: string) {
    fs.writeFileSync(path.join(tmp, ".dsh", "task-state.json"), JSON.stringify({
      version: "0.1",
      status,
      task: { description: "test", type: "bugfix", created_at: new Date().toISOString() },
      patches: [],
      verify_results: [],
      repair_rounds: 0,
    }), "utf-8");
  }

  it("rejects non-patched state", async () => {
    writeConfig({ test: "echo ok" });
    writeState("init");

    const origExit = process.exit;
    let exitCode = 0;
    process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error("exit"); }) as any;

    try { await verifyCommand({}); } catch {}

    process.exit = origExit;
    assert.ok(exitCode !== 0);
  });

  it("runs verify and transitions to verified on success", async () => {
    writeConfig({ test: "echo ok" });
    writeState("patched");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    await verifyCommand({});

    console.log = origLog;

    // Check state updated
    const state = JSON.parse(fs.readFileSync(path.join(tmp, ".dsh", "task-state.json"), "utf-8"));
    assert.equal(state.status, "verified");
    assert.equal(state.verify_results.length, 1);
    assert.ok(state.verify_results[0].results[0].status === "passed");
  });

  it("transitions to verification_failed on failure", async () => {
    writeConfig({ test: "exit 1" });
    writeState("patched");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    await verifyCommand({});

    console.log = origLog;

    const state = JSON.parse(fs.readFileSync(path.join(tmp, ".dsh", "task-state.json"), "utf-8"));
    assert.equal(state.status, "verification_failed");
  });

  it("rejects when no verify commands configured", async () => {
    writeConfig({});
    writeState("patched");

    const origExit = process.exit;
    let exitCode = 0;
    process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error("exit"); }) as any;

    try { await verifyCommand({}); } catch {}

    process.exit = origExit;
    assert.ok(exitCode !== 0);
  });

  it("runs only selected commands with flags", async () => {
    writeConfig({ test: "echo test-ok", lint: "echo lint-ok" });
    writeState("patched");

    await verifyCommand({ test: true });

    const state = JSON.parse(fs.readFileSync(path.join(tmp, ".dsh", "task-state.json"), "utf-8"));
    // Only test command should have run
    const commands = state.verify_results[0].results.map((r: any) => r.command);
    assert.ok(commands.some((c: string) => c.includes("echo test-ok")));
    assert.ok(!commands.some((c: string) => c.includes("echo lint-ok")));
  });
});
