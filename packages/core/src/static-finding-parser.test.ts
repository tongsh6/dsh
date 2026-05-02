import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  eslintParser,
  tscParser,
  sarifParser,
  semgrepParser,
  fallbackParser,
  resolveParser,
  parseFindings,
} from "./static-finding-parser.js";

// ── ESLint ──

describe("eslintParser", () => {
  it("detects ESLint stylish output", () => {
    assert.ok(eslintParser.canParse("  10:5  error  Missing await  @typescript-eslint/no-floating-promises"));
    assert.ok(eslintParser.canParse("  1:1  warning  console.log  no-console"));
  });

  it("rejects non-ESLint output", () => {
    assert.ok(!eslintParser.canParse("src/foo.ts(10,5): error TS2322: Type 'string'"));
    assert.ok(!eslintParser.canParse("clean"));
    assert.ok(!eslintParser.canParse(""));
  });

  it("parses ESLint stylish output", () => {
    const output = [
      "/repo/src/index.ts",
      "  10:5  error    Missing await        @typescript-eslint/no-floating-promises",
      "  12:1  warning  Unexpected console   no-console",
      "  15:3  info     File is too long     max-lines",
    ].join("\n");

    const findings = eslintParser.parse(output, "/repo", 2);

    assert.equal(findings.length, 3);

    const f1 = findings[0]!;
    assert.equal(f1.id, "S2-1");
    assert.equal(f1.scanner, "eslint");
    assert.equal(f1.file, "src/index.ts");
    assert.equal(f1.line, 10);
    assert.equal(f1.column, 5);
    assert.equal(f1.severity, "error");
    assert.equal(f1.rule, "@typescript-eslint/no-floating-promises");
    assert.ok(f1.message.includes("Missing await"));

    const f2 = findings[1]!;
    assert.equal(f2.severity, "warning");

    const f3 = findings[2]!;
    assert.equal(f3.severity, "info");
  });

  it("infers security category from rule name", () => {
    const output = [
      "/repo/src/auth.ts",
      "  5:10  error  Possible SQL injection  security/detect-sql-injection",
    ].join("\n");

    const findings = eslintParser.parse(output, "/repo", 1);
    assert.equal(findings[0]!.category, "security");
  });

  it("returns empty for ESLint output with no findings", () => {
    const findings = eslintParser.parse(
      "/repo/src/index.ts\n\n",
      "/repo",
      1,
    );
    assert.equal(findings.length, 0);
  });
});

// ── TypeScript Diagnostics ──

describe("tscParser", () => {
  it("detects tsc diagnostic output", () => {
    assert.ok(tscParser.canParse("src/index.ts(4,9): error TS2322: Type 'string' is not assignable to type 'number'."));
    assert.ok(tscParser.canParse("lib/utils.ts(10,3): warning TS6133: 'x' is declared but never used."));
  });

  it("rejects non-tsc output", () => {
    assert.ok(!tscParser.canParse("  10:5  error  Missing await  rule/name"));
    assert.ok(!tscParser.canParse("clean"));
  });

  it("parses TypeScript compiler diagnostics", () => {
    const output = [
      "src/index.ts(4,9): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/utils.ts(10,3): warning TS6133: 'x' is declared but its value is never read.",
    ].join("\n");

    const findings = tscParser.parse(output, "/repo", 1);

    assert.equal(findings.length, 2);

    assert.equal(findings[0]!.scanner, "tsc");
    assert.equal(findings[0]!.file, "src/index.ts");
    assert.equal(findings[0]!.line, 4);
    assert.equal(findings[0]!.column, 9);
    assert.equal(findings[0]!.severity, "error");
    assert.equal(findings[0]!.rule, "TS2322");
    assert.equal(findings[0]!.category, "type");

    assert.equal(findings[1]!.severity, "warning");
    assert.equal(findings[1]!.category, "style");
  });

  it("normalizes absolute paths to relative", () => {
    const findings = tscParser.parse(
      "/repo/src/foo.ts(1,1): error TS1234: Bad.",
      "/repo",
      1,
    );
    assert.equal(findings[0]!.file, "src/foo.ts");
  });
});

