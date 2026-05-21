import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  runAssertion,
  runVerifyAssertions,
  parseAssertion,
  buildFailedAssertionDiagnostics,
  buildSemanticRepairHints,
  failedAssertionTargetFiles,
  formatSemanticRepairHints,
  type VerifyAssertion,
} from "./verifier.js";

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-verifier-"));
  try {
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("runAssertion - file_exists", () => {
  it("passes when file exists", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "a.txt"), "x", "utf-8");
      const r = runAssertion({ type: "file_exists", file: "a.txt" }, tmp);
      assert.equal(r.status, "passed");
      assert.equal(r.exit_code, 0);
    });
  });

  it("fails with structured diagnostic when file is absent", () => {
    withTmp((tmp) => {
      const r = runAssertion({ type: "file_exists", file: "missing.txt" }, tmp);
      assert.equal(r.status, "failed");
      assert.match(r.output, /assertion 'file_exists' failed.*missing\.txt/);
    });
  });

  it("uses name in command field when provided", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "a.txt"), "x", "utf-8");
      const r = runAssertion({ type: "file_exists", file: "a.txt", name: "anchor_file_present" }, tmp);
      assert.equal(r.command, "anchor_file_present");
    });
  });
});

describe("runAssertion - file_not_exists", () => {
  it("passes when file is absent", () => {
    withTmp((tmp) => {
      const r = runAssertion({ type: "file_not_exists", file: "deleted.ts" }, tmp);
      assert.equal(r.status, "passed");
    });
  });

  it("fails with structured diagnostic when file still exists", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "stale.ts"), "x", "utf-8");
      const r = runAssertion({ type: "file_not_exists", file: "stale.ts" }, tmp);
      assert.equal(r.status, "failed");
      assert.match(r.output, /file should not exist but does.*stale\.ts/);
    });
  });
});

describe("runAssertion - file_contains", () => {
  it("passes when substring found", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "src.ts"), "export const generatedAt = '...';", "utf-8");
      const r = runAssertion({ type: "file_contains", file: "src.ts", pattern: "generatedAt" }, tmp);
      assert.equal(r.status, "passed");
    });
  });

  it("fails with structured diagnostic when pattern missing", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "src.ts"), "hello world", "utf-8");
      const r = runAssertion({ type: "file_contains", file: "src.ts", pattern: "generatedAt" }, tmp);
      assert.equal(r.status, "failed");
      assert.match(r.output, /file_contains' failed.*src\.ts.*generatedAt/);
    });
  });

  it("treats pattern as regex when regex=true", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "src.ts"), "version: 1.2.3", "utf-8");
      const ok = runAssertion(
        { type: "file_contains", file: "src.ts", pattern: "version:\\s+\\d+\\.\\d+", regex: true },
        tmp,
      );
      assert.equal(ok.status, "passed");
      assert.match(ok.output, /\(pattern found\)|file_contains/);
    });
  });

  it("fails when file does not exist (treated as pattern absent)", () => {
    withTmp((tmp) => {
      const r = runAssertion({ type: "file_contains", file: "missing.ts", pattern: "x" }, tmp);
      assert.equal(r.status, "failed");
      assert.match(r.output, /could not be read/);
    });
  });

  it("fails on regex with invalid pattern (treated as no match)", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "src.ts"), "anything", "utf-8");
      const r = runAssertion(
        { type: "file_contains", file: "src.ts", pattern: "[invalid", regex: true },
        tmp,
      );
      assert.equal(r.status, "failed");
    });
  });

  it("matches ^ anchor as start-of-line (m flag, matching grep BRE behavior)", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "README.md"), "# Title\n## Architecture\nsome content\n## Distill Observability\ndetails\n## Next\n", "utf-8");
      // Without m flag ^ would only match at start of entire string; with m it matches at start of any line
      const r = runAssertion(
        { type: "file_contains", file: "README.md", pattern: "^## Distill Observability", regex: true },
        tmp,
      );
      assert.equal(r.status, "passed", `expected passed but got: ${r.output}`);

      const shouldFail = runAssertion(
        { type: "file_contains", file: "README.md", pattern: "^## NonExistent", regex: true },
        tmp,
      );
      assert.equal(shouldFail.status, "failed");
    });
  });
});

