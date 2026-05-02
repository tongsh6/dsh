import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DeepSeekClient } from "@dsh/provider";

describe("planCommand", () => {
  let tmp: string;
  let originalCwd: string;

  const MOCK_RESPONSE = {
    id: "test-plan-1",
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
          "Fix the token refresh bug in login flow",
          "## Files Involved",
          "- src/auth/login.ts",
          "- src/auth/token.ts",
          "## Strategy",
          "Add refreshIfExpired check before API calls",
          "</PLAN>",
          "<FILES>",
          "- src/auth/login.ts",
          "- src/auth/token.ts",
          "</FILES>",
          "<RISKS>",
          "- Token race condition",
          "- Expiry window too narrow",
          "</RISKS>",
        ].join("\n"),
        reasoning_content: "Let me analyze the codebase...",
      },
      finish_reason: "stop" as const,
    }],
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cli-plan-"));
    fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({
        name: "test-pkg",
        scripts: { test: "jest" },
        devDependencies: { typescript: "^5.0" },
      }),
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

  function setupMockClient(response: any = MOCK_RESPONSE) {
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    mock.method(DeepSeekClient.prototype, "chat", async () => response);
  }

  it("handles missing API key gracefully", async () => {
    delete process.env["DEEPSEEK_API_KEY"];

    const { planCommand } = await import("./plan.js");

    const origExit = process.exit;
    process.exit = ((_code?: number) => { throw new Error("exit"); }) as any;

    try { await planCommand("test task", {}); } catch {}
    process.exit = origExit;
  });

  it("generates a plan and transitions state to planned", async () => {
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    setupMockClient();

    fs.writeFileSync(path.join(tmp, ".dsh", "config.yml"), [
      "project:",
      "  name: test-pkg",
      "  language: typescript",
      "verify:",
      "  test: npm test",
      "deepseek:",
      "  default_model: deepseek-v4-pro",
    ].join("\n"), "utf-8");

    fs.writeFileSync(path.join(tmp, ".dsh", "task-state.json"), JSON.stringify({
      version: "0.1",
      status: "init",
      task: { description: "修复 token 刷新 bug", type: "bugfix", created_at: new Date().toISOString() },
      patches: [],
      verify_results: [],
      repair_rounds: 0,
    }), "utf-8");

    const { planCommand } = await import("./plan.js");
    await planCommand("修复 token 刷新 bug", { type: "bugfix" });

    const state = JSON.parse(fs.readFileSync(path.join(tmp, ".dsh", "task-state.json"), "utf-8"));
    assert.equal(state.status, "planned");
    assert.ok(state.plan);
    assert.equal(state.plan.files.length, 2);
    assert.ok(state.plan.files.includes("src/auth/login.ts"));
    assert.ok(state.plan.files.includes("src/auth/token.ts"));
    assert.equal(state.plan.risks.length, 2);
  });

  it("rejects when response has no PLAN block", async () => {
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    setupMockClient({
      ...MOCK_RESPONSE,
      choices: [{
        ...MOCK_RESPONSE.choices[0],
        message: { role: "assistant", content: "No plan here" },
      }],
    });

    fs.writeFileSync(path.join(tmp, ".dsh", "config.yml"), [
      "project:", "  name: test-pkg", "  language: typescript",
      "deepseek:", "  default_model: deepseek-v4-pro",
    ].join("\n"), "utf-8");

    fs.writeFileSync(path.join(tmp, ".dsh", "task-state.json"), JSON.stringify({
      version: "0.1",
      status: "init",
      task: { description: "test", type: "feature", created_at: new Date().toISOString() },
      patches: [],
      verify_results: [],
      repair_rounds: 0,
    }), "utf-8");

    const origExit = process.exit;
    let exitCode = 0;
    process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error("exit"); }) as any;

    const { planCommand } = await import("./plan.js?t=" + Date.now());
    try { await planCommand("test", {}); } catch {}

    process.exit = origExit;
    assert.equal(exitCode, 1);
  });
});