// ── SARIF ──

describe("sarifParser", () => {
  it("detects SARIF v2.1.0 output", () => {
    const sarif = JSON.stringify({ version: "2.1.0", runs: [] });
    assert.ok(sarifParser.canParse(sarif));
  });

  it("detects SARIF v2.x output", () => {
    const sarif = JSON.stringify({ version: "2.3.0", runs: [] });
    assert.ok(sarifParser.canParse(sarif));
  });

  it("rejects non-JSON and non-SARIF JSON", () => {
    assert.ok(!sarifParser.canParse("not json"));
    assert.ok(!sarifParser.canParse("  10:5  error  Missing await"));
    assert.ok(!sarifParser.canParse(JSON.stringify({ foo: "bar" })));
  });

  it("parses CodeQL SARIF output", () => {
    const sarif = JSON.stringify({
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: { driver: { name: "CodeQL" } },
          results: [
            {
              ruleId: "js/sql-injection",
              level: "error",
              message: { text: "Untrusted data is used to construct a SQL query." },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/db/query.ts" },
                    region: { startLine: 42, startColumn: 15 },
                  },
                },
              ],
            },
            {
              ruleId: "js/unused-variable",
              level: "warning",
              message: { text: "Variable 'x' is never used." },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/utils/helper.ts" },
                    region: { startLine: 10 },
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const findings = sarifParser.parse(sarif, "/repo", 1);

    assert.equal(findings.length, 2);

    assert.equal(findings[0]!.scanner, "codeql");
    assert.equal(findings[0]!.file, "src/db/query.ts");
    assert.equal(findings[0]!.line, 42);
    assert.equal(findings[0]!.column, 15);
    assert.equal(findings[0]!.severity, "error");
    assert.equal(findings[0]!.rule, "js/sql-injection");
    assert.equal(findings[0]!.category, "security");
    assert.ok(findings[0]!.message.includes("SQL query"));

    assert.equal(findings[1]!.scanner, "codeql");
    assert.equal(findings[1]!.severity, "warning");
  });

  it("parses Gitleaks SARIF output", () => {
    const sarif = JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "Gitleaks" } },
          results: [
            {
              ruleId: "generic-api-key",
              level: "error",
              message: { text: "Found a generic API key in src/config.ts" },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/config.ts" },
                    region: { startLine: 5, startColumn: 20 },
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const findings = sarifParser.parse(sarif, "/repo", 3);

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.scanner, "gitleaks");
    assert.equal(findings[0]!.category, "secret");
    assert.equal(findings[0]!.rule, "generic-api-key");
    assert.ok(findings[0]!.raw, "raw data preserved for audit trail");
  });

  it("maps SARIF levels to dsh severity", () => {
    const tests: [string, string][] = [
      ["error", "error"],
      ["warning", "warning"],
      ["note", "info"],
      ["none", "error"],
    ];

    for (const [sarifLevel, expected] of tests) {
      const sarif = JSON.stringify({
        version: "2.1.0",
        runs: [
          {
            tool: { driver: { name: "TestTool" } },
            results: [
              {
                ruleId: "test-rule",
                level: sarifLevel,
                message: { text: "test" },
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: "file.ts" },
                      region: { startLine: 1 },
                    },
                  },
                ],
              },
            ],
          },
        ],
      });

      const findings = sarifParser.parse(sarif, "/repo", 1);
      assert.equal(findings[0]!.severity, expected, `SARIF "${sarifLevel}" should map to "${expected}"`);
    }
  });

  it("handles missing locations gracefully", () => {
    const sarif = JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "CodeQL" } },
          results: [
            {
              ruleId: "test-rule",
              message: { text: "A finding without a location" },
            },
          ],
        },
      ],
    });

    const findings = sarifParser.parse(sarif, "/repo", 1);

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.file, "<unknown>");
    assert.equal(findings[0]!.line, null);
    assert.equal(findings[0]!.column, null);
  });
});

