import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseChanges, applyChanges } from "./patch-parser.js";
import { buildTypescriptNamedImportRepair } from "./repair-rules/typescript-named-import.js";
import type { VerifyRunResult } from "./verifier.js";

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-ts-named-import-repair-"));
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

describe("buildTypescriptNamedImportRepair", () => {
  it("adds a missing exported identifier to an existing local named import", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "src/helpers.ts"),
        "export function existingHelper() {}\nexport function missingHelper() {}\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, "src/consumer.ts"),
        [
          "import {",
          "  existingHelper,",
          "  type HelperOptions,",
          "} from \"./helpers.js\";",
          "",
          "export function useHelper(_options: HelperOptions) {",
          "  return existingHelper;",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      const repair = buildTypescriptNamedImportRepair({
        cwd: tmp,
        assertions: [{ type: "file_contains", file: "src/consumer.ts", pattern: "missingHelper" }],
        results: [failed("file_contains src/consumer.ts")],
      });

      assert.ok(repair);
      assert.deepEqual(repair.files, ["src/consumer.ts"]);
      assert.match(repair.hints.join("\n"), /deterministic_typescript_named_import_repair/);

      const applyResult = applyChanges(tmp, parseChanges(repair.content));
      assert.equal(applyResult.success, true);
      assert.match(
        fs.readFileSync(path.join(tmp, "src/consumer.ts"), "utf-8"),
        /missingHelper,\n {2}type HelperOptions,/,
      );
    });
  });

  it("does not guess when the missing text is not a simple identifier", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/helpers.ts"), "export function missingHelper() {}\n", "utf-8");
      fs.writeFileSync(path.join(tmp, "src/consumer.ts"), "import { existingHelper } from \"./helpers.js\";\n", "utf-8");

      const repair = buildTypescriptNamedImportRepair({
        cwd: tmp,
        assertions: [{ type: "file_contains", file: "src/consumer.ts", pattern: "missingHelper()" }],
        results: [failed("file_contains src/consumer.ts")],
      });

      assert.equal(repair, null);
    });
  });

  it("does not run outside TypeScript or JavaScript files", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/helpers.ts"), "export function missingHelper() {}\n", "utf-8");
      fs.writeFileSync(path.join(tmp, "src/consumer.py"), "from helpers import existing_helper\n", "utf-8");

      const repair = buildTypescriptNamedImportRepair({
        cwd: tmp,
        assertions: [{ type: "file_contains", file: "src/consumer.py", pattern: "missingHelper" }],
        results: [failed("file_contains src/consumer.py")],
      });

      assert.equal(repair, null);
    });
  });

  it("does not synthesize an import when the source module does not export the identifier", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/helpers.ts"), "export function existingHelper() {}\n", "utf-8");
      fs.writeFileSync(path.join(tmp, "src/consumer.ts"), "import { existingHelper } from \"./helpers.js\";\n", "utf-8");

      const repair = buildTypescriptNamedImportRepair({
        cwd: tmp,
        assertions: [{ type: "file_contains", file: "src/consumer.ts", pattern: "missingHelper" }],
        results: [failed("file_contains src/consumer.ts")],
      });

      assert.equal(repair, null);
    });
  });

  it("does not synthesize a new import block when no local named import exists", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/helpers.ts"), "export function missingHelper() {}\n", "utf-8");
      fs.writeFileSync(path.join(tmp, "src/consumer.ts"), "export const value = 1;\n", "utf-8");

      const repair = buildTypescriptNamedImportRepair({
        cwd: tmp,
        assertions: [{ type: "file_contains", file: "src/consumer.ts", pattern: "missingHelper" }],
        results: [failed("file_contains src/consumer.ts")],
      });

      assert.equal(repair, null);
    });
  });

  it("does not repair non-local imports", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/consumer.ts"), "import { existingHelper } from \"external-package\";\n", "utf-8");

      const repair = buildTypescriptNamedImportRepair({
        cwd: tmp,
        assertions: [{ type: "file_contains", file: "src/consumer.ts", pattern: "missingHelper" }],
        results: [failed("file_contains src/consumer.ts")],
      });

      assert.equal(repair, null);
    });
  });

  it("does not touch a file that already contains the required identifier", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/helpers.ts"), "export function missingHelper() {}\n", "utf-8");
      fs.writeFileSync(
        path.join(tmp, "src/consumer.ts"),
        "import { existingHelper } from \"./helpers.js\";\nconst value = missingHelper;\n",
        "utf-8",
      );

      const repair = buildTypescriptNamedImportRepair({
        cwd: tmp,
        assertions: [{ type: "file_contains", file: "src/consumer.ts", pattern: "missingHelper" }],
        results: [failed("file_contains src/consumer.ts")],
      });

      assert.equal(repair, null);
    });
  });

  it("does not repair an ambiguous repeated import block", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/helpers.ts"), "export function missingHelper() {}\n", "utf-8");
      fs.writeFileSync(
        path.join(tmp, "src/consumer.ts"),
        [
          "import { existingHelper } from \"./helpers.js\";",
          "import { existingHelper } from \"./helpers.js\";",
          "",
        ].join("\n"),
        "utf-8",
      );

      const repair = buildTypescriptNamedImportRepair({
        cwd: tmp,
        assertions: [{ type: "file_contains", file: "src/consumer.ts", pattern: "missingHelper" }],
        results: [failed("file_contains src/consumer.ts")],
      });

      assert.equal(repair, null);
    });
  });
});
