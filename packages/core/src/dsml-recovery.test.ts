import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recoverDsmlWrappedChange } from "./dsml-recovery.js";
import { parsePatchTurn } from "./patch-parser.js";

// 全角竖线 U+FF5C —— 实测模型畸形 token 是双竖线 `｜｜`,规范是单竖线 `｜`
const BAR = "｜";
const BB = BAR + BAR; // double-bar (malformed observed)

describe("recoverDsmlWrappedChange", () => {
  it("passes through content without DSML markers", () => {
    const input = "Just some prose.\n<PATCH>\n... diff ...\n</PATCH>";
    const result = recoverDsmlWrappedChange(input);
    assert.equal(result.recovered, false);
    assert.equal(result.content, input);
    assert.equal(result.reason, undefined);
  });

  it("returns passthrough on empty content", () => {
    const result = recoverDsmlWrappedChange("");
    assert.equal(result.recovered, false);
    assert.equal(result.content, "");
  });

  it("strips single-bar (well-formed) DSML envelope around properly closed <PATCH>", () => {
    const input =
      `<${BAR}DSML${BAR}tool_calls><${BAR}DSML${BAR}invoke name="apply_patch"><${BAR}DSML${BAR}parameter name="patch" string="true"><PATCH>\n` +
      `--- a/foo.ts\n+++ b/foo.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n` +
      `</PATCH></${BAR}DSML${BAR}parameter></${BAR}DSML${BAR}invoke></${BAR}DSML${BAR}tool_calls>`;
    const result = recoverDsmlWrappedChange(input);
    assert.equal(result.recovered, true);
    assert.match(result.content, /<PATCH>/);
    assert.match(result.content, /<\/PATCH>/);
    assert.doesNotMatch(result.content, /DSML/);
    // close 已经存在,不应合成
    assert.doesNotMatch(result.reason ?? "", /synthesized close: PATCH/);
  });

  it("strips double-bar (malformed) DSML envelope AND synthesizes missing </PATCH>", () => {
    // 模型把 close 写成 </｜｜DSML｜｜parameter>(而不是 </PATCH>)的真实场景
    const input =
      `<${BB}DSML${BB}tool_calls><${BB}DSML${BB}invoke name="apply_patch"><${BB}DSML${BB}parameter name="patch" string="true">\n` +
      `<PATCH>\n--- a/foo.ts\n+++ b/foo.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n` +
      `</${BB}DSML${BB}parameter></${BB}DSML${BB}invoke></${BB}DSML${BB}tool_calls>`;
    const result = recoverDsmlWrappedChange(input);
    assert.equal(result.recovered, true);
    assert.match(result.content, /<PATCH>/);
    assert.match(result.content, /<\/PATCH>/);
    assert.doesNotMatch(result.content, /DSML/);
    assert.match(result.reason ?? "", /synthesized close: PATCH/);
    // 端到端:必须能被 extractPatchBlock 风格的非贪婪正则匹配
    const m = result.content.match(/<PATCH>([\s\S]*?)<\/PATCH>/);
    assert.ok(m, "extractPatchBlock-style regex must match after salvage");
    assert.match(m![1]!, /\+new/);
  });

  it("r7 byte-level specimen (provider-dedup trial2): recovers complete <PATCH> block", () => {
    // 真实从 /tmp/dsh-patch-explore-debug.jsonl entry 29 抓的内容,
    // benchmark 当时判 `invalid: "no action"` 因为 </PATCH> 被 </｜｜DSML｜｜parameter> 替换。
    // 双竖线 `${BB}` 用 U+FF5C ×2 拼接保证字节真实。
    const r7Specimen =
      "Now update `openai-compatible.ts` to use `buildAuthHeaders`.\n\n<PATCH>\n" +
      "--- a/packages/distill/src/providers/openai-compatible.ts\n" +
      "+++ b/packages/distill/src/providers/openai-compatible.ts\n" +
      "@@ -1,6 +1,7 @@\n" +
      ' import type { LLMProvider, LLMProviderConfig } from "@loamlog/core";\n' +
      ' import { LLMResponseFormatError, LLMTimeoutError } from "@loamlog/core";\n' +
      " import {\n" +
      "+  buildAuthHeaders,\n" +
      "   buildNetworkError,\n" +
      "   createTimeoutSignal,\n" +
      "   extractTextContent,\n" +
      "@@ -71,10 +72,7 @@ export function createOpenAICompatibleProvider(\n" +
      " \n" +
      "       const headers: Record<string, string> = {\n" +
      '         "content-type": "application/json",\n' +
      "-      };\n" +
      "-\n" +
      "-      if (apiKey) {\n" +
      "-        headers.authorization = `Bearer ${apiKey}`;\n" +
      "+        ...(apiKey ? buildAuthHeaders(apiKey) : {}),\n" +
      "       }\n" +
      " \n" +
      "       const signal = createTimeoutSignal(timeoutMs);\n" +
      `</${BB}DSML${BB}parameter>\n</${BB}DSML${BB}invoke>\n</${BB}DSML${BB}tool_calls>`;

    const result = recoverDsmlWrappedChange(r7Specimen);
    assert.equal(result.recovered, true);
    assert.doesNotMatch(result.content, /DSML/);
    // 关键断言:必须能被 extractPatchBlock(`patch-parser.ts:135`)的非贪婪正则匹配
    const m = result.content.match(/<PATCH>([\s\S]*?)<\/PATCH>/);
    assert.ok(m, "extractPatchBlock-style regex must match after r7 salvage");
    // 捕获的 diff 必须包含真实 hunk 内容(模型实际工作的产物)
    assert.match(m![1]!, /\+ {2}buildAuthHeaders,/);
    assert.match(m![1]!, /@@ -71,10 \+72,7 @@/);
    assert.match(m![1]!, /\+ {8}\.\.\.\(apiKey \? buildAuthHeaders\(apiKey\) : \{\}\),/);
  });

  it("handles DSML around <CREATE path=...> with missing </CREATE>", () => {
    const input =
      `<${BB}DSML${BB}parameter name="x" string="true">\n` +
      `<CREATE path="src/foo.ts">\nexport function foo() {}\n` +
      `</${BB}DSML${BB}parameter>`;
    const result = recoverDsmlWrappedChange(input);
    assert.equal(result.recovered, true);
    assert.match(result.content, /<CREATE path="src\/foo\.ts">/);
    assert.match(result.content, /<\/CREATE>/);
    assert.match(result.reason ?? "", /synthesized close: CREATE/);
  });

  it("handles DSML around self-closing <RENAME .../> (no synthesis needed)", () => {
    const input = `<${BB}DSML${BB}parameter><RENAME from="old.ts" to="new.ts" /></${BB}DSML${BB}parameter>`;
    const result = recoverDsmlWrappedChange(input);
    assert.equal(result.recovered, true);
    assert.match(result.content, /<RENAME from="old\.ts" to="new\.ts" \/>/);
    assert.doesNotMatch(result.reason ?? "", /synthesized close/);
  });

  it("handles DSML around self-closing <DELETE .../>", () => {
    const input = `<${BB}DSML${BB}parameter><DELETE path="x.ts" /></${BB}DSML${BB}parameter>`;
    const result = recoverDsmlWrappedChange(input);
    assert.equal(result.recovered, true);
    assert.match(result.content, /<DELETE path="x\.ts" \/>/);
    assert.doesNotMatch(result.reason ?? "", /synthesized close/);
  });

  it("handles DSML around <INSERT ...> with missing </INSERT>", () => {
    const input =
      `<${BB}DSML${BB}parameter>\n` +
      `<INSERT position="after" anchor="export function foo" file="y.ts">\n` +
      `console.log("hi");\n` +
      `</${BB}DSML${BB}parameter>`;
    const result = recoverDsmlWrappedChange(input);
    assert.equal(result.recovered, true);
    assert.match(result.content, /<INSERT/);
    assert.match(result.content, /<\/INSERT>/);
    assert.match(result.reason ?? "", /synthesized close: INSERT/);
  });

  it("handles DSML around fully-closed <PATCH type=\"search\">...</PATCH> (no synthesis)", () => {
    const input =
      `<${BB}DSML${BB}parameter><PATCH type="search" file="x.ts">\n` +
      `<SEARCH>old</SEARCH>\n<REPLACE>new</REPLACE>\n` +
      `</PATCH></${BB}DSML${BB}parameter>`;
    const result = recoverDsmlWrappedChange(input);
    assert.equal(result.recovered, true);
    assert.match(result.content, /<PATCH type="search" file="x\.ts">/);
    assert.match(result.content, /<\/PATCH>/);
    // 不应重复合成:open=1, close=1
    const closes = (result.content.match(/<\/PATCH>/g) ?? []).length;
    assert.equal(closes, 1);
    assert.doesNotMatch(result.reason ?? "", /synthesized close: PATCH/);
  });

  it("strips DSML even when no recognizable change block is inside (let parsePatchTurn report no-action)", () => {
    const input = `<${BB}DSML${BB}parameter>just random text, no change block</${BB}DSML${BB}parameter>`;
    const result = recoverDsmlWrappedChange(input);
    assert.equal(result.recovered, true);
    assert.doesNotMatch(result.content, /DSML/);
    assert.equal(result.content.trim(), "just random text, no change block");
    assert.doesNotMatch(result.reason ?? "", /synthesized close/);
  });

  it("end-to-end r7: parsePatchTurn flips from invalid → change after salvage", () => {
    // Plan §2.5 集成验收:without salvage = invalid no-action;with salvage = kind:change op:PATCH
    const r7Specimen =
      "Now update `openai-compatible.ts` to use `buildAuthHeaders`.\n\n<PATCH>\n" +
      "--- a/packages/distill/src/providers/openai-compatible.ts\n" +
      "+++ b/packages/distill/src/providers/openai-compatible.ts\n" +
      "@@ -1,6 +1,7 @@\n" +
      " import type { LLMProvider } from \"@loamlog/core\";\n" +
      "+import { buildAuthHeaders } from \"./shared.js\";\n" +
      " import { foo } from \"./foo.js\";\n" +
      `</${BB}DSML${BB}parameter>\n</${BB}DSML${BB}invoke>\n</${BB}DSML${BB}tool_calls>`;

    // Without salvage: parsePatchTurn judges invalid no-action
    const before = parsePatchTurn(r7Specimen, false);
    assert.equal(before.kind, "invalid");
    if (before.kind === "invalid") {
      assert.match(before.reason, /no action/);
    }

    // With salvage: parsePatchTurn returns change/PATCH
    const salvaged = recoverDsmlWrappedChange(r7Specimen);
    assert.equal(salvaged.recovered, true);
    const after = parsePatchTurn(salvaged.content, false);
    assert.equal(after.kind, "change");
    if (after.kind === "change") {
      assert.equal(after.change.op, "PATCH");
      assert.equal(after.change.file, "packages/distill/src/providers/openai-compatible.ts");
    }
  });

  it("end-to-end CREATE: parsePatchTurn returns change after salvage closes <CREATE>", () => {
    const input =
      `<${BB}DSML${BB}parameter>\n` +
      `<CREATE path="src/foo.ts">\nexport const foo = 1;\n` +
      `</${BB}DSML${BB}parameter>`;
    const before = parsePatchTurn(input, false);
    assert.equal(before.kind, "invalid");

    const salvaged = recoverDsmlWrappedChange(input);
    const after = parsePatchTurn(salvaged.content, false);
    assert.equal(after.kind, "change");
    if (after.kind === "change") {
      assert.equal(after.change.op, "CREATE");
      assert.equal(after.change.file, "src/foo.ts");
    }
  });

  it("synthesizes proportionally when 2 opens have 0 closes", () => {
    // 罕见但 plan §6 风险 2 提到的多块场景:不试图选,简单按数量补齐
    const input =
      `<${BB}DSML${BB}parameter>\n<PATCH>diff-1</PATCH>\n<PATCH>diff-2\n` +
      `</${BB}DSML${BB}parameter>`;
    const result = recoverDsmlWrappedChange(input);
    assert.equal(result.recovered, true);
    // 2 opens, 1 existing close → 补 1 个
    const closes = (result.content.match(/<\/PATCH>/g) ?? []).length;
    assert.equal(closes, 2);
    assert.match(result.reason ?? "", /synthesized close: PATCH×1/);
  });
});