// ── Semgrep JSON ──

describe("semgrepParser", () => {
  it("detects Semgrep JSON output", () => {
    const output = JSON.stringify({
      results: [
        { check_id: "test-rule", path: "src/foo.ts", start: { line: 1, col: 1 }, extra: { severity: "ERROR", message: "test" } },
      ],
    });
    assert.ok(semgrepParser.canParse(output));
  });

  it("detects Semgrep JSON with empty results", () => {
    // Semgrep empty output includes `errors` and `paths` alongside `results`
    const output = JSON.stringify({ results: [], errors: [], paths: {} });
    assert.ok(semgrepParser.canParse(output));
  });

  it("rejects JSON with empty results but no Semgrep-specific keys", () => {
    // Arbitrary JSON with results:[] should not be misidentified
    const output = JSON.stringify({ results: [] });
    assert.ok(!semgrepParser.canParse(output));
  });

  it("rejects non-JSON and SARIF output", () => {
    assert.ok(!semgrepParser.canParse("not json"));
    assert.ok(!semgrepParser.canParse("  10:5  error  Missing await  rule/name"));
    // SARIF has `runs` not `results`, but also has a version field.
    // The key check: results must have `check_id`, SARIF results have `ruleId`.
    const sarif = JSON.stringify({
      version: "2.1.0",
      runs: [{ results: [{ ruleId: "js/test", message: { text: "test" } }] }],
    });
    assert.ok(!semgrepParser.canParse(sarif));
  });

  it("rejects JSON without check_id in results", () => {
    const output = JSON.stringify({
      results: [{ path: "src/foo.ts", extra: { message: "no check_id here" } }],
    });
    assert.ok(!semgrepParser.canParse(output));
  });

  it("parses Semgrep JSON output", () => {
    const output = JSON.stringify({
      results: [
        {
          check_id: "yaml.github-actions.security.run-shell-injection.run-shell-injection",
          path: ".github/workflows/deploy.yml",
          start: { line: 18, col: 9, offset: 300 },
          end: { line: 18, col: 82, offset: 373 },
          extra: {
            message: "Using variable interpolation with github context data in a run step",
            severity: "ERROR",
            metadata: { category: "security", cwe: ["CWE-78"] },
            lines: "      - run: echo \"${{ inputs.box_ticked }}\"",
          },
        },
        {
          check_id: "python.lang.best-practice.unused-import.unused-import",
          path: "src/main.py",
          start: { line: 3, col: 1 },
          end: { line: 3, col: 25 },
          extra: { message: "Unused import 'os'", severity: "WARNING" },
        },
        {
          check_id: "javascript.lang.style.console-log.console-log",
          path: "src/app.ts",
          start: { line: 10, col: 5 },
          end: { line: 10, col: 25 },
          extra: { message: "console.log found", severity: "INFO" },
        },
      ],
    });

    const findings = semgrepParser.parse(output, "/repo", 1);

    assert.equal(findings.length, 3);

    assert.equal(findings[0]!.scanner, "semgrep");
    assert.equal(findings[0]!.file, ".github/workflows/deploy.yml");
    assert.equal(findings[0]!.line, 18);
    assert.equal(findings[0]!.column, 9);
    assert.equal(findings[0]!.severity, "error");
    assert.equal(findings[0]!.rule, "yaml.github-actions.security.run-shell-injection.run-shell-injection");
    assert.equal(findings[0]!.category, "security");
    assert.ok(findings[0]!.message.includes("variable interpolation"));
    assert.ok(findings[0]!.raw, "raw data preserved");

    assert.equal(findings[1]!.severity, "warning");
    assert.equal(findings[2]!.severity, "info");
  });

  it("handles missing optional fields gracefully", () => {
    const output = JSON.stringify({
      results: [
        {
          check_id: "minimal-rule",
          extra: { message: "A minimal finding with no location" },
        },
      ],
    });

    const findings = semgrepParser.parse(output, "/repo", 1);

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.file, "<unknown>");
    assert.equal(findings[0]!.line, null);
    assert.equal(findings[0]!.column, null);
    assert.equal(findings[0]!.severity, "error"); // default
    assert.equal(findings[0]!.rule, "minimal-rule");
  });

  it("returns empty for Semgrep output with no findings", () => {
    const output = JSON.stringify({ results: [], errors: [], paths: {} });
    const findings = semgrepParser.parse(output, "/repo", 1);
    assert.equal(findings.length, 0);
  });

  it("maps Semgrep severity levels correctly", () => {
    const tests: [string, string][] = [
      ["CRITICAL", "critical"],
      ["HIGH", "high"],
      ["ERROR", "error"],
      ["MEDIUM", "medium"],
      ["WARNING", "warning"],
      ["LOW", "low"],
      ["INFO", "info"],
      ["NOTE", "info"],
    ];

    for (const [semgrepLevel, expected] of tests) {
      const output = JSON.stringify({
        results: [
          {
            check_id: "test-rule",
            path: "file.ts",
            start: { line: 1, col: 1 },
            extra: { severity: semgrepLevel, message: "test" },
          },
        ],
      });

      const findings = semgrepParser.parse(output, "/repo", 1);
      assert.equal(
        findings[0]!.severity,
        expected,
        `Semgrep "${semgrepLevel}" should map to "${expected}"`,
      );
    }
  });

  it("infers category from check_id keywords", () => {
    const output = JSON.stringify({
      results: [
        {
          check_id: "java.lang.security.audit.xss.xss-injection",
          path: "file.java",
          start: { line: 1, col: 1 },
          extra: { severity: "ERROR", message: "XSS vulnerability" },
        },
      ],
    });

    const findings = semgrepParser.parse(output, "/repo", 1);
    assert.equal(findings[0]!.category, "security");
  });

  it("infers category from metadata.category", () => {
    const output = JSON.stringify({
      results: [
        {
          check_id: "python.some-rule",
          path: "file.py",
          start: { line: 1, col: 1 },
          extra: {
            severity: "ERROR",
            message: "Test",
            metadata: { category: "best-practice" },
          },
        },
      ],
    });

    const findings = semgrepParser.parse(output, "/repo", 1);
    assert.equal(findings[0]!.category, "style");
  });
});

