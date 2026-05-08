import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runAssertion, runVerifyAssertions, parseAssertion, type VerifyAssertion } from "./verifier.js";

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
