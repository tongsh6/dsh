import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePlanContract } from "./plan-contract.js";

const VALID_CONTRACT = `<PLAN>
## Goal
Fix auth token refresh

## Strategy
Update the token service and its focused test.
</PLAN>
<FILES>
- src/auth/token.ts
- src/auth/token.test.ts
</FILES>
<VERIFY_STRATEGY>
Run the focused token tests.
</VERIFY_STRATEGY>
<VERIFY>
pnpm test -- token
</VERIFY>
<RISKS>
- Token expiry edge cases may differ between providers
- Existing tests may not cover clock skew
</RISKS>`;

describe("validatePlanContract", () => {
  it("accepts a correct XML contract", () => {
    const result = validatePlanContract({ content: VALID_CONTRACT });
    assert.equal(result.valid, true);
    assert.deepEqual(result.files, ["src/auth/token.ts", "src/auth/token.test.ts"]);
    assert.equal(result.risks?.length, 2);
  });

  it("fails without PLAN as missing_plan", () => {
    const result = validatePlanContract({ content: `<FILES>\n- src/a.ts\n</FILES>` });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "missing_plan");
  });

  it("does not accept long natural language with FILES as a plan", () => {
    const result = validatePlanContract({
      content: `I will explain the plan in prose instead of using the contract. This is long enough to look useful but it is still not a valid plan.\n<FILES>\n- src/a.ts\n</FILES>`,
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "missing_plan");
  });

  it("fails when PLAN mentions Files Involved but independent FILES is absent", () => {
    const result = validatePlanContract({
      content: `<PLAN>\n## Files Involved\n- src/a.ts\n## Strategy\nPatch it\n</PLAN>\n<RISKS>\n- one\n- two\n</RISKS>`,
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "missing_files");
  });

  it("rejects FILES entries with path descriptions", () => {
    const result = validatePlanContract({
      content: VALID_CONTRACT.replace("- src/auth/token.ts", "- src/auth/token.ts: update refresh"),
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "invalid_files_entry");
  });

  it("rejects absolute paths", () => {
    const result = validatePlanContract({
      content: VALID_CONTRACT.replace("src/auth/token.ts", "/tmp/src/auth/token.ts"),
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "invalid_files_entry");
  });

  it("rejects parent traversal", () => {
    const result = validatePlanContract({
      content: VALID_CONTRACT.replace("src/auth/token.ts", "../src/auth/token.ts"),
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "invalid_files_entry");
  });

  it("rejects glob patterns", () => {
    const result = validatePlanContract({
      content: VALID_CONTRACT.replace("src/auth/token.ts", "src/**/*.ts"),
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "invalid_files_entry");
  });

  it("rejects placeholder entries", () => {
    const result = validatePlanContract({
      content: VALID_CONTRACT.replace("src/auth/token.ts", "N/A"),
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "invalid_files_entry");
  });

  it("dedupes duplicate FILES entries and records diagnostics", () => {
    const result = validatePlanContract({
      content: VALID_CONTRACT.replace(
        "- src/auth/token.test.ts",
        "- src/auth/token.ts\n- src/auth/token.test.ts",
      ),
    });
    assert.equal(result.valid, true);
    assert.deepEqual(result.files, ["src/auth/token.ts", "src/auth/token.test.ts"]);
    assert.deepEqual(result.diagnostics?.["duplicate_files_deduped"], ["src/auth/token.ts"]);
  });

  it("fails when RISKS is missing", () => {
    const result = validatePlanContract({
      content: VALID_CONTRACT.replace(/<RISKS>[\s\S]*?<\/RISKS>/, ""),
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "missing_risks");
  });

  it("fails when RISKS has only one concrete entry", () => {
    const result = validatePlanContract({
      content: VALID_CONTRACT.replace(/<RISKS>[\s\S]*?<\/RISKS>/, "<RISKS>\n- one risk\n</RISKS>"),
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "missing_risks");
  });

  it("allows missing VERIFY", () => {
    const result = validatePlanContract({
      content: VALID_CONTRACT.replace(/<VERIFY>[\s\S]*?<\/VERIFY>/, ""),
    });
    assert.equal(result.valid, true);
  });

  it("allows missing VERIFY_STRATEGY", () => {
    const result = validatePlanContract({
      content: VALID_CONTRACT.replace(/<VERIFY_STRATEGY>[\s\S]*?<\/VERIFY_STRATEGY>/, ""),
    });
    assert.equal(result.valid, true);
  });

  it("fails when finalize returns a tool call", () => {
    const result = validatePlanContract({ content: VALID_CONTRACT, hasToolCalls: true });
    assert.equal(result.valid, false);
    assert.equal(result.reason, "tool_call_in_finalize");
  });
});
