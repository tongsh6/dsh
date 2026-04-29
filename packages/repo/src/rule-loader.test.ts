import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findRuleFiles, loadRuleFiles } from "./rule-loader.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("findRuleFiles", () => {
  it("finds existing rule files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-test-"));
    fs.writeFileSync(path.join(tmp, "CLAUDE.md"), "# test");
    fs.writeFileSync(path.join(tmp, ".cursorrules"), "rule1");

    const found = findRuleFiles(tmp);
    assert.ok(found.includes("CLAUDE.md"));
    assert.ok(found.includes(".cursorrules"));

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty for directory with no rules", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-test-"));
    const found = findRuleFiles(tmp);
    assert.equal(found.length, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("loadRuleFiles", () => {
  it("loads file contents", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-test-"));
    fs.writeFileSync(path.join(tmp, "CLAUDE.md"), "content here");

    const rules = loadRuleFiles(tmp, ["CLAUDE.md"]);
    assert.equal(rules.length, 1);
    assert.equal(rules[0]!.name, "CLAUDE.md");
    assert.equal(rules[0]!.content, "content here");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("handles missing files gracefully", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-test-"));
    const rules = loadRuleFiles(tmp, ["nonexistent.md"]);
    assert.equal(rules.length, 1);
    assert.ok(rules[0]!.content.includes("could not read"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
