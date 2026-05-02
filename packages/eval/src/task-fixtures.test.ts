import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { loadFixture, loadAllFixtures } from "./task-fixtures.js";

describe("loadFixture", () => {
  let tmp: string;
  let fixturePath: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-eval-test-"));
    fixturePath = path.join(tmp, "test-bugfix.yaml");
    fs.writeFileSync(
      fixturePath,
      [
        "id: test-bugfix",
        "description: Fix token refresh bug",
        "category: bugfix",
        "taskPrompt: Fix the token refresh issue in login.ts",
        "expectedFiles:",
        "  - src/auth/login.ts",
        "  - src/auth/token.ts",
        "expectPass: true",
        "verificationCommands:",
        "  - npm test",
        "  - npm run lint",
        "architectureRules:",
        "  - No console.log in production code",
        "maxRepairRounds: 2",
        "expectedProtocolOperations:",
        "  - PATCH",
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("loads a YAML fixture file", () => {
    const fixture = loadFixture(fixturePath);
    assert.equal(fixture.id, "test-bugfix");
    assert.equal(fixture.category, "bugfix");
    assert.equal(fixture.description, "Fix token refresh bug");
    assert.equal(fixture.expectPass, true);
    assert.deepEqual(fixture.expectedFiles, [
      "src/auth/login.ts",
      "src/auth/token.ts",
    ]);
    assert.deepEqual(fixture.verificationCommands, ["npm test", "npm run lint"]);
    assert.deepEqual(fixture.architectureRules, [
      "No console.log in production code",
    ]);
    assert.equal(fixture.maxRepairRounds, 2);
    assert.ok(fixture.filePath.endsWith("test-bugfix.yaml"));
  });

  it("loads a failure_mode fixture", () => {
    const fmPath = path.join(tmp, "overconfidence.yaml");
    fs.writeFileSync(
      fmPath,
      [
        "id: overconfidence",
        "description: Model claims completion without verification",
        "category: failure_mode",
        "taskPrompt: Add input validation to the user form",
        "expectedFiles: []",
        "expectPass: false",
        "verificationCommands: []",
        "architectureRules: []",
        "expectedProtocolOperations:",
        "  - PATCH",
      ].join("\n"),
      "utf-8",
    );

    const fixture = loadFixture(fmPath);
    assert.equal(fixture.id, "overconfidence");
    assert.equal(fixture.category, "failure_mode");
    assert.equal(fixture.expectPass, false);
  });
});

describe("loadAllFixtures", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-eval-fixtures-"));
    fs.writeFileSync(
      path.join(tmp, "task-01.yaml"),
      "id: task-01\ndescription: First task\ncategory: bugfix\ntaskPrompt: Fix bug\nexpectedFiles: []\nexpectPass: true\nverificationCommands: []\narchitectureRules: []\nexpectedProtocolOperations: [PATCH]\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmp, "task-02.yaml"),
      "id: task-02\ndescription: Second task\ncategory: feature\ntaskPrompt: Add feature\nexpectedFiles: []\nexpectPass: true\nverificationCommands: []\narchitectureRules: []\nexpectedProtocolOperations: [CREATE]\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmp, "README.md"),
      "# Not a fixture",
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("loads all YAML files from a directory", () => {
    const fixtures = loadAllFixtures(tmp);
    assert.equal(fixtures.length, 2);
    const ids = fixtures.map((f) => f.id).sort();
    assert.deepEqual(ids, ["task-01", "task-02"]);
    assert.ok(fixtures.every((f) => f.filePath.startsWith(tmp)));
  });

  it("returns empty array for non-existent directory", () => {
    const fixtures = loadAllFixtures(path.join(tmp, "nonexistent"));
    assert.deepEqual(fixtures, []);
  });
});

describe("real fixture validation", () => {
  it("all real fixtures pass schema validation", () => {
    const fixturesDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "fixtures",
    );
    const fixtures = loadAllFixtures(fixturesDir);
    assert.ok(fixtures.length > 0, "should load at least one fixture");
  });
});
