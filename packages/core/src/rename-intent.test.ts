import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectRenameIntent,
  extractRenameIntent,
  formatRenameIntentGuidance,
} from "./rename-intent.js";

describe("rename intent helpers", () => {
  it("extracts Chinese rename wording", () => {
    const intent = extractRenameIntent(
      "将 packages/distill/src/state.ts 重命名为 packages/distill/src/distill-state.ts，文件内容保持不变。",
    );

    assert.deepEqual(intent, {
      detected: true,
      from: "packages/distill/src/state.ts",
      to: "packages/distill/src/distill-state.ts",
    });
  });

  it("extracts unicode arrow rename wording", () => {
    const intent = extractRenameIntent(
      "相关文件：packages/distill/src/state.ts → packages/distill/src/distill-state.ts（重命名）",
    );

    assert.equal(intent?.from, "packages/distill/src/state.ts");
    assert.equal(intent?.to, "packages/distill/src/distill-state.ts");
  });

  it("extracts English rename wording", () => {
    const intent = extractRenameIntent("Rename src/state.ts to src/distill-state.ts and update imports");

    assert.equal(intent?.from, "src/state.ts");
    assert.equal(intent?.to, "src/distill-state.ts");
  });

  it("detects generic rename intent without a parseable pair", () => {
    assert.equal(detectRenameIntent("重命名状态文件并更新引用"), true);
    assert.deepEqual(extractRenameIntent("fix the failing test"), null);
  });

  it("formats specific guidance that discourages CREATE copy for renames", () => {
    const guidance = formatRenameIntentGuidance("Move src/a.ts -> src/b.ts");

    assert.match(guidance ?? "", /<RENAME from="src\/a\.ts" to="src\/b\.ts" \/>/);
    assert.match(guidance ?? "", /Do not use <CREATE> to copy/);
    assert.match(guidance ?? "", /<SEARCH_REPLACE>/);
  });
});
