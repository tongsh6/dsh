import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStaticScanFindings, resolveStaticScanConfig } from "./static-scanner.js";

describe("resolveStaticScanConfig", () => {
  it("uses explicit static scan config when present", () => {
    const config = resolveStaticScanConfig({
      verify: { lint: "pnpm lint" },
      static_scan: { enabled: true, command: "pnpm scan:static", top_n: 3 },
    });

    assert.equal(config.enabled, true);
    assert.equal(config.command, "pnpm scan:static");
    assert.equal(config.topNConfig.topN, 3);
  });

  it("falls back to verify lint command", () => {
    const config = resolveStaticScanConfig({
      verify: { lint: "pnpm lint" },
    });

    assert.equal(config.command, "pnpm lint");
    assert.equal(config.topNConfig.topN, 5);
  });
});

describe("parseStaticScanFindings", () => {
  it("parses ESLint stylish output", () => {
    const output = [
      "/repo/src/index.ts",
      "  10:5  error    Missing await        @typescript-eslint/no-floating-promises",
      "  12:1  warning  Unexpected console   no-console",
    ].join("\n");

    const findings = parseStaticScanFindings(output, "/repo", 2);

    assert.equal(findings.length, 2);
    assert.equal(findings[0]!.id, "S2-1");
    assert.equal(findings[0]!.file, "src/index.ts");
    assert.equal(findings[0]!.line, 10);
    assert.equal(findings[0]!.severity, "error");
    assert.equal(findings[0]!.rule, "@typescript-eslint/no-floating-promises");
  });

  it("parses TypeScript compiler diagnostics", () => {
    const findings = parseStaticScanFindings(
      "src/index.ts(4,9): error TS2322: Type 'string' is not assignable to type 'number'.",
      "/repo",
      1,
    );

    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.file, "src/index.ts");
    assert.equal(findings[0]!.rule, "TS2322");
  });
});