describe("runAssertion - file_not_contains", () => {
  it("passes when pattern absent", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "clean.ts"), "import x from 'y';", "utf-8");
      const r = runAssertion({ type: "file_not_contains", file: "clean.ts", pattern: "console.log" }, tmp);
      assert.equal(r.status, "passed");
    });
  });

  it("fails with structured diagnostic when pattern present", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "leaked.ts"), "console.log('leak')", "utf-8");
      const r = runAssertion({ type: "file_not_contains", file: "leaked.ts", pattern: "console.log" }, tmp);
      assert.equal(r.status, "failed");
      assert.match(r.output, /file_not_contains' failed.*leaked\.ts.*console\.log/);
    });
  });

  it("passes when file does not exist (vacuously true)", () => {
    withTmp((tmp) => {
      const r = runAssertion({ type: "file_not_contains", file: "deleted.ts", pattern: "anything" }, tmp);
      assert.equal(r.status, "passed");
    });
  });
});

describe("runAssertion - shell wrapper", () => {
  it("delegates to runCommand and prepends name when given", () => {
    withTmp((tmp) => {
      const r = runAssertion(
        { type: "shell", command: "echo hello", name: "say_hello" },
        tmp,
      );
      assert.equal(r.status, "passed");
      assert.match(r.command, /^say_hello: echo hello$/);
      assert.match(r.output, /hello/);
    });
  });

  it("preserves stderr/stdout on shell failure", () => {
    withTmp((tmp) => {
      const r = runAssertion(
        { type: "shell", command: "sh -c 'echo boom 1>&2; exit 1'" },
        tmp,
      );
      assert.equal(r.status, "failed");
      assert.match(r.output, /boom/);
    });
  });
});

describe("runAssertion - maven_test", () => {
  it("composes a targeted multi-module Maven test with upstream no-match tolerance", () => {
    withTmp((tmp) => {
      const binDir = path.join(tmp, "bin");
      const backendDir = path.join(tmp, "backend");
      fs.mkdirSync(binDir, { recursive: true });
      fs.mkdirSync(backendDir, { recursive: true });
      const argsFile = path.join(tmp, "mvn-args.txt");
      fs.writeFileSync(
        path.join(binDir, "mvn"),
        `#!/bin/sh\necho "$@" > "${argsFile}"\n`,
        "utf-8",
      );
      fs.chmodSync(path.join(binDir, "mvn"), 0o755);

      const oldPath = process.env.PATH;
      process.env.PATH = `${binDir}:${oldPath ?? ""}`;
      try {
        const r = runAssertion({
          type: "maven_test",
          project_dir: "backend",
          module: "releasehub-application",
          tests: "ExportAppServiceTest",
          also_make: true,
          quiet: true,
          name: "application_csv_test",
        } as any, tmp);

        assert.equal(r.status, "passed");
        assert.match(r.command, /^application_csv_test: cd backend && mvn test/);
        const args = fs.readFileSync(argsFile, "utf-8");
        assert.match(args, /test/);
        assert.match(args, /-pl releasehub-application/);
        assert.match(args, /-am/);
        assert.match(args, /-Dtest=ExportAppServiceTest/);
        assert.match(args, /-Dsurefire\.failIfNoSpecifiedTests=false/);
        assert.match(args, /-q/);
      } finally {
        process.env.PATH = oldPath;
      }
    });
  });
});

