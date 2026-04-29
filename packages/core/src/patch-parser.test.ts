import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractPatchBlock,
  extractFilesBlock,
  extractVerifyBlock,
  extractPlanBlock,
  extractRisksBlock,
  validateDiff,
  parseHunks,
  parsePatch,
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
