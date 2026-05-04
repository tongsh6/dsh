import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  findDshRoot,
  loadDshConfig,
  writeDshConfig,
  readApiKey,
  mergeConfig,
} from "./config-loader.js";

describe("findDshRoot", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-findroot-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when no .dsh directory exists", () => {
    assert.equal(findDshRoot(tmp), null);
  });

  it("finds .dsh directory at the given path", () => {
    const dshDir = path.join(tmp, ".dsh");
    fs.mkdirSync(dshDir);
    assert.equal(findDshRoot(tmp), dshDir);
  });

  it("walks up from a subdirectory to find .dsh", () => {
    const dshDir = path.join(tmp, ".dsh");
    fs.mkdirSync(dshDir);
    const subDir = path.join(tmp, "packages", "core", "src");
    fs.mkdirSync(subDir, { recursive: true });
    assert.equal(findDshRoot(subDir), dshDir);
  });
});

describe("mergeConfig", () => {
  it("preserves existing keys not in overrides", () => {
    const existing = { project: { name: "foo", language: "ts" } };
    const overrides = { verify: { test: "npm test" } };
    const result = mergeConfig(existing, overrides);
    assert.deepEqual(result.project, { name: "foo", language: "ts" });
    assert.deepEqual(result.verify, { test: "npm test" });
  });

  it("recursively merges nested objects", () => {
    const existing = { deepseek: { default_model: "pro", api_key: "sk-xxx" } };
    const overrides = { deepseek: { max_repair_rounds: 5 } };
    const result = mergeConfig(existing, overrides);
    assert.equal(result.deepseek?.default_model, "pro");
    assert.equal(result.deepseek?.api_key, "sk-xxx");
    assert.equal(result.deepseek?.max_repair_rounds, 5);
  });

  it("replaces arrays instead of concatenating", () => {
    const existing = { rules: { files: [{ path: "a.md" }] } };
    const overrides = { rules: { files: [{ path: "b.md" }] } };
    const result = mergeConfig(existing, overrides);
    assert.deepEqual(result.rules?.files, [{ path: "b.md" }]);
  });

  it("overrides scalar values", () => {
    const existing = { project: { name: "old" } };
    const overrides = { project: { name: "new" } };
    const result = mergeConfig(existing, overrides);
    assert.equal(result.project?.name, "new");
  });

  it("skips null and undefined values in overrides", () => {
    const existing = { project: { name: "keep" } };
    const overrides = { project: { name: undefined } };
    const result = mergeConfig(existing, overrides);
    assert.equal(result.project?.name, "keep");
  });

  it("handles empty existing config", () => {
    const result = mergeConfig({}, { project: { name: "fresh" } });
    assert.equal(result.project?.name, "fresh");
  });

  it("handles empty overrides", () => {
    const result = mergeConfig({ project: { name: "keep" } }, {});
    assert.equal(result.project?.name, "keep");
  });
});

describe("loadDshConfig", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty object when no config file", () => {
    assert.deepEqual(loadDshConfig(tmp), {});
  });

  it("loads a valid config file", () => {
    const dshDir = path.join(tmp, ".dsh");
    fs.mkdirSync(dshDir, { recursive: true });
    fs.writeFileSync(
      path.join(dshDir, "config.yml"),
      "project:\n  name: test\n  language: typescript\n",
      "utf-8",
    );
    const config = loadDshConfig(tmp);
    assert.equal(config.project?.name, "test");
    assert.equal(config.project?.language, "typescript");
  });
});

describe("writeDshConfig", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-config-write-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes a new config file when none exists", () => {
    writeDshConfig(tmp, { project: { name: "new", language: "ts" } });
    const config = loadDshConfig(tmp);
    assert.equal(config.project?.name, "new");
  });

  it("preserves existing keys when writing overrides", () => {
    writeDshConfig(tmp, { project: { name: "first" }, deepseek: { api_key: "sk-xxx" } });
    writeDshConfig(tmp, { project: { language: "typescript" } });
    const config = loadDshConfig(tmp);
    assert.equal(config.project?.name, "first"); // preserved
    assert.equal(config.project?.language, "typescript"); // added
    assert.equal(config.deepseek?.api_key, "sk-xxx"); // preserved
  });

  it("replaces arrays on second write", () => {
    writeDshConfig(tmp, { rules: { files: [{ path: "a.md" }, { path: "b.md" }] } });
    writeDshConfig(tmp, { rules: { files: [{ path: "c.md" }] } });
    const config = loadDshConfig(tmp);
    assert.deepEqual(config.rules?.files, [{ path: "c.md" }]);
  });
});

describe("readApiKey", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-config-key-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when no config", () => {
    assert.equal(readApiKey(tmp), null);
  });

  it("returns null when api_key is empty", () => {
    writeDshConfig(tmp, { deepseek: { api_key: "" } });
    assert.equal(readApiKey(tmp), null);
  });

  it("returns the key when set", () => {
    writeDshConfig(tmp, { deepseek: { api_key: "sk-test-123" } });
    assert.equal(readApiKey(tmp), "sk-test-123");
  });
});