describe("parseAssertion", () => {
  it("parses each of the 5 valid types", () => {
    assert.deepEqual(
      parseAssertion({ type: "file_exists", file: "a.ts" }),
      { type: "file_exists", file: "a.ts" },
    );
    assert.deepEqual(
      parseAssertion({ type: "file_not_exists", file: "b.ts", name: "no_b" }),
      { type: "file_not_exists", file: "b.ts", name: "no_b" },
    );
    assert.deepEqual(
      parseAssertion({ type: "file_contains", file: "c.ts", pattern: "foo" }),
      { type: "file_contains", file: "c.ts", pattern: "foo" },
    );
    assert.deepEqual(
      parseAssertion({ type: "file_not_contains", file: "d.ts", pattern: "bar", regex: true }),
      { type: "file_not_contains", file: "d.ts", pattern: "bar", regex: true },
    );
    assert.deepEqual(
      parseAssertion({ type: "shell", command: "pnpm test" }),
      { type: "shell", command: "pnpm test" },
    );
    assert.deepEqual(
      parseAssertion({
        type: "maven_test",
        project_dir: "backend",
        module: "releasehub-application",
        tests: "ExportAppServiceTest",
        also_make: true,
        quiet: true,
        timeout_ms: 180000,
        name: "maven_csv",
      }),
      {
        type: "maven_test",
        project_dir: "backend",
        module: "releasehub-application",
        tests: "ExportAppServiceTest",
        also_make: true,
        quiet: true,
        timeout_ms: 180000,
        name: "maven_csv",
      },
    );
  });

  it("returns null for missing required fields", () => {
    assert.equal(parseAssertion({ type: "file_exists" }), null);
    assert.equal(parseAssertion({ type: "file_contains", file: "a.ts" }), null);
    assert.equal(parseAssertion({ type: "shell", command: "" }), null);
    assert.equal(parseAssertion({ type: "shell", command: "   " }), null);
  });

  it("returns null for unknown type", () => {
    assert.equal(parseAssertion({ type: "json_path", path: "$.x" }), null);
    assert.equal(parseAssertion({ type: "exit_code", value: 0 }), null);
  });

  it("returns null for non-objects", () => {
    assert.equal(parseAssertion(null), null);
    assert.equal(parseAssertion(undefined), null);
    assert.equal(parseAssertion("file_exists"), null);
    assert.equal(parseAssertion(42), null);
  });

  it("strips unknown fields, keeps recognized ones", () => {
    const r = parseAssertion({ type: "file_exists", file: "a.ts", extra: "ignored" });
    assert.deepEqual(r, { type: "file_exists", file: "a.ts" });
  });
});

describe("runVerifyAssertions", () => {
  it("runs all assertions in order and preserves results array", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "a.txt"), "has-pattern", "utf-8");
      const list: VerifyAssertion[] = [
        { type: "file_exists", file: "a.txt" },
        { type: "file_contains", file: "a.txt", pattern: "has-pattern" },
        { type: "file_not_exists", file: "ghost.txt" },
        { type: "shell", command: "echo ok" },
      ];
      const results = runVerifyAssertions(list, tmp);
      assert.equal(results.length, 4);
      assert.ok(results.every((r) => r.status === "passed"));
    });
  });

  it("captures structured failure for one of multiple assertions", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "src.ts"), "nothing here\n", "utf-8");
      const list: VerifyAssertion[] = [
        { type: "file_exists", file: "src.ts" },
        { type: "file_contains", file: "src.ts", pattern: "needle" },
      ];
      const results = runVerifyAssertions(list, tmp);
      assert.equal(results[0]!.status, "passed");
      assert.equal(results[1]!.status, "failed");
      assert.match(results[1]!.output, /file_contains' failed/);
    });
  });
});

describe("buildFailedAssertionDiagnostics", () => {
  it("formats failed structured assertions without hardcoding fixture paths", () => {
    const assertions: VerifyAssertion[] = [
      { type: "file_exists", file: "src/new.ts" },
      { type: "file_contains", file: "src/use.ts", pattern: "./new.js" },
    ];
    const results = [
      {
        command: "file_exists src/new.ts",
        status: "failed" as const,
        exit_code: 1,
        output: "assertion 'file_exists' failed: file does not exist: src/new.ts",
        duration_ms: 0,
      },
      {
        command: "file_contains src/use.ts ~ ./new.js",
        status: "passed" as const,
        exit_code: 0,
        output: "(pattern found)",
        duration_ms: 0,
      },
    ];

    const diagnostics = buildFailedAssertionDiagnostics(assertions, results);

    assert.ok(diagnostics);
    assert.match(diagnostics, /FAILED VERIFICATION CONTRACTS/);
    assert.match(diagnostics, /src\/new\.ts/);
    assert.match(diagnostics, /must exist/);
    assert.doesNotMatch(diagnostics, /src\/use\.ts/);
  });

  it("returns null when all assertions passed", () => {
    const diagnostics = buildFailedAssertionDiagnostics(
      [{ type: "file_exists", file: "src/new.ts" }],
      [{
        command: "file_exists src/new.ts",
        status: "passed",
        exit_code: 0,
        output: "(file exists)",
        duration_ms: 0,
      }],
    );

    assert.equal(diagnostics, null);
  });
});

