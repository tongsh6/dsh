import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import {
  extractPatchBlock,
  extractCreateBlocks,
  extractDeleteBlocks,
  extractRenameBlocks,
  extractSearchReplaceBlocks,
  extractFilesBlock,
  extractVerifyBlock,
  extractPlanBlock,
  extractRisksBlock,
  validateDiff,
  validateCreatePaths,
  detectCreatePatchConflicts,
  parseHunks,
  parsePatch,
  parseChanges,
  applyCreates,
  applyDeletes,
  applyRenames,
  applySearchReplace,
  applyPatch,
  applyChanges,
  PatchParseError,
} from "./patch-parser.js";

const sampleResponse = `<PLAN>
## Goal
Fix token refresh bug

## Files Involved
- src/auth/token.ts
- src/auth/login.ts

## Strategy
Add refreshIfExpired() in token.ts
</PLAN>

<FILES>
- src/auth/token.ts
- src/auth/login.ts
</FILES>

<PATCH>
--- a/src/auth/token.ts
+++ b/src/auth/token.ts
@@ -12,6 +12,10 @@
   return decoded.exp < Date.now() / 1000;
 }

+export function refreshIfExpired(token: string): string {
+  if (isExpired(token)) return refresh(token);
+  return token;
+}

--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -5,7 +5,7 @@
   const user = await db.findUser(username);
-  return signToken(user);
+  return signToken(refreshIfExpired(user.token));
</PATCH>

<VERIFY>
npx jest --no-coverage
npx tsc --noEmit
</VERIFY>

<RISKS>
- refresh() may be async
- token null case not covered
</RISKS>`;

describe("extractPatchBlock", () => {
  it("extracts PATCH block content", () => {
    const content = extractPatchBlock(sampleResponse);
    assert.ok(content !== null);
    assert.ok(content.includes("--- a/src/auth/token.ts"));
  });

  it("returns null when no PATCH block", () => {
    assert.equal(extractPatchBlock("no patch here"), null);
  });
});

describe("extractFilesBlock", () => {
  it("extracts file list", () => {
    const files = extractFilesBlock(sampleResponse);
    assert.deepEqual(files, ["src/auth/token.ts", "src/auth/login.ts"]);
  });
});

describe("extractVerifyBlock", () => {
  it("extracts verify commands", () => {
    const cmds = extractVerifyBlock(sampleResponse);
    assert.deepEqual(cmds, ["npx jest --no-coverage", "npx tsc --noEmit"]);
  });
});

describe("extractPlanBlock", () => {
  it("extracts plan content", () => {
    const plan = extractPlanBlock(sampleResponse);
    assert.ok(plan?.includes("Fix token refresh bug"));
  });
});

describe("extractRisksBlock", () => {
  it("extracts risks", () => {
    const risks = extractRisksBlock(sampleResponse);
    assert.equal(risks.length, 2);
    assert.ok(risks[0]!.includes("async"));
  });
});

