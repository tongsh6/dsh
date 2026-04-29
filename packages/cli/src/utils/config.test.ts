import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { readConfig } from "../utils/config.js";

describe("readConfig", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cli-config-"));
    fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("parses valid config.yml with js-yaml", () => {
    fs.writeFileSync(path.join(tmp, ".dsh", "config.yml"), [
      "project:",
      "  name: test-project",
      "  language: typescript",
      "  package_manager: pnpm",
      "verify:",
      "  test: npm test",
      "  lint: npm run lint",
      "deepseek:",
      "  default_model: deepseek-v4-pro",
      "  max_repair_rounds: 3",
    ].join("\n"), "utf-8");

    const config = readConfig(tmp);
    const project = config["project"] as Record<string, unknown>;
    const verify = config["verify"] as Record<string, unknown>;
    const ds = config["deepseek"] as Record<string, unknown>;
    assert.equal(project["name"], "test-project");
    assert.equal(project["language"], "typescript");
    assert.equal(project["package_manager"], "pnpm");
    assert.equal(verify["test"], "npm test");
    assert.equal(verify["lint"], "npm run lint");
    assert.equal(ds["default_model"], "deepseek-v4-pro");
    assert.equal(ds["max_repair_rounds"], 3);
  });

  it("returns empty object when config file missing", () => {
    assert.deepEqual(readConfig(tmp), {});
  });

  it("returns empty object for empty YAML", () => {
    fs.writeFileSync(path.join(tmp, ".dsh", "config.yml"), "", "utf-8");
    assert.deepEqual(readConfig(tmp), {});
  });
});
