import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { parseChanges, applyChanges } from "./patch-parser.js";
import { buildFailedContainsImportRepair, buildRenameReferenceRepair } from "./reference-repair.js";
import type { VerifyAssertion, VerifyRunResult } from "./verifier.js";

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-reference-repair-"));
  try {
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function failed(command: string): VerifyRunResult {
  return {
    command,
    status: "failed",
    exit_code: 1,
    output: "pattern missing",
    duration_ms: 0,
  };
}

function git(args: string[], cwd: string): void {
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

describe("buildRenameReferenceRepair", () => {
  it("builds deterministic SEARCH_REPLACE blocks from failed rename reference assertions", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "src/index.ts"),
        'export { createState } from "./state.js";\n',
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, "src/engine.ts"),
        'import { createState } from "./state.js";\n',
        "utf-8",
      );

      const assertions: VerifyAssertion[] = [
        { type: "file_contains", file: "src/index.ts", pattern: "./distill-state.js" },
        { type: "file_contains", file: "src/engine.ts", pattern: "./distill-state.js" },
      ];

      const repair = buildRenameReferenceRepair({
        cwd: tmp,
        taskDescription: "Move src/state.ts -> src/distill-state.ts and update imports",
        assertions,
        results: [
          failed("file_contains src/index.ts"),
          failed("file_contains src/engine.ts"),
        ],
      });

      assert.ok(repair);
      assert.deepEqual(repair.files.sort(), ["src/engine.ts", "src/index.ts"]);
      assert.match(repair.content, /<PATCH type="search" file="src\/index\.ts">/);
      assert.match(repair.hints.join("\n"), /deterministic_reference_repair/);

      const applyResult = applyChanges(tmp, parseChanges(repair.content));
      assert.equal(applyResult.success, true);
      assert.equal(
        fs.readFileSync(path.join(tmp, "src/index.ts"), "utf-8"),
        'export { createState } from "./distill-state.js";\n',
      );
      assert.equal(
        fs.readFileSync(path.join(tmp, "src/engine.ts"), "utf-8"),
        'import { createState } from "./distill-state.js";\n',
      );
    });
  });

  it("prepends a content-preserving RENAME when a CREATE copy left the source file behind", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/state.ts"), "export const stable = true;\n", "utf-8");
      fs.writeFileSync(path.join(tmp, "src/distill-state.ts"), "export const stable = false;\n", "utf-8");
      fs.writeFileSync(path.join(tmp, "src/index.ts"), 'export * from "./state.js";\n', "utf-8");

      const assertions: VerifyAssertion[] = [
        { type: "file_not_exists", file: "src/state.ts" },
        {
          type: "shell",
          command: "git show HEAD:src/state.ts | cmp - src/distill-state.ts",
          name: "renamed_file_content_unchanged",
        },
        { type: "file_contains", file: "src/index.ts", pattern: "./distill-state.js" },
      ];

      const repair = buildRenameReferenceRepair({
        cwd: tmp,
        taskDescription: "Rename src/state.ts to src/distill-state.ts and update references",
        assertions,
        results: [
          failed("file_not_exists src/state.ts"),
          failed("renamed_file_content_unchanged"),
          failed("file_contains src/index.ts"),
        ],
      });

      assert.ok(repair);
      assert.match(repair.content, /^<RENAME from="src\/state\.ts" to="src\/distill-state\.ts" \/>/);
      assert.match(repair.hints.join("\n"), /deterministic_content_preserving_rename/);

      const applyResult = applyChanges(tmp, parseChanges(repair.content));
      assert.equal(applyResult.success, true);
      assert.equal(fs.existsSync(path.join(tmp, "src/state.ts")), false);
      assert.equal(
        fs.readFileSync(path.join(tmp, "src/distill-state.ts"), "utf-8"),
        "export const stable = true;\n",
      );
      assert.equal(
        fs.readFileSync(path.join(tmp, "src/index.ts"), "utf-8"),
        'export * from "./distill-state.js";\n',
      );
    });
  });

  it("restores renamed content from git HEAD when the source file was already deleted", () => {
    withTmp((tmp) => {
      git(["init"], tmp);
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/state.ts"), "export const stable = true;\n", "utf-8");
      git(["add", "src/state.ts"], tmp);
      git(["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "baseline"], tmp);

      fs.rmSync(path.join(tmp, "src/state.ts"));
      fs.writeFileSync(path.join(tmp, "src/distill-state.ts"), "export const stable = false;\n", "utf-8");
      fs.writeFileSync(path.join(tmp, "src/index.ts"), 'export * from "./state.js";\n', "utf-8");

      const assertions: VerifyAssertion[] = [
        {
          type: "shell",
          command: "git show HEAD:src/state.ts | cmp - src/distill-state.ts",
          name: "renamed_file_content_unchanged",
        },
        { type: "file_contains", file: "src/index.ts", pattern: "./distill-state.js" },
      ];

      const repair = buildRenameReferenceRepair({
        cwd: tmp,
        taskDescription: "Rename src/state.ts to src/distill-state.ts and update references",
        assertions,
        results: [
          failed("renamed_file_content_unchanged"),
          failed("file_contains src/index.ts"),
        ],
      });

      assert.ok(repair);
      assert.match(repair.content, /<PATCH type="search" file="src\/distill-state\.ts">/);
      assert.match(repair.hints.join("\n"), /deterministic_content_restore_from_git_head/);

      const applyResult = applyChanges(tmp, parseChanges(repair.content));
      assert.equal(applyResult.success, true);
      assert.equal(
        fs.readFileSync(path.join(tmp, "src/distill-state.ts"), "utf-8"),
        "export const stable = true;\n",
      );
      assert.equal(
        fs.readFileSync(path.join(tmp, "src/index.ts"), "utf-8"),
        'export * from "./distill-state.js";\n',
      );
    });
  });

  it("does not guess when the task has no parseable rename pair", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "index.ts"), 'export * from "./state.js";\n', "utf-8");

      const repair = buildRenameReferenceRepair({
        cwd: tmp,
        taskDescription: "Update imports",
        assertions: [{ type: "file_contains", file: "index.ts", pattern: "./distill-state.js" }],
        results: [failed("file_contains index.ts")],
      });

      assert.equal(repair, null);
    });
  });

  it("skips ambiguous repeated search lines instead of applying a broad replacement", () => {
    withTmp((tmp) => {
      fs.writeFileSync(
        path.join(tmp, "index.ts"),
        'export * from "./state.js";\nexport * from "./state.js";\n',
        "utf-8",
      );

      const repair = buildRenameReferenceRepair({
        cwd: tmp,
        taskDescription: "Rename state.ts to distill-state.ts",
        assertions: [{ type: "file_contains", file: "index.ts", pattern: "./distill-state.js" }],
        results: [failed("file_contains index.ts")],
      });

      assert.equal(repair, null);
    });
  });
});

