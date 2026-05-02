import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DeepSeekClient } from "@dsh/provider";

describe("patchCommand", () => {
  let tmp: string;
  let originalCwd: string;

  const MOCK_PATCH_RESPONSE = {
    id: "test-patch-1",
    object: "chat.completion",
    created: Date.now(),
    model: "deepseek-v4-flash",
    choices: [{
      index: 0,
      message: {
        role: "assistant" as const,
        content: [
          "<PLAN>",
          "## Goal",
          "Add refreshIfExpired function",
          "</PLAN>",
          "<FILES>",
          "- src/auth/token.ts",
          "</FILES>",
          "<PATCH>",
          "--- a/src/auth/token.ts",
          "+++ b/src/auth/token.ts",
          "@@ -1 +1,4 @@",
          " // token utilities",
          "+export function refreshIfExpired() {",
          "+  return true;",
          "+}",
          "</PATCH>",
          "<VERIFY>",
          "npm test",
          "</VERIFY>",
          "<RISKS>",
          "- Race condition on refresh",
          "</RISKS>",
        ].join("\n"),
      },
      finish_reason: "stop" as const,
    }],
    usage: { prompt_tokens: 80, completion_tokens: 150, total_tokens: 230 },
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cli-patch-"));
    fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "src", "auth"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src/auth/token.ts"), "// token utilities\n", "utf-8");
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "test-pkg", scripts: { test: "jest" }, devDependencies: { typescript: "^5.0" } }),
      "utf-8",
    );
    fs.writeFileSync(path.join(tmp, "tsconfig.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "", "utf-8");
    originalCwd = process.cwd();
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    mock.restoreAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function setupMockClient(response: any = MOCK_PATCH_RESPONSE) {
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    mock.method(DeepSeekClient.prototype, "chat", async () => response);
  }

  function writeConfig() {
    fs.writeFileSync(path.join(tmp, ".dsh", "config.yml"), [
      "project:", "  name: test-pkg", "  language: typescript",
      "verify:", "  test: npm test",
      "deepseek:", "  default_model: deepseek-v4-pro",
    ].join("\n"), "utf-8");
  }

  function writeState(status: string) {
    fs.writeFileSync(path.join(tmp, ".dsh", "task-state.json"), JSON.stringify({
      version: "0.1",
      status,
      task: { description: "fix token refresh", type: "bugfix", created_at: new Date().toISOString() },
      plan: { summary: "Add refreshIfExpired", files: ["src/auth/token.ts"], risks: ["race condition"], raw_xml: "<PLAN>test</PLAN>" },
      patches: [],
      verify_results: [],
      repair_rounds: 0,
    }), "utf-8");
  }

  it("handles missing API key gracefully", async () => {
    delete process.env["DEEPSEEK_API_KEY"];

    writeState("planned");
    // writeConfig with empty api_key → createClient will fail
    fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".dsh", "config.yml"), "deepseek:\n  api_key: ''\n", "utf-8");

    const { patchCommand } = await import("./patch.js");

    const origExit = process.exit;
    process.exit = ((_code?: number) => { throw new Error("exit"); }) as any;

    try { await patchCommand({}); } catch {}
    process.exit = origExit;
  });

  it("rejects when status is not planned or repairing", async () => {
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    writeState("init");
    writeConfig();

    const { patchCommand } = await import("./patch.js");

    const origExit = process.exit;
    let exitCode = 0;
    process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error("exit"); }) as any;

    try { await patchCommand({}); } catch {}

    process.exit = origExit;
    assert.equal(exitCode, 1);
  });

  it("shows diff in dry-run mode without applying", async () => {
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    writeState("planned");
    writeConfig();
    setupMockClient();

    const { patchCommand } = await import("./patch.js");
    await patchCommand({ dryRun: true });

    // State should NOT have changed (dry-run)
    const state = JSON.parse(fs.readFileSync(path.join(tmp, ".dsh", "task-state.json"), "utf-8"));
    assert.equal(state.status, "planned");
    assert.equal(state.patches.length, 0);

    // File should NOT be modified
    const fileContent = fs.readFileSync(path.join(tmp, "src/auth/token.ts"), "utf-8");
    assert.equal(fileContent, "// token utilities\n");
  });

  it("applies patch successfully with --auto", async () => {
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    writeState("planned");
    writeConfig();
    setupMockClient();

    const { patchCommand } = await import("./patch.js");
    await patchCommand({ auto: true });

    const state = JSON.parse(fs.readFileSync(path.join(tmp, ".dsh", "task-state.json"), "utf-8"));
    assert.equal(state.status, "patched");
    assert.equal(state.patches.length, 1);
    assert.equal(state.patches[0].apply_status, "ok");
    assert.ok(state.patches[0].files_changed.length > 0);

    // File should be modified
    const fileContent = fs.readFileSync(path.join(tmp, "src/auth/token.ts"), "utf-8");
    assert.ok(fileContent.includes("refreshIfExpired"));
  });
});