describe("validateDiff", () => {
  it("validates a correct unified diff", () => {
    const patch = `--- a/test.ts\n+++ b/test.ts\n@@ -1,3 +1,4 @@\n old\n+new`;
    const result = validateDiff(patch);
    assert.equal(result.valid, true);
  });

  it("rejects empty patch", () => {
    const result = validateDiff("  ");
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it("rejects patch without hunk headers", () => {
    const result = validateDiff("--- a/test.ts\n+++ b/test.ts\njust text");
    assert.equal(result.valid, false);
  });

  it("accepts /dev/null header for new files", () => {
    const result = validateDiff("--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,3 @@\n+line1\n+line2\n+line3");
    assert.equal(result.valid, true);
  });
});

describe("parseHunks", () => {
  it("parses hunk headers", () => {
    const patch = `--- a/test.ts\n+++ b/test.ts\n@@ -12,6 +12,10 @@\n context\n+new`;
    const hunks = parseHunks(patch);
    assert.equal(hunks.length, 1);
    assert.equal(hunks[0]!.file, "test.ts");
    assert.equal(hunks[0]!.oldStart, 12);
    assert.equal(hunks[0]!.oldCount, 6);
    assert.equal(hunks[0]!.newStart, 12);
    assert.equal(hunks[0]!.newCount, 10);
  });
});

describe("parsePatch", () => {
  it("parses a full response into structured patch", () => {
    const result = parsePatch(sampleResponse);
    assert.ok(result.files.includes("src/auth/token.ts"));
    assert.ok(result.patchText.includes("--- a/src/auth/token.ts"));
    assert.ok(result.hunks.length > 0);
  });

  it("throws when no PATCH block", () => {
    assert.throws(
      () => parsePatch("no patch"),
      PatchParseError,
    );
  });
});

describe("applyPatch", () => {
  it("creates new file from /dev/null diff", () => {
    const tmp = fs.mkdtempSync("dsh-patch-test-");
    try {
      const newFilePatch = "--- /dev/null\n+++ b/newfile.py\n@@ -0,0 +1,2 @@\n+#!/usr/bin/env python3\n+# new file";
      const result = applyPatch(tmp, newFilePatch, false);
      assert.equal(result.success, true);
      assert.ok(result.files.includes("newfile.py"));
      const content = fs.readFileSync(`${tmp}/newfile.py`, "utf-8");
      assert.ok(content.includes("#!/usr/bin/env python3"));
      assert.ok(content.includes("# new file"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles multiple new files in one patch", () => {
    const tmp = fs.mkdtempSync("dsh-patch-test-");
    try {
      const multiFile = [
        "--- /dev/null",
        "+++ b/a.py",
        "@@ -0,0 +1,1 @@",
        "+# file a",
        "--- /dev/null",
        "+++ b/sub/b.py",
        "@@ -0,0 +1,1 @@",
        "+# file b",
      ].join("\n");
      const result = applyPatch(tmp, multiFile, false);
      assert.equal(result.success, true);
      assert.equal(result.files.length, 2);
      assert.ok(fs.existsSync(`${tmp}/a.py`));
      assert.ok(fs.existsSync(`${tmp}/sub/b.py`));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---- CREATE block tests ----

const sampleCreateResponse = `<PLAN>
## Goal
Create new utility modules

## Files Involved
- src/utils/helpers.ts
- src/utils/config.ts

## Strategy
Add shared utility modules
</PLAN>

<FILES>
- src/utils/helpers.ts
- src/utils/config.ts
</FILES>

<CREATE path="src/utils/helpers.ts">
export function add(a: number, b: number): number {
  return a + b;
}

export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
</CREATE>

<CREATE path="src/utils/config.ts">
export const API_BASE = "https://api.example.com";
export const TIMEOUT_MS = 5000;
</CREATE>

<VERIFY>
npx jest --no-coverage
</VERIFY>

<RISKS>
- helpers may need error handling
- config values may change per environment
</RISKS>`;

describe("extractCreateBlocks", () => {
  it("extracts single CREATE block", () => {
    const response = `<CREATE path="test/new.ts">\nconsole.log("hello");\n</CREATE>`;
    const blocks = extractCreateBlocks(response);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.path, "test/new.ts");
    assert.ok(blocks[0]!.content.includes('console.log("hello")'));
  });

  it("extracts multiple CREATE blocks", () => {
    const blocks = extractCreateBlocks(sampleCreateResponse);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.path, "src/utils/helpers.ts");
    assert.equal(blocks[1]!.path, "src/utils/config.ts");
    assert.ok(blocks[0]!.content.includes("export function add"));
    assert.ok(blocks[1]!.content.includes("API_BASE"));
  });

  it("returns empty array when no CREATE blocks", () => {
    const blocks = extractCreateBlocks("no create blocks here");
    assert.equal(blocks.length, 0);
  });

  it("preserves raw content including newlines and special characters", () => {
    const response = `<CREATE path="data.json">\n{\n  "key": "value",\n  "num": 42\n}\n</CREATE>`;
    const blocks = extractCreateBlocks(response);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.content.trim(), '{\n  "key": "value",\n  "num": 42\n}');
  });

  it("handles empty content in CREATE block", () => {
    const response = `<CREATE path="empty.ts"></CREATE>`;
    const blocks = extractCreateBlocks(response);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.content, "");
  });
});

describe("extractDeleteBlocks", () => {
  it("extracts single DELETE block", () => {
    const deletePaths = extractDeleteBlocks('<DELETE path="old/file.ts" />');
    assert.deepEqual(deletePaths, ["old/file.ts"]);
  });

  it("extracts multiple DELETE blocks", () => {
    const response = `<DELETE path="a.ts" />\n<DELETE path="b.ts" />`;
    const deletePaths = extractDeleteBlocks(response);
    assert.deepEqual(deletePaths, ["a.ts", "b.ts"]);
  });

  it("returns empty array when no DELETE blocks", () => {
    const deletePaths = extractDeleteBlocks("no delete here");
    assert.equal(deletePaths.length, 0);
  });
});

describe("validateCreatePaths", () => {
  it("accepts valid relative paths", () => {
    const blocks = [{ path: "src/file.ts", content: "content" }];
    const result = validateCreatePaths(blocks);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it("rejects absolute paths", () => {
    const blocks = [{ path: "/absolute/path/file.ts", content: "content" }];
    const result = validateCreatePaths(blocks);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("absolute")));
  });

  it("rejects paths with ..", () => {
    const blocks = [{ path: "../escape/file.ts", content: "content" }];
    const result = validateCreatePaths(blocks);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("..")));
  });

  it("rejects empty path", () => {
    const blocks = [{ path: "", content: "content" }];
    const result = validateCreatePaths(blocks);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("empty")));
  });

  it("rejects empty content", () => {
    const blocks = [{ path: "file.ts", content: "  " }];
    const result = validateCreatePaths(blocks);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("empty")));
  });

  it("validates multiple blocks and reports all errors", () => {
    const blocks = [
      { path: "/bad/absolute.ts", content: "ok" },
      { path: "../traversal.ts", content: "ok" },
    ];
    const result = validateCreatePaths(blocks);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 2);
  });
});

