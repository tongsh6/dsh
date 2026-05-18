import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPlanFileContract, normalizePath } from "./plan-file-contract.js";

describe("normalizePath", () => {
  it("strips leading ./ and collapses redundant segments", () => {
    assert.equal(normalizePath("./x.ts"), "x.ts");
    assert.equal(normalizePath("x.ts"), "x.ts");
    assert.equal(normalizePath("a//b.ts"), "a/b.ts");
    assert.equal(normalizePath("a/./b.ts"), "a/b.ts");
    assert.equal(normalizePath("src\\providers\\openai.ts"), "src/providers/openai.ts");
  });

  it("does not case-fold paths", () => {
    assert.equal(normalizePath("./Src/Foo.ts"), "Src/Foo.ts");
  });
});

describe("buildPlanFileContract", () => {
  it("maps legacy plan.files to medium-confidence required_target", () => {
    const contract = buildPlanFileContract({ files: ["a.ts", "b.ts"] });
    assert.equal(contract.version, "legacy");
    assert.deepEqual(
      contract.requiredTargetFiles.map((e) => e.path),
      ["a.ts", "b.ts"],
    );
    for (const entry of contract.requiredTargetFiles) {
      assert.equal(entry.role, "required_target");
      assert.equal(entry.confidence, "medium");
      assert.equal(entry.source, "legacy_files");
    }
    assert.deepEqual(contract.optionalTargetFiles, []);
    assert.deepEqual(contract.contextFiles, []);
  });

  it("normalizes and dedupes legacy paths with stable order", () => {
    const contract = buildPlanFileContract({
      files: ["./a.ts", "a.ts", "dir//b.ts", "c.ts"],
    });
    assert.deepEqual(
      contract.requiredTargetFiles.map((e) => e.path),
      ["a.ts", "dir/b.ts", "c.ts"],
    );
  });

  it("yields an empty legacy contract for empty or undefined plan", () => {
    for (const input of [undefined, { files: [] }, {}]) {
      const contract = buildPlanFileContract(input);
      assert.equal(contract.version, "legacy");
      assert.deepEqual(contract.requiredTargetFiles, []);
    }
  });

  it("prefers an explicit v2 contract when present", () => {
    const contract = buildPlanFileContract({
      files: ["legacy.ts"],
      file_contract: {
        requiredTargetFiles: [{ path: "./req.ts", confidence: "high" }],
        contextFiles: ["ctx.ts"],
      },
    });
    assert.equal(contract.version, "v2");
    assert.deepEqual(
      contract.requiredTargetFiles.map((e) => e.path),
      ["req.ts"],
    );
    assert.equal(contract.requiredTargetFiles[0]?.confidence, "high");
    assert.equal(contract.requiredTargetFiles[0]?.source, "explicit_v2");
    assert.deepEqual(
      contract.contextFiles.map((e) => e.path),
      ["ctx.ts"],
    );
  });

  it("resolves a duplicate path to the higher-precedence role", () => {
    const contract = buildPlanFileContract({
      file_contract: {
        requiredTargetFiles: ["shared.ts"],
        optionalTargetFiles: ["shared.ts", "opt.ts"],
      },
    });
    assert.deepEqual(
      contract.requiredTargetFiles.map((e) => e.path),
      ["shared.ts"],
    );
    assert.deepEqual(
      contract.optionalTargetFiles.map((e) => e.path),
      ["opt.ts"],
    );
  });
});
