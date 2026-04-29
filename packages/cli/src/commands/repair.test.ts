import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DeepSeekClient } from "@dsh/provider";

describe("repairCommand", () => {
  let tmp: string;
  let originalCwd: string;

  const MOCK_REPAIR_RESPONSE = {
    id: "test-repair-1",
    object: "chat.completion",
    created: Date.now(),
    model: "deepseek-v4-pro",
    choices: [{
      index: 0,
      message: {
        role: "assistant" as const,
        content: [
          "<PLAN>",
          "## Goal",
          "Fix the failing test by correcting the implementation",
          "</PLAN>",
          "<FILES>",
          "- src/auth/token.ts",
          "</FILES>",
          "<PATCH>",
          "--- a/src/auth/token.ts",
          "+++ b/src/auth/token.ts",
          "@@ -1,4 +1,1 @@",
          " // token utilities",
          "-",
          "-export function broken() {}",
          "-",
          "</PATCH>",
          "<VERIFY>",
          "echo 'all pass'",
          "</VERIFY>",
          "<RISKS>",
          "- Removing function may break callers",
          "</RISKS>",
        ].join("\n"),
      },
      finish_reason: "stop" as const,
    }],
    usage: { prompt_tokens: 200, completion_tokens: 150, total_tokens: 350 },
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cli-repair-"));
    fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "src", "auth"), { recursive: true });
    originalCwd = process.cwd();
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    mock.restoreAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function setupMockClient(response: any = MOCK_REPAIR_RESPONSE) {
    mock.method(DeepSeekClient, "fromEnv", () => {
      const client = new DeepSeekClient({ apiKey: "test-key" });
      mock.method(client, "chat", async () => response);
      return client;
    });
  }

  it("rejects when status is not verification_failed", async () => {
    process.env["DEEPSEEK_API_KEY"] = "test-key";

    fs.writeFileSync(path.join(tmp, ".dsh", "task-state.json"), JSON.stringify({
      version: "0.1",
      status: "planned",
      task: { description: "fix bug", type: "bugfix", created_at: new Date().toISOString() },
      patches: [],
      verify_results: [],
      repair_rounds: 0,
    }), "utf-8");

    const origExit = process.exit;
    let exitCode = 0;
    process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error("exit"); }) as any;

    const { repairCommand } = await import("./repair.js");
    try { await repairCommand({ rounds: 3 }); } catch {}

    process.exit = origExit;
    assert.equal(exitCode, 1);
  });

  it("runs repair loop and transitions to verified on success", async () => {
    process.env["DEEPSEEK_API_KEY"] = "test-key";

    // Create target file with the content the patch expects to fix
    fs.writeFileSync(
      path.join(tmp, "src/auth/token.ts"),
      [
        "// token utilities",
        "",
        "export function broken() {}",
        "",
      ].join("\n"),
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-pkg", scripts: { test: "echo ok" }, devDependencies: { typescript: "^5.0" } }),
      "utf-8",
    );
    fs.writeFileSync(path.join(tmp, "tsconfig.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "", "utf-8");

    fs.writeFileSync(path.join(tmp, ".dsh", "config.yml"), [
      "project:", "  name: test-pkg", "  language: typescript",
      "verify:", "  test: echo 'all pass'",
      "deepseek:", "  default_model: deepseek-v4-pro", "  max_repair_rounds: 3",
    ].join("\n"), "utf-8");

    fs.writeFileSync(path.join(tmp, ".dsh", "task-state.json"), JSON.stringify({
      version: "0.1",
      status: "verification_failed",
      task: { description: "fix token refresh", type: "bugfix", created_at: new Date().toISOString() },
      plan: {
        summary: "Add refreshIfExpired",
        files: ["src/auth/token.ts"],
        risks: ["race condition"],
        raw_xml: "<PLAN>test</PLAN>",
        verify_commands: ["echo 'all pass'"],
      },
      patches: [{
        round: 1,
        patch: "--- a/src/auth/token.ts\n+++ b/src/auth/token.ts\n@@ -1,1 +1,4 @@\n+export function broken() {}",
        apply_status: "ok",
        files_changed: ["src/auth/token.ts"],
      }],
      verify_results: [{
        round: 1,
        results: [{ command: "npm test", status: "failed", exit_code: 1, output: "Tests failed", duration_ms: 100 }],
      }],
      repair_rounds: 1,
    }), "utf-8");

    setupMockClient();

    const { repairCommand } = await import("./repair.js");
    await repairCommand({ rounds: 3 });

    const state = JSON.parse(fs.readFileSync(path.join(tmp, ".dsh", "task-state.json"), "utf-8"));
    assert.equal(state.status, "verified");
  });
});