describe("buildFailedContainsImportRepair", () => {
  it("adds a missing exported identifier to an existing local named import", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src/providers"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "src/providers/shared.ts"),
        "export function buildAuthHeaders() {}\nexport async function withRetry<T>(fn: () => Promise<T>): Promise<T> { return fn(); }\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, "src/providers/anthropic.ts"),
        [
          "import {",
          "  buildAuthHeaders,",
          "  type ProviderFactoryOptions,",
          "} from \"./shared.js\";",
          "",
          "export function createProvider(_options: ProviderFactoryOptions) {",
          "  return buildAuthHeaders;",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      const repair = buildFailedContainsImportRepair({
        cwd: tmp,
        assertions: [{ type: "file_contains", file: "src/providers/anthropic.ts", pattern: "withRetry" }],
        results: [failed("file_contains src/providers/anthropic.ts")],
      });

      assert.ok(repair);
      assert.deepEqual(repair.files, ["src/providers/anthropic.ts"]);
      assert.match(repair.hints.join("\n"), /deterministic_failed_contains_import_repair/);

      const applyResult = applyChanges(tmp, parseChanges(repair.content));
      assert.equal(applyResult.success, true);
      assert.match(
        fs.readFileSync(path.join(tmp, "src/providers/anthropic.ts"), "utf-8"),
        /withRetry,\n {2}type ProviderFactoryOptions,/,
      );
    });
  });

  it("does not guess when the missing text is not a simple exported identifier", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/shared.ts"), "export function withRetry() {}\n", "utf-8");
      fs.writeFileSync(path.join(tmp, "src/use.ts"), "import { other } from \"./shared.js\";\n", "utf-8");

      const repair = buildFailedContainsImportRepair({
        cwd: tmp,
        assertions: [{ type: "file_contains", file: "src/use.ts", pattern: "withRetry()" }],
        results: [failed("file_contains src/use.ts")],
      });

      assert.equal(repair, null);
    });
  });
});