describe("buildSemanticRepairHints", () => {
  it("turns file existence and absence failures into edit-protocol hints", () => {
    const assertions: VerifyAssertion[] = [
      { type: "file_exists", file: "src/distill-state.ts" },
      { type: "file_not_exists", file: "src/state.ts" },
    ];
    const results = [
      {
        command: "file_exists src/distill-state.ts",
        status: "failed" as const,
        exit_code: 1,
        output: "missing",
        duration_ms: 0,
      },
      {
        command: "file_not_exists src/state.ts",
        status: "failed" as const,
        exit_code: 1,
        output: "still exists",
        duration_ms: 0,
      },
    ];

    const hints = buildSemanticRepairHints(assertions, results);

    assert.equal(hints.length, 2);
    assert.match(hints[0]!, /file_exists_failed/);
    assert.match(hints[0]!, /<RENAME from=/);
    assert.match(hints[1]!, /file_not_exists_failed/);
    assert.match(hints[1]!, /<DELETE path="src\/state\.ts"/);
  });

  it("classifies import reference failures as SEARCH_REPLACE work", () => {
    const hints = buildSemanticRepairHints(
      [{ type: "file_contains", file: "src/index.ts", pattern: "./distill-state.js" }],
      [{
        command: "file_contains src/index.ts ~ ./distill-state.js",
        status: "failed",
        exit_code: 1,
        output: "pattern missing",
        duration_ms: 0,
      }],
    );

    assert.equal(hints.length, 1);
    assert.match(hints[0]!, /file_contains_failed/);
    assert.match(hints[0]!, /<SEARCH_REPLACE>/);
    assert.match(hints[0]!, /\.\/distill-state\.js/);
  });

  it("classifies non-reference contains failures as concrete target-file edits", () => {
    const hints = buildSemanticRepairHints(
      [{ type: "file_contains", file: "src/provider.ts", pattern: "withRetry" }],
      [{
        command: "file_contains src/provider.ts ~ withRetry",
        status: "failed",
        exit_code: 1,
        output: "pattern missing",
        duration_ms: 0,
      }],
    );

    assert.equal(hints.length, 1);
    assert.match(hints[0]!, /next repair change must touch this file/);
    assert.match(hints[0]!, /withRetry/);
  });

  it("classifies content equality shell failures without injecting fixture paths", () => {
    const hints = buildSemanticRepairHints(
      [{
        type: "shell",
        command: "git show HEAD:old.ts | cmp - new.ts",
        name: "renamed_file_content_unchanged",
      }],
      [{
        command: "renamed_file_content_unchanged: git show HEAD:old.ts | cmp - new.ts",
        status: "failed",
        exit_code: 1,
        output: "byte 1, line 1",
        duration_ms: 0,
      }],
    );

    assert.equal(hints.length, 1);
    assert.match(hints[0]!, /content_equality_failed/);
    assert.match(hints[0]!, /prefer <RENAME>/);
    assert.doesNotMatch(hints[0]!, /old\.ts \| cmp/);
  });

  it("formats semantic hints as a repair prompt block", () => {
    const block = formatSemanticRepairHints(["file_exists_failed: ensure src/new.ts exists."]);

    assert.match(block ?? "", /SEMANTIC REPAIR HINTS/);
    assert.match(block ?? "", /file_exists_failed/);
  });
});

describe("failedAssertionTargetFiles", () => {
  it("extracts unique file targets from failed structured file assertions", () => {
    const assertions: VerifyAssertion[] = [
      { type: "file_contains", file: "src/anthropic.ts", pattern: "withRetry" },
      { type: "shell", command: "pnpm test", name: "tests" },
      { type: "file_contains", file: "src/openai.ts", pattern: "buildAuthHeaders" },
      { type: "file_contains", file: "src/anthropic.ts", pattern: "withRetry" },
    ];
    const results = [
      {
        command: "file_contains src/anthropic.ts",
        status: "failed" as const,
        exit_code: 1,
        output: "missing",
        duration_ms: 0,
      },
      {
        command: "tests",
        status: "failed" as const,
        exit_code: 1,
        output: "test failed",
        duration_ms: 0,
      },
      {
        command: "file_contains src/openai.ts",
        status: "passed" as const,
        exit_code: 0,
        output: "ok",
        duration_ms: 0,
      },
      {
        command: "file_contains src/anthropic.ts",
        status: "failed" as const,
        exit_code: 1,
        output: "missing",
        duration_ms: 0,
      },
    ];

    assert.deepEqual(failedAssertionTargetFiles(assertions, results), ["src/anthropic.ts"]);
  });
});