describe("detectCreatePatchConflicts", () => {
  it("detects file targeted by both CREATE and PATCH", () => {
    const creates = [{ path: "src/conflict.ts", content: "new" }];
    const patchFiles = ["src/conflict.ts", "src/other.ts"];
    const conflicts = detectCreatePatchConflicts(creates, patchFiles);
    assert.deepEqual(conflicts, ["src/conflict.ts"]);
  });

  it("returns empty when no conflicts", () => {
    const creates = [{ path: "src/new.ts", content: "new" }];
    const patchFiles = ["src/existing.ts"];
    const conflicts = detectCreatePatchConflicts(creates, patchFiles);
    assert.equal(conflicts.length, 0);
  });

  it("returns empty when creates list is empty", () => {
    const conflicts = detectCreatePatchConflicts([], ["src/file.ts"]);
    assert.equal(conflicts.length, 0);
  });
});

describe("applyCreates", () => {
  it("creates a single file", () => {
    const tmp = fs.mkdtempSync("dsh-create-test-");
    try {
      const blocks = [{ path: "new.ts", content: 'export const x = 1;\n' }];
      const result = applyCreates(tmp, blocks, false);
      assert.equal(result.success, true);
      assert.deepEqual(result.files, ["new.ts"]);
      const content = fs.readFileSync(`${tmp}/new.ts`, "utf-8");
      assert.equal(content, 'export const x = 1;\n');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("creates nested directory structures", () => {
    const tmp = fs.mkdtempSync("dsh-create-test-");
    try {
      const blocks = [{ path: "deep/nested/structure/file.ts", content: "// deep file" }];
      const result = applyCreates(tmp, blocks, false);
      assert.equal(result.success, true);
      assert.ok(fs.existsSync(`${tmp}/deep/nested/structure/file.ts`));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("creates multiple files", () => {
    const tmp = fs.mkdtempSync("dsh-create-test-");
    try {
      const blocks = [
        { path: "a.ts", content: "// a" },
        { path: "b.ts", content: "// b" },
        { path: "sub/c.ts", content: "// c" },
      ];
      const result = applyCreates(tmp, blocks, false);
      assert.equal(result.success, true);
      assert.equal(result.files.length, 3);
      assert.ok(fs.existsSync(`${tmp}/a.ts`));
      assert.ok(fs.existsSync(`${tmp}/b.ts`));
      assert.ok(fs.existsSync(`${tmp}/sub/c.ts`));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("dry-run mode does not write files", () => {
    const tmp = fs.mkdtempSync("dsh-create-test-");
    try {
      const blocks = [{ path: "should-not-exist.ts", content: "test" }];
      const result = applyCreates(tmp, blocks, true);
      assert.equal(result.success, true);
      assert.deepEqual(result.files, ["should-not-exist.ts"]);
      assert.ok(!fs.existsSync(`${tmp}/should-not-exist.ts`));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects unsafe path with ..", () => {
    const tmp = fs.mkdtempSync("dsh-create-test-");
    try {
      const blocks = [{ path: "../escape.ts", content: "evil" }];
      const result = applyCreates(tmp, blocks, false);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Unsafe"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects absolute path", () => {
    const tmp = fs.mkdtempSync("dsh-create-test-");
    try {
      const blocks = [{ path: "/etc/passwd", content: "evil" }];
      const result = applyCreates(tmp, blocks, false);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Unsafe"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("parseChanges", () => {
  it("parses response with both CREATE and PATCH blocks", () => {
    const response = `<PLAN>test</PLAN>
<FILES>- existing.ts</FILES>
<CREATE path="new.ts">export const x = 1;</CREATE>
<PATCH>
--- a/existing.ts
+++ b/existing.ts
@@ -1,1 +1,1 @@
-old
+new
</PATCH>
<VERIFY>npm test</VERIFY>
<RISKS>- risk</RISKS>`;
    const changes = parseChanges(response);
    assert.equal(changes.creates.length, 1);
    assert.equal(changes.creates[0]!.path, "new.ts");
    assert.equal(changes.creates[0]!.content, "export const x = 1;");
    assert.ok(changes.patchText !== null);
    assert.ok(changes.patchText!.includes("--- a/existing.ts"));
    assert.equal(changes.patchFiles.length, 1);
    assert.equal(changes.patchFiles[0], "existing.ts");
    assert.equal(changes.deletePaths.length, 0);
  });

  it("parses response with CREATE only (no PATCH)", () => {
    const response = `<PLAN>create only</PLAN>
<CREATE path="brand-new.ts">console.log("new");</CREATE>
<VERIFY>npm test</VERIFY>
<RISKS>- no risks</RISKS>`;
    const changes = parseChanges(response);
    assert.equal(changes.creates.length, 1);
    assert.equal(changes.patchText, null);
    assert.equal(changes.patchFiles.length, 0);
  });

  it("parses response with PATCH only (no CREATE)", () => {
    const response = `<PLAN>patch only</PLAN>
<FILES>- old.ts</FILES>
<PATCH>
--- a/old.ts
+++ b/old.ts
@@ -1,1 +1,1 @@
-old
+new
</PATCH>
<VERIFY>npm test</VERIFY>
<RISKS>- risk</RISKS>`;
    const changes = parseChanges(response);
    assert.equal(changes.creates.length, 0);
    assert.ok(changes.patchText !== null);
  });

  it("throws when CREATE and PATCH target same file", () => {
    const response = `<CREATE path="same.ts">content</CREATE>
<PATCH>
--- a/same.ts
+++ b/same.ts
@@ -1,1 +1,1 @@
-old
+new
</PATCH>`;
    assert.throws(
      () => parseChanges(response),
      PatchParseError,
    );
  });

  it("throws when PATCH uses /dev/null for new files", () => {
    const response = `<PATCH>
--- /dev/null
+++ b/should-use-create.ts
@@ -0,0 +1,1 @@
+new line
</PATCH>`;
    assert.throws(
      () => parseChanges(response),
      PatchParseError,
    );
  });

  it("throws when no operation blocks found", () => {
    const response = `<PLAN>nothing</PLAN>
<FILES>- a.ts</FILES>
<VERIFY>test</VERIFY>
<RISKS>- none</RISKS>`;
    assert.throws(
      () => parseChanges(response),
      PatchParseError,
    );
  });

  it("throws on invalid CREATE path", () => {
    const response = `<CREATE path="../escape.ts">content</CREATE>`;
    assert.throws(
      () => parseChanges(response),
      PatchParseError,
    );
  });

  it("throws on empty content in CREATE block", () => {
    const response = `<CREATE path="empty.ts">  </CREATE>`;
    assert.throws(
      () => parseChanges(response),
      PatchParseError,
    );
  });

  it("validates PATCH format when present", () => {
    const response = `<PATCH>this is not a valid patch</PATCH>`;
    assert.throws(
      () => parseChanges(response),
      PatchParseError,
    );
  });
});

describe("applyChanges", () => {
  it("applies both CREATE and PATCH blocks", () => {
    const tmp = fs.mkdtempSync("dsh-changes-test-");
    try {
      // First create an existing file to patch
      fs.writeFileSync(`${tmp}/existing.ts`, "old content\n", "utf-8");

      const changes = {
        creates: [{ path: "new.ts", content: "new content\n" }],
        patchText: "--- a/existing.ts\n+++ b/existing.ts\n@@ -1,1 +1,1 @@\n-old content\n+new content\n",
        patchFiles: ["existing.ts"],
        renames: [],
        hunks: [],
        deletePaths: [],
        searchReplaceBlocks: [],
        insertBlocks: [],
      };

      const result = applyChanges(tmp, changes, false);
      assert.equal(result.success, true);
      assert.deepEqual(result.createdFiles, ["new.ts"]);
      assert.deepEqual(result.patchedFiles, ["existing.ts"]);
      assert.ok(fs.existsSync(`${tmp}/new.ts`));
      assert.equal(fs.readFileSync(`${tmp}/existing.ts`, "utf-8"), "new content\n");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("applies CREATE blocks only when no PATCH", () => {
    const tmp = fs.mkdtempSync("dsh-changes-test-");
    try {
      const changes = {
        creates: [{ path: "only-new.ts", content: "hello\n" }],
        patchText: null,
        patchFiles: [],
        renames: [],
        hunks: [],
        deletePaths: [],
        searchReplaceBlocks: [],
        insertBlocks: [],
      };

      const result = applyChanges(tmp, changes, false);
      assert.equal(result.success, true);
      assert.equal(result.createdFiles.length, 1);
      assert.equal(result.patchedFiles.length, 0);
      assert.ok(fs.existsSync(`${tmp}/only-new.ts`));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns error when CREATE fails", () => {
    const tmp = fs.mkdtempSync("dsh-changes-test-");
    try {
      const changes = {
        creates: [{ path: "../escape.ts", content: "evil" }],
        patchText: null,
        patchFiles: [],
        renames: [],
        hunks: [],
        deletePaths: [],
        searchReplaceBlocks: [],
        insertBlocks: [],
      };

      const result = applyChanges(tmp, changes, false);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Unsafe"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns error when PATCH fails", () => {
    const tmp = fs.mkdtempSync("dsh-changes-test-");
    try {
      const changes = {
        creates: [],
        patchText: "--- a/nonexistent.ts\n+++ b/nonexistent.ts\n@@ -1,1 +1,1 @@\n-old\n+new",
        patchFiles: ["nonexistent.ts"],
        renames: [],
        hunks: [],
        deletePaths: [],
        searchReplaceBlocks: [],
        insertBlocks: [],
      };

      const result = applyChanges(tmp, changes, false);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Cannot read"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("dry-run applies neither CREATE nor PATCH", () => {
    const tmp = fs.mkdtempSync("dsh-changes-test-");
    try {
      fs.writeFileSync(`${tmp}/existing.ts`, "old\n", "utf-8");
      const changes = {
        creates: [{ path: "dry-new.ts", content: "new" }],
        patchText: "--- a/existing.ts\n+++ b/existing.ts\n@@ -1,1 +1,1 @@\n-old\n+new",
        patchFiles: ["existing.ts"],
        renames: [],
        hunks: [],
        deletePaths: [],
        searchReplaceBlocks: [],
        insertBlocks: [],
      };

      const result = applyChanges(tmp, changes, true);
      assert.equal(result.success, true);
      assert.ok(!fs.existsSync(`${tmp}/dry-new.ts`));
      assert.equal(fs.readFileSync(`${tmp}/existing.ts`, "utf-8"), "old\n");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---- DELETE block tests ----

describe("applyDeletes", () => {
  it("deletes a single file", () => {
    const tmp = fs.mkdtempSync("dsh-delete-test-");
    try {
      fs.writeFileSync(`${tmp}/remove-me.ts`, "bye", "utf-8");
      assert.ok(fs.existsSync(`${tmp}/remove-me.ts`));

      const result = applyDeletes(tmp, ["remove-me.ts"], false);
      assert.equal(result.success, true);
      assert.deepEqual(result.files, ["remove-me.ts"]);
      assert.ok(!fs.existsSync(`${tmp}/remove-me.ts`));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("deletes multiple files", () => {
    const tmp = fs.mkdtempSync("dsh-delete-test-");
    try {
      fs.writeFileSync(`${tmp}/a.ts`, "a", "utf-8");
      fs.writeFileSync(`${tmp}/b.ts`, "b", "utf-8");
      fs.writeFileSync(`${tmp}/c.ts`, "c", "utf-8");

      const result = applyDeletes(tmp, ["a.ts", "b.ts", "c.ts"], false);
      assert.equal(result.success, true);
      assert.equal(result.files.length, 3);
      assert.ok(!fs.existsSync(`${tmp}/a.ts`));
      assert.ok(!fs.existsSync(`${tmp}/b.ts`));
      assert.ok(!fs.existsSync(`${tmp}/c.ts`));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("silently succeeds for non-existent file", () => {
    const tmp = fs.mkdtempSync("dsh-delete-test-");
    try {
      const result = applyDeletes(tmp, ["does-not-exist.ts"], false);
      assert.equal(result.success, true);
      assert.deepEqual(result.files, ["does-not-exist.ts"]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("dry-run does not delete files", () => {
    const tmp = fs.mkdtempSync("dsh-delete-test-");
    try {
      fs.writeFileSync(`${tmp}/keep-me.ts`, "keep", "utf-8");
      const result = applyDeletes(tmp, ["keep-me.ts"], true);
      assert.equal(result.success, true);
      assert.ok(fs.existsSync(`${tmp}/keep-me.ts`));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects unsafe path with ..", () => {
    const tmp = fs.mkdtempSync("dsh-delete-test-");
    try {
      const result = applyDeletes(tmp, ["../escape.ts"], false);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Unsafe"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects absolute path", () => {
    const tmp = fs.mkdtempSync("dsh-delete-test-");
    try {
      const result = applyDeletes(tmp, ["/etc/hosts"], false);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Unsafe"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("parseChanges with DELETE", () => {
  it("parses response with DELETE blocks", () => {
    const response = `<PLAN>remove deprecated</PLAN>
<DELETE path="tools/deprecated.py" />
<DELETE path="tools/old-helper.ts" />
<VERIFY>npm test</VERIFY>
<RISKS>- old imports may break</RISKS>`;
    const changes = parseChanges(response);
    assert.equal(changes.deletePaths.length, 2);
    assert.ok(changes.deletePaths.includes("tools/deprecated.py"));
    assert.ok(changes.deletePaths.includes("tools/old-helper.ts"));
    assert.equal(changes.creates.length, 0);
    assert.equal(changes.patchText, null);
  });

  it("parses combined CREATE + DELETE + PATCH", () => {
    const response = `<PLAN>refactor</PLAN>
<CREATE path="src/new-module.ts">export const x = 1;</CREATE>
<DELETE path="src/old-module.ts" />
<PATCH>
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,1 +1,1 @@
-import from old
+import from new
</PATCH>
<VERIFY>npm test</VERIFY>
<RISKS>- imports</RISKS>`;
    const changes = parseChanges(response);
    assert.equal(changes.creates.length, 1);
    assert.equal(changes.deletePaths.length, 1);
    assert.ok(changes.patchText !== null);
  });

  it("throws on unsafe DELETE path", () => {
    const response = `<DELETE path="../escape.sh" />`;
    assert.throws(
      () => parseChanges(response),
      PatchParseError,
    );
  });

  it("throws on absolute DELETE path", () => {
    const response = `<DELETE path="/etc/config" />`;
    assert.throws(
      () => parseChanges(response),
      PatchParseError,
    );
  });
});

describe("applyChanges with DELETE", () => {
  it("applies CREATE + PATCH + DELETE together", () => {
    const tmp = fs.mkdtempSync("dsh-changes-test-");
    try {
      fs.writeFileSync(`${tmp}/existing.ts`, "old\n", "utf-8");
      fs.writeFileSync(`${tmp}/remove-me.ts`, "delete me\n", "utf-8");

      const changes = {
        creates: [{ path: "new.ts", content: "brand new\n" }],
        patchText: "--- a/existing.ts\n+++ b/existing.ts\n@@ -1,1 +1,1 @@\n-old\n+updated",
        patchFiles: ["existing.ts"],
        renames: [],
        hunks: [],
        deletePaths: ["remove-me.ts"],
        searchReplaceBlocks: [],
        insertBlocks: [],
      };

      const result = applyChanges(tmp, changes, false);
      assert.equal(result.success, true);
      assert.deepEqual(result.createdFiles, ["new.ts"]);
      assert.deepEqual(result.patchedFiles, ["existing.ts"]);
      assert.deepEqual(result.deletedFiles, ["remove-me.ts"]);
      assert.ok(fs.existsSync(`${tmp}/new.ts`));
      assert.equal(fs.readFileSync(`${tmp}/existing.ts`, "utf-8"), "updated\n");
      assert.ok(!fs.existsSync(`${tmp}/remove-me.ts`));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("DELETE only without CREATE or PATCH", () => {
    const tmp = fs.mkdtempSync("dsh-changes-test-");
    try {
      fs.writeFileSync(`${tmp}/old.ts`, "old\n", "utf-8");

      const changes = {
        creates: [],
        patchText: null,
        patchFiles: [],
        renames: [],
        hunks: [],
        deletePaths: ["old.ts"],
        searchReplaceBlocks: [],
        insertBlocks: [],
      };

      const result = applyChanges(tmp, changes, false);
      assert.equal(result.success, true);
      assert.equal(result.deletedFiles.length, 1);
      assert.ok(!fs.existsSync(`${tmp}/old.ts`));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns error when DELETE fails with unsafe path", () => {
    const tmp = fs.mkdtempSync("dsh-changes-test-");
    try {
      const changes = {
        creates: [],
        patchText: null,
        patchFiles: [],
        renames: [],
        hunks: [],
        deletePaths: ["../escape.sh"],
        searchReplaceBlocks: [],
        insertBlocks: [],
      };

      const result = applyChanges(tmp, changes, false);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Unsafe"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---- RENAME block tests ----

describe("extractRenameBlocks", () => {
  it("extracts single RENAME block", () => {
    const response = `<RENAME from="old/path.ts" to="new/path.ts" />`;
    const blocks = extractRenameBlocks(response);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.from, "old/path.ts");
    assert.equal(blocks[0]!.to, "new/path.ts");
  });

  it("extracts multiple RENAME blocks", () => {
    const response = `<RENAME from="a.ts" to="b.ts" />
<RENAME from="c.ts" to="d.ts" />`;
    const blocks = extractRenameBlocks(response);
    assert.equal(blocks.length, 2);
  });

  it("returns empty when no RENAME blocks", () => {
    const blocks = extractRenameBlocks("no rename here");
    assert.equal(blocks.length, 0);
  });
});

describe("applyRenames", () => {
  it("renames a file", () => {
    const tmp = fs.mkdtempSync("dsh-rename-test-");
    try {
      fs.writeFileSync(`${tmp}/old-name.ts`, "content", "utf-8");
      const result = applyRenames(tmp, [{ from: "old-name.ts", to: "new-name.ts" }], false);
      assert.equal(result.success, true);
      assert.equal(result.files.length, 1);
      assert.ok(!fs.existsSync(`${tmp}/old-name.ts`));
      assert.ok(fs.existsSync(`${tmp}/new-name.ts`));
      assert.equal(fs.readFileSync(`${tmp}/new-name.ts`, "utf-8"), "content");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("renames across directory boundaries", () => {
    const tmp = fs.mkdtempSync("dsh-rename-test-");
    try {
      fs.mkdirSync(`${tmp}/src`, { recursive: true });
      fs.writeFileSync(`${tmp}/src/move-me.ts`, "move", "utf-8");
      const result = applyRenames(tmp, [{ from: "src/move-me.ts", to: "lib/moved.ts" }], false);
      assert.equal(result.success, true);
      assert.ok(!fs.existsSync(`${tmp}/src/move-me.ts`));
      assert.ok(fs.existsSync(`${tmp}/lib/moved.ts`));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails when source does not exist", () => {
    const tmp = fs.mkdtempSync("dsh-rename-test-");
    try {
      const result = applyRenames(tmp, [{ from: "nonexistent.ts", to: "target.ts" }], false);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("does not exist"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("dry-run does not move files", () => {
    const tmp = fs.mkdtempSync("dsh-rename-test-");
    try {
      fs.writeFileSync(`${tmp}/stay.ts`, "stay", "utf-8");
      const result = applyRenames(tmp, [{ from: "stay.ts", to: "moved.ts" }], true);
      assert.equal(result.success, true);
      assert.ok(fs.existsSync(`${tmp}/stay.ts`));
      assert.ok(!fs.existsSync(`${tmp}/moved.ts`));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects unsafe from path", () => {
    const tmp = fs.mkdtempSync("dsh-rename-test-");
    try {
      const result = applyRenames(tmp, [{ from: "../escape.ts", to: "safe.ts" }], false);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Unsafe"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects unsafe to path", () => {
    const tmp = fs.mkdtempSync("dsh-rename-test-");
    try {
      fs.writeFileSync(`${tmp}/safe.ts`, "content", "utf-8");
      const result = applyRenames(tmp, [{ from: "safe.ts", to: "../escape.ts" }], false);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("Unsafe"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("parseChanges with RENAME", () => {
  it("parses RENAME block", () => {
    const response = `<RENAME from="old.ts" to="new.ts" />
<VERIFY>npm test</VERIFY>
<RISKS>- imports may break</RISKS>`;
    const changes = parseChanges(response);
    assert.equal(changes.renames.length, 1);
    assert.equal(changes.renames[0]!.from, "old.ts");
    assert.equal(changes.renames[0]!.to, "new.ts");
  });

  it("throws when RENAME destination conflicts with CREATE", () => {
    const response = `<CREATE path="new.ts">content</CREATE>
<RENAME from="old.ts" to="new.ts" />`;
    assert.throws(
      () => parseChanges(response),
      PatchParseError,
    );
  });

  it("throws when RENAME source conflicts with DELETE", () => {
    const response = `<DELETE path="old.ts" />
<RENAME from="old.ts" to="new.ts" />`;
    assert.throws(
      () => parseChanges(response),
      PatchParseError,
    );
  });

  it("throws on unsafe RENAME path", () => {
    const response = `<RENAME from="../evil.ts" to="safe.ts" />`;
    assert.throws(
      () => parseChanges(response),
      PatchParseError,
    );
  });

  it("parses combined CREATE + RENAME + PATCH + DELETE", () => {
    const response = `<CREATE path="new.ts">content</CREATE>
<RENAME from="old.ts" to="renamed.ts" />
<PATCH>
--- a/mod.ts
+++ b/mod.ts
@@ -1,1 +1,1 @@
-old
+new
</PATCH>
<DELETE path="trash.ts" />
<VERIFY>npm test</VERIFY>`;
    const changes = parseChanges(response);
    assert.equal(changes.creates.length, 1);
    assert.equal(changes.renames.length, 1);
    assert.ok(changes.patchText !== null);
    assert.equal(changes.deletePaths.length, 1);
  });
});

describe("applyChanges with RENAME", () => {
  it("applies RENAME as part of combined changes", () => {
    const tmp = fs.mkdtempSync("dsh-changes-test-");
    try {
      fs.writeFileSync(`${tmp}/to-rename.ts`, "rename me\n", "utf-8");

      const changes = {
        creates: [],
        renames: [{ from: "to-rename.ts", to: "renamed.ts" }],
        patchText: null,
        patchFiles: [],
        hunks: [],
        deletePaths: [],
        searchReplaceBlocks: [],
        insertBlocks: [],
      };

      const result = applyChanges(tmp, changes, false);
      assert.equal(result.success, true);
      assert.equal(result.renamedFiles.length, 1);
      assert.ok(!fs.existsSync(`${tmp}/to-rename.ts`));
      assert.ok(fs.existsSync(`${tmp}/renamed.ts`));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---- Search/Replace block tests ----

const SEARCH_REPLACE_RESPONSE = `
<PLAN>Fix the validate function</PLAN>
<FILES>- src/utils.ts</FILES>
<PATCH type="search" file="src/utils.ts">
<SEARCH>function validate(input: string) {
  if (!input) {
    return false;
  }
  return true;
}</SEARCH>
<REPLACE>function validate(input: string): boolean {
  if (!input || input.trim().length === 0) {
    return false;
  }
  return true;
}</REPLACE>
</PATCH>
<VERIFY>npx jest</VERIFY>
<RISKS>- None</RISKS>
`;

describe("extractSearchReplaceBlocks", () => {
  it("extracts SEARCH/REPLACE blocks from response", () => {
    const blocks = extractSearchReplaceBlocks(SEARCH_REPLACE_RESPONSE);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].filePath, "src/utils.ts");
    assert.ok(blocks[0].search.includes("function validate"));
    assert.ok(blocks[0].replace.includes(": boolean"));
  });

  it("returns empty array when no SEARCH/REPLACE blocks", () => {
    const blocks = extractSearchReplaceBlocks("no search replace here");
    assert.equal(blocks.length, 0);
  });
});

describe("applySearchReplace", () => {
  it("applies search/replace to a file", () => {
    const tmp = fs.mkdtempSync("dsh-sr-test-");
    try {
      fs.mkdirSync(`${tmp}/src`, { recursive: true });
      fs.writeFileSync(
        `${tmp}/src/utils.ts`,
        "function validate(input: string) {\n  if (!input) {\n    return false;\n  }\n  return true;\n}\n",
        "utf-8",
      );

      const blocks = extractSearchReplaceBlocks(SEARCH_REPLACE_RESPONSE);
      const result = applySearchReplace(tmp, blocks, false);

      assert.ok(result.success);
      const modified = fs.readFileSync(`${tmp}/src/utils.ts`, "utf-8");
      assert.ok(modified.includes(": boolean"));
      assert.ok(modified.includes("trim().length === 0"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns error when search not found in file", () => {
    const tmp = fs.mkdtempSync("dsh-sr-test-");
    try {
      fs.mkdirSync(`${tmp}/src`, { recursive: true });
      fs.writeFileSync(`${tmp}/src/utils.ts`, "completely different content\n", "utf-8");
      const blocks = extractSearchReplaceBlocks(SEARCH_REPLACE_RESPONSE);
      const result = applySearchReplace(tmp, blocks, false);
      assert.ok(!result.success);
      assert.ok(result.error?.includes("Search block not found"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("parseChanges with Search/Replace", () => {
  it("parses response with SEARCH/REPLACE block and no PATCH", () => {
    const changes = parseChanges(SEARCH_REPLACE_RESPONSE);
    assert.equal(changes.searchReplaceBlocks.length, 1);
    assert.equal(changes.searchReplaceBlocks[0].filePath, "src/utils.ts");
    assert.ok(changes.searchReplaceBlocks[0].search.includes("function validate"));
    assert.equal(changes.patchText, null);
    assert.equal(changes.creates.length, 0);
  });
});

describe("applyChanges with Search/Replace", () => {
  it("applies SEARCH/REPLACE as part of combined changes", () => {
    const tmp = fs.mkdtempSync("dsh-changes-test-");
    try {
      fs.mkdirSync(`${tmp}/src`, { recursive: true });
      fs.writeFileSync(
        `${tmp}/src/utils.ts`,
        "function validate(input: string) {\n  if (!input) {\n    return false;\n  }\n  return true;\n}\n",
        "utf-8",
      );

      const changes = {
        creates: [],
        renames: [],
        patchText: null,
        patchFiles: [],
        hunks: [],
        deletePaths: [],
        searchReplaceBlocks: extractSearchReplaceBlocks(SEARCH_REPLACE_RESPONSE),
        insertBlocks: [],
      };

      const result = applyChanges(tmp, changes, false);
      assert.equal(result.success, true);
      assert.equal(result.patchedFiles.length, 1);
      assert.ok(result.patchedFiles.includes("src/utils.ts"));
      const modified = fs.readFileSync(`${tmp}/src/utils.ts`, "utf-8");
      assert.ok(modified.includes(": boolean"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("applyChanges safety checks", () => {
  it("rejects CREATE when file already exists", () => {
    const tmp = fs.mkdtempSync("dsh-create-exists-test-");
    try {
      fs.writeFileSync(`${tmp}/existing.ts`, "original content", "utf-8");
      const changes = {
        creates: [{ path: "existing.ts", content: "new content" }],
        renames: [] as any[],
        patchText: null,
        patchFiles: [] as string[],
        hunks: [] as any[],
        deletePaths: [] as string[],
        searchReplaceBlocks: [] as any[],
        insertBlocks: [] as any[],
      };
      const result = applyChanges(tmp, changes as any, false);
      assert.ok(!result.success);
      assert.ok(result.error?.includes("already exists"));
      const content = fs.readFileSync(`${tmp}/existing.ts`, "utf-8");
      assert.equal(content, "original content");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("parseChanges conflict detection", () => {
  it("throws when CREATE and DELETE target same file", () => {
    const response = `<CREATE path="foo.ts">content</CREATE>\n<DELETE path="foo.ts" />`;
    assert.throws(
      () => parseChanges(response),
      /CREATE and DELETE target same file/,
    );
  });

  it("throws when CREATE and SEARCH/REPLACE target same file", () => {
    const response = `<CREATE path="foo.ts">content</CREATE>
<PATCH type="search" file="foo.ts">
<SEARCH>old</SEARCH>
<REPLACE>new</REPLACE>
</PATCH>`;
    assert.throws(
      () => parseChanges(response),
      /CREATE and SEARCH\/REPLACE target same file/,
    );
  });

  it("throws when DELETE and SEARCH/REPLACE target same file", () => {
    const response = `<DELETE path="foo.ts" />
<PATCH type="search" file="foo.ts">
<SEARCH>old</SEARCH>
<REPLACE>new</REPLACE>
</PATCH>`;
    assert.throws(
      () => parseChanges(response),
      /DELETE and SEARCH\/REPLACE target same file/,
    );
  });
});