// ── Fallback ──

describe("fallbackParser", () => {
  it("matches any input", () => {
    assert.ok(fallbackParser.canParse("anything"));
    assert.ok(fallbackParser.canParse(""));
  });

  it("returns empty for blank output", () => {
    const findings = fallbackParser.parse("", "/repo", 1);
    assert.equal(findings.length, 0);
  });

  it("returns empty for whitespace-only output", () => {
    const findings = fallbackParser.parse("  \n  \n  ", "/repo", 1);
    assert.equal(findings.length, 0);
  });

  it("wraps unrecognized output into a single generic finding", () => {
    const findings = fallbackParser.parse("some unrecognized scanner output", "/repo", 1);

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.scanner, "generic");
    assert.equal(findings[0]!.file, "<project>");
    assert.equal(findings[0]!.severity, "error");
    assert.equal(findings[0]!.category, "unknown");
    assert.equal(findings[0]!.rule, null);
  });

  it("truncates very long output in message", () => {
    const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const findings = fallbackParser.parse(long, "/repo", 1);
    assert.ok(findings[0]!.message.split("\n").length <= 12);
  });
});

// ── Parser Resolution ──

describe("resolveParser", () => {
  it("picks ESLint parser for stylish output", () => {
    const parser = resolveParser("  5:1  error  Bad thing  rule/name");
    assert.equal(parser.name, "eslint-stylish");
  });

  it("picks tsc parser for diagnostic output", () => {
    const parser = resolveParser("src/foo.ts(1,1): error TS1234: Bad.");
    assert.equal(parser.name, "tsc-diagnostics");
  });

  it("picks SARIF parser for valid SARIF JSON", () => {
    const parser = resolveParser(JSON.stringify({ version: "2.1.0", runs: [] }));
    assert.equal(parser.name, "sarif");
  });

  it("picks Semgrep parser for Semgrep JSON output", () => {
    const output = JSON.stringify({
      results: [{ check_id: "test-rule", path: "file.ts", start: { line: 1, col: 1 }, extra: { severity: "ERROR", message: "test" } }],
    });
    const parser = resolveParser(output);
    assert.equal(parser.name, "semgrep-json");
  });

  it("falls back for unrecognized output", () => {
    const parser = resolveParser("unrecognized output format");
    assert.equal(parser.name, "text-fallback");
  });
});

