import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initCommand } from "./init.js";

describe("initCommand", () => {
  let tmp: string;
  let originalCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cli-init-"));
    // Create a minimal package.json for detection
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({
        name: "test-pkg",
        type: "module",
        scripts: { test: "jest", lint: "eslint src/", typecheck: "tsc --noEmit" },
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
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates .dsh/config.yml and .dsh/task-state.json", async () => {
    await initCommand({ force: false });

    const configPath = path.join(tmp, ".dsh", "config.yml");
    const statePath = path.join(tmp, ".dsh", "task-state.json");

    assert.ok(fs.existsSync(configPath));
    assert.ok(fs.existsSync(statePath));

    const configRaw = fs.readFileSync(configPath, "utf-8");
    assert.ok(configRaw.includes("language: typescript"));
    assert.ok(configRaw.includes("package_manager: pnpm"));
    assert.ok(configRaw.includes("test: jest"));

    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    assert.equal(state.version, "0.1");
    assert.equal(state.status, "init");
  });

  it("skips when already initialized", async () => {
    fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".dsh", "config.yml"), "existing: true", "utf-8");

    // Capture output
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    await initCommand({ force: false });

    console.log = origLog;
    assert.ok(logs.some((l) => l.includes("已初始化")));
  });

  it("overwrites with --force", async () => {
    fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".dsh", "config.yml"), "old: true", "utf-8");

    await initCommand({ force: true });

    const configRaw = fs.readFileSync(path.join(tmp, ".dsh", "config.yml"), "utf-8");
    assert.ok(!configRaw.includes("old: true"));
    assert.ok(configRaw.includes("language: typescript"));
  });
});
