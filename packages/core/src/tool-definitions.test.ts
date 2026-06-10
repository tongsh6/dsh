import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  READ_FILE_DEF,
  GREP_FILES_DEF,
  EXEC_SHELL_DEF,
  APPLY_PATCH_DEF,
  ALL_TOOL_DEFINITIONS,
  EXEC_SHELL_ALLOW_LIST,
  EXEC_SHELL_BLOCK_PATTERNS,
} from "./tool-definitions.js";

describe("tool definitions", () => {
  it("has valid JSON Schema for read_file", () => {
    assert.equal(READ_FILE_DEF.type, "function");
    assert.equal(READ_FILE_DEF.function.name, "read_file");
    assert.ok(READ_FILE_DEF.function.description.length > 10);
    assert.ok(READ_FILE_DEF.function.parameters.properties["path"]);
    assert.ok(READ_FILE_DEF.function.parameters.properties["offset"]);
    assert.ok(READ_FILE_DEF.function.parameters.properties["limit"]);
    assert.deepEqual(READ_FILE_DEF.function.parameters.required, ["path"]);
  });

  it("has valid JSON Schema for grep_files", () => {
    assert.equal(GREP_FILES_DEF.type, "function");
    assert.equal(GREP_FILES_DEF.function.name, "grep_files");
    assert.ok(GREP_FILES_DEF.function.description.length > 10);
    assert.ok(GREP_FILES_DEF.function.parameters.properties["pattern"]);
    assert.ok(GREP_FILES_DEF.function.parameters.properties["include"]);
    assert.deepEqual(GREP_FILES_DEF.function.parameters.required, ["pattern"]);
  });

  it("has valid JSON Schema for exec_shell", () => {
    assert.equal(EXEC_SHELL_DEF.type, "function");
    assert.equal(EXEC_SHELL_DEF.function.name, "exec_shell");
    assert.ok(EXEC_SHELL_DEF.function.description.length > 10);
    assert.ok(EXEC_SHELL_DEF.function.parameters.properties["command"]);
    assert.deepEqual(EXEC_SHELL_DEF.function.parameters.required, ["command"]);
  });

  it("has valid JSON Schema for apply_patch", () => {
    assert.equal(APPLY_PATCH_DEF.type, "function");
    assert.equal(APPLY_PATCH_DEF.function.name, "apply_patch");
    assert.ok(APPLY_PATCH_DEF.function.description.length > 10);
    assert.deepEqual(
      APPLY_PATCH_DEF.function.parameters.properties["protocol_op"]?.enum,
      ["CREATE", "PATCH", "SEARCH_REPLACE", "INSERT", "DELETE", "RENAME"],
    );
    assert.deepEqual(APPLY_PATCH_DEF.function.parameters.required, ["protocol_op"]);
    assert.equal(APPLY_PATCH_DEF.function.parameters.additionalProperties, false);
  });

  it("returns all 4 definitions in ALL_TOOL_DEFINITIONS", () => {
    assert.equal(ALL_TOOL_DEFINITIONS.length, 4);
    const names = ALL_TOOL_DEFINITIONS.map((d) => d.function.name);
    assert.deepEqual(names.sort(), ["apply_patch", "exec_shell", "grep_files", "read_file"]);
  });
});

describe("exec_shell allow list", () => {
  it("contains common test and lint commands", () => {
    assert.ok(EXEC_SHELL_ALLOW_LIST.some((p) => p.startsWith("pnpm")));
    assert.ok(EXEC_SHELL_ALLOW_LIST.some((p) => p.startsWith("npm")));
    assert.ok(EXEC_SHELL_ALLOW_LIST.some((p) => p.startsWith("npx")));
    assert.ok(EXEC_SHELL_ALLOW_LIST.some((p) => p.includes("pytest")));
    assert.ok(EXEC_SHELL_ALLOW_LIST.some((p) => p.startsWith("git")));
  });

  it("contains read-only file inspection commands", () => {
    assert.ok(EXEC_SHELL_ALLOW_LIST.includes("cat "));
    assert.ok(EXEC_SHELL_ALLOW_LIST.includes("head "));
    assert.ok(EXEC_SHELL_ALLOW_LIST.includes("ls "));
    assert.ok(EXEC_SHELL_ALLOW_LIST.includes("grep "));
  });
});

describe("exec_shell block patterns", () => {
  it("blocks destructive commands", () => {
    const patterns = EXEC_SHELL_BLOCK_PATTERNS.map((p) => String(p));
    assert.ok(patterns.some((p) => p.includes("rm")));
    assert.ok(patterns.some((p) => p.includes("sudo")));
    assert.ok(patterns.some((p) => p.includes("curl")));
    assert.ok(patterns.some((p) => p.includes("chmod")));
  });

  it("blocks command chaining and redirection", () => {
    const patterns = EXEC_SHELL_BLOCK_PATTERNS.map((p) => String(p));
    assert.ok(patterns.some((p) => p.includes("&&")));
    assert.ok(patterns.some((p) => p.includes(">")));
    assert.ok(patterns.some((p) => p.includes("|")));
  });

  it("blocks destructive git operations", () => {
    const patterns = EXEC_SHELL_BLOCK_PATTERNS.map((p) => String(p));
    assert.ok(patterns.some((p) => p.includes("push")));
    assert.ok(patterns.some((p) => p.includes("commit")));
    assert.ok(patterns.some((p) => p.includes("rebase")));
  });
});