// ── End-to-End parseFindings ──

describe("parseFindings", () => {
  it("parses ESLint output end-to-end", () => {
    const output = [
      "/repo/src/main.ts",
      "  3:1  error    Missing return type  @typescript-eslint/explicit-return-type",
    ].join("\n");

    const findings = parseFindings(output, "/repo", 5);

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.id, "S5-1");
    assert.equal(findings[0]!.scanner, "eslint");
    assert.equal(findings[0]!.severity, "error");
  });

  it("parses SARIF end-to-end", () => {
    const sarif = JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "CodeQL" } },
          results: [
            {
              ruleId: "js/xss",
              level: "error",
              message: { text: "XSS vulnerability" },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/views/render.ts" },
                    region: { startLine: 20, startColumn: 8 },
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    const findings = parseFindings(sarif, "/repo", 1);

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.scanner, "codeql");
    assert.equal(findings[0]!.category, "security");
    assert.equal(findings[0]!.rule, "js/xss");
  });

  it("parses Semgrep end-to-end", () => {
    const output = JSON.stringify({
      results: [
        {
          check_id: "python.lang.best-practice.unused-import.unused-import",
          path: "src/util.py",
          start: { line: 42, col: 3 },
          end: { line: 42, col: 20 },
          extra: {
            message: "Unused import detected",
            severity: "WARNING",
            metadata: { category: "best-practice" },
          },
        },
      ],
    });

    const findings = parseFindings(output, "/repo", 1);

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.scanner, "semgrep");
    assert.equal(findings[0]!.category, "style");
    assert.equal(findings[0]!.rule, "python.lang.best-practice.unused-import.unused-import");
  });

  it("falls back to generic for unrecognized output", () => {
    const findings = parseFindings("some weird scanner text", "/repo", 1);

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.scanner, "generic");
  });

  it("returns empty array for empty output", () => {
    const findings = parseFindings("", "/repo", 1);
    assert.equal(findings.length, 0);
  });
});

// ── Backward Compatibility ──

describe("backward compatibility", () => {
  it("findings include scanner and category fields", () => {
    // Old code might access .scanner or .category — ensure they exist
    const findings = eslintParser.parse(
      "/repo/src/foo.ts\n  1:1  error  Bad  test/rule",
      "/repo",
      1,
    );

    for (const f of findings) {
      assert.ok(typeof f.scanner === "string", "scanner must be a string");
      assert.ok(typeof f.category === "string", "category must be a string");
      assert.ok(
        ["bug", "type", "style", "security", "secret", "dependency", "unknown"].includes(f.category),
        `category must be valid: ${f.category}`,
      );
    }
  });

  it("severity values are compatible with old error/warning/info enum", () => {
    const oldValues = ["error", "warning", "info"];
    // All old severity values should appear in new findings parsed from old-style output
    const output = [
      "/repo/src/foo.ts",
      "  1:1  error    Bad       test/rule",
      "  2:1  warning  Warn      test/warn",
      "  3:1  info     Note      test/note",
    ].join("\n");

    const findings = eslintParser.parse(output, "/repo", 1);
    assert.equal(findings.length, 3);

    for (let i = 0; i < oldValues.length; i++) {
      assert.equal(findings[i]!.severity, oldValues[i],
        `parsed severity "${findings[i]!.severity}" should match old value "${oldValues[i]}"`);
    }
  });
});
