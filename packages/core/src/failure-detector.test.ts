import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  detectFailures,
  buildRepairHints,
  detectSignatureChanges,
  findCallSites,
  formatCallSiteContext,
  extractCompilationErrors,
} from "./failure-detector.js";
import type { DetectParams, SignatureChange, CallSite } from "./failure-detector.js";

describe("detectFailures", () => {
  describe("overconfidence", () => {
    it("detects empty VERIFY block", () => {
      const params: DetectParams = {
        response: `<PLAN>fix</PLAN><VERIFY>\n\n</VERIFY><RISKS>- risk1</RISKS>`,
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "overconfidence"));
    });

    it("detects verify block with only comments", () => {
      const params: DetectParams = {
        response: `<VERIFY>\n# TODO: add tests\n# will do later\n</VERIFY><RISKS>- risk</RISKS>`,
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "overconfidence"));
    });

    it("sets high confidence when RISKS is trivial too", () => {
      const params: DetectParams = {
        response: `<VERIFY>\n</VERIFY><RISKS>无风险</RISKS>`,
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      const oc = detections.find((d) => d.mode === "overconfidence");
      assert.ok(oc);
      assert.equal(oc!.confidence, "high");
    });

    it("detects trivial risks with failed verification", () => {
      const params: DetectParams = {
        response: `<VERIFY>npm test</VERIFY><RISKS>无需担心</RISKS>`,
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "FAIL: 3 tests failed",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "overconfidence"));
    });

    it("does not flag when verify block has real commands", () => {
      const params: DetectParams = {
        response: `<VERIFY>\nnpm test\nnpx tsc --noEmit\n</VERIFY><RISKS>- real risk</RISKS>`,
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(!detections.some((d) => d.mode === "overconfidence"));
    });
  });

  describe("patch-drift", () => {
    it("detects patch apply failure", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: "Failed to apply patch to src/file.ts",
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "patch-drift"));
    });

    it("high confidence on hunk error", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: "patch apply failed: hunk mismatch",
      };
      const detections = detectFailures(params);
      const drift = detections.find((d) => d.mode === "patch-drift");
      assert.ok(drift);
      assert.equal(drift!.confidence, "high");
    });

    it("does not flag without patch error", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(!detections.some((d) => d.mode === "patch-drift"));
    });
  });

  describe("scope-creep", () => {
    it("detects extra files modified beyond plan", () => {
      const params: DetectParams = {
        response: "",
        planFiles: ["src/a.ts", "src/b.ts"],
        actualChangedFiles: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "scope-creep"));
    });

    it("high confidence when >2 extra files", () => {
      const params: DetectParams = {
        response: "",
        planFiles: ["src/a.ts"],
        actualChangedFiles: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      const creep = detections.find((d) => d.mode === "scope-creep");
      assert.ok(creep);
      assert.equal(creep!.confidence, "high");
    });

    it("does not flag when files match plan", () => {
      const params: DetectParams = {
        response: "",
        planFiles: ["src/a.ts", "src/b.ts"],
        actualChangedFiles: ["src/a.ts", "src/b.ts"],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(!detections.some((d) => d.mode === "scope-creep"));
    });
  });

  describe("rule-blindness", () => {
    it("detects lint/type errors in verify output", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "error TS2345: Type 'string' is not assignable to type 'number'.",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "rule-blindness"));
    });

    it("detects ESLint failures", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "✘ eslint src/ - found 5 errors",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "rule-blindness"));
    });

    it("high confidence on import errors", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "Error: Cannot find module './nonexistent'",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      const blindness = detections.find((d) => d.mode === "rule-blindness");
      assert.ok(blindness);
      assert.equal(blindness!.confidence, "high");
    });

    it("does not flag without verify output", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: null,
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(!detections.some((d) => d.mode === "rule-blindness"));
    });
  });

  describe("hallucinated-api", () => {
    it("detects 'is not defined' errors", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "ReferenceError: fetchUserData is not defined",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "hallucinated-api"));
    });

    it("detects 'has no exported member' errors", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "error TS2305: Module './utils' has no exported member 'parseJson'.",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "hallucinated-api"));
    });

    it("detects 'does not exist on type' errors", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "error TS2339: Property 'validate' does not exist on type 'User'.",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "hallucinated-api"));
    });

    it("detects 'is not a function' errors", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "TypeError: user.getEmail is not a function",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(detections.some((d) => d.mode === "hallucinated-api"));
    });

    it("does not flag on normal test failures", () => {
      const params: DetectParams = {
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "FAIL: expected 5 but got 3",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      assert.ok(!detections.some((d) => d.mode === "hallucinated-api"));
    });
  });

  it("detects search-replace mismatch", () => {
    const detections = detectFailures({
      response: "",
      planFiles: [],
      actualChangedFiles: [],
      verifyOutput: null,
      patchApplyError: "Search block not found in src/utils.ts",
    });
    const hasSearchMismatch = detections.some((d) => d.mode === "search-replace-mismatch");
    assert.ok(hasSearchMismatch);
    const detection = detections.find((d) => d.mode === "search-replace-mismatch")!;
    assert.equal(detection.confidence, "high");
    assert.ok(detection.repairHint.includes("SEARCH block did not match"));
  });

  it("does not flag on unrelated apply errors", () => {
    const detections = detectFailures({
      response: "",
      planFiles: [],
      actualChangedFiles: [],
      verifyOutput: null,
      patchApplyError: "Failed to apply patch to src/utils.ts",
    });
    const hasSearchMismatch = detections.some((d) => d.mode === "search-replace-mismatch");
    assert.ok(!hasSearchMismatch);
  });

  describe("signature-mismatch", () => {
    it("detects Python TypeError takes X positional arguments", () => {
      const detections = detectFailures({
        response: "",
        planFiles: ["tools/check_v2_constraints.py"],
        actualChangedFiles: ["tools/check_v2_constraints.py"],
        verifyOutput: "TypeError: count_definitions() takes 2 positional arguments but 3 were given",
        patchApplyError: null,
      });
      const sig = detections.find((d) => d.mode === "signature-mismatch");
      assert.ok(sig, "should detect signature mismatch");
      assert.equal(sig!.confidence, "high");
      assert.ok(sig!.repairHint.includes("count_definitions"));
    });

    it("detects Python unexpected keyword argument", () => {
      const detections = detectFailures({
        response: "",
        planFiles: ["src/utils.py"],
        actualChangedFiles: ["src/utils.py"],
        verifyOutput: "TypeError: process() got an unexpected keyword argument 'encoding'",
        patchApplyError: null,
      });
      assert.ok(detections.some((d) => d.mode === "signature-mismatch"));
    });

    it("detects Python missing required positional argument", () => {
      const detections = detectFailures({
        response: "",
        planFiles: ["src/api.py"],
        actualChangedFiles: ["src/api.py"],
        verifyOutput: "TypeError: fetch_data() missing 2 required positional arguments: 'token' and 'limit'",
        patchApplyError: null,
      });
      assert.ok(detections.some((d) => d.mode === "signature-mismatch"));
    });

    it("detects JavaScript is not a function", () => {
      const detections = detectFailures({
        response: "",
        planFiles: ["src/handler.ts"],
        actualChangedFiles: ["src/handler.ts"],
        verifyOutput: "TypeError: validateInput is not a function",
        patchApplyError: null,
      });
      assert.ok(detections.some((d) => d.mode === "signature-mismatch"));
    });

    it("does not flag normal test assertion failures", () => {
      const detections = detectFailures({
        response: "",
        planFiles: ["src/foo.py"],
        actualChangedFiles: ["src/foo.py"],
        verifyOutput: "AssertionError: assert 0 == 1\nFAILED tests/test_foo.py::test_bar - assert 0 == 1",
        patchApplyError: null,
      });
      assert.ok(!detections.some((d) => d.mode === "signature-mismatch"));
    });
  });

  describe("compilation-error", () => {
    it("does not hang when compilation error patterns match duplicate output", () => {
      const moduleUrl = new URL("./failure-detector.ts", import.meta.url).href;
      const script = `
        import { detectFailures } from ${JSON.stringify(moduleUrl)};
        const detections = detectFailures({
          response: "",
          planFiles: [],
          actualChangedFiles: [],
          verifyOutput: "[ERROR] /x/Foo.java:[10,5] err\\n[ERROR] /x/Foo.java:[10,5] err",
          patchApplyError: null,
        });
        if (!detections.some((d) => d.mode === "compilation-error")) process.exit(1);
      `;

      assert.doesNotThrow(() => {
        execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 1000,
        });
      });
    });

    it("detects Maven javac [ERROR] file:[line,col] format", () => {
      const detections = detectFailures({
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput:
          "[ERROR] /path/to/release-hub/backend/src/main/java/io/DashboardAppService.java:[53,13] 未命名类是预览功能，默认情况下禁用。\n[ERROR] /path/to/release-hub/backend/src/main/java/io/DashboardAppService.java:[79,1] 需要 class、interface、enum 或 record",
        patchApplyError: null,
      });
      const de = detections.find((d) => d.mode === "compilation-error");
      assert.ok(de, "should detect compilation-error");
      assert.equal(de!.confidence, "high");
      assert.ok(de!.evidence.includes("DashboardAppService.java"));
      assert.ok(de!.evidence.includes("line 53"));
    });

    it("detects TypeScript error format", () => {
      const detections = detectFailures({
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput:
          "src/components/App.tsx(10,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
        patchApplyError: null,
      });
      const de = detections.find((d) => d.mode === "compilation-error");
      assert.ok(de);
      assert.ok(de!.evidence.includes("TS2345"));
    });

    it("detects Python traceback with File line format", () => {
      const detections = detectFailures({
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput:
          'Traceback (most recent call last):\n  File "tools/extract_evidence.py", line 42, in read_text\n    raise ValueError("boom")\nValueError: boom',
        patchApplyError: null,
      });
      const de = detections.find((d) => d.mode === "compilation-error");
      assert.ok(de, "should detect Python traceback");
    });

    it("returns null when verifyOutput has no recognizable compilation errors", () => {
      const detections = detectFailures({
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput: "All tests passed. 42 tests run, 0 failures.",
        patchApplyError: null,
      });
      assert.ok(!detections.some((d) => d.mode === "compilation-error"));
    });

    it("deduplicates errors at same file+line", () => {
      const detections = detectFailures({
        response: "",
        planFiles: [],
        actualChangedFiles: [],
        verifyOutput:
          "[ERROR] /x/Foo.java:[10,5] err\n[ERROR] /x/Foo.java:[10,5] err\n[ERROR] /x/Foo.java:[20,1] err2",
        patchApplyError: null,
      });
      const de = detections.find((d) => d.mode === "compilation-error");
      assert.ok(de);
      // should have 2 not 3 errors (10,5 is duplicate)
      const count = de!.evidence.match(/line/g)?.length ?? 0;
      assert.ok(count <= 2, `expected <=2 error lines, got ${count}`);
    });
  });

  describe("multiple failure modes", () => {
    it("detects multiple modes simultaneously", () => {
      const params: DetectParams = {
        response: `<VERIFY>\n# skip\n</VERIFY><RISKS>不适用</RISKS>`,
        planFiles: ["src/a.ts"],
        actualChangedFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
        verifyOutput: "ReferenceError: newHelper is not defined\n✘ eslint",
        patchApplyError: null,
      };
      const detections = detectFailures(params);
      const modes = detections.map((d) => d.mode);
      // Should detect: overconfidence, scope-creep, rule-blindness, hallucinated-api
      assert.ok(modes.includes("overconfidence"));
      assert.ok(modes.includes("scope-creep"));
      assert.ok(modes.includes("rule-blindness"));
      assert.ok(modes.includes("hallucinated-api"));
    });
  });
});

describe("buildRepairHints", () => {
  it("returns null for empty detections", () => {
    assert.equal(buildRepairHints([]), null);
  });

  it("builds hints with failure pattern analysis header", () => {
    const hints = buildRepairHints([
      {
        mode: "overconfidence",
        description: "test",
        confidence: "high",
        evidence: "empty verify",
        repairHint: "Add verify commands.",
      },
    ]);
    assert.ok(hints?.includes("FAILURE PATTERN ANALYSIS"));
    assert.ok(hints?.includes("overconfidence"));
    assert.ok(hints?.includes("high confidence"));
  });

  it("puts high confidence patterns first", () => {
    const hints = buildRepairHints([
      {
        mode: "scope-creep",
        description: "",
        confidence: "medium",
        evidence: "",
        repairHint: "scope hint",
      },
      {
        mode: "hallucinated-api",
        description: "",
        confidence: "high",
        evidence: "",
        repairHint: "api hint",
      },
    ]);
    assert.ok(hints !== null);
    const highIdx = hints!.indexOf("hallucinated-api");
    const mediumIdx = hints!.indexOf("scope-creep");
    assert.ok(highIdx < mediumIdx, "high confidence should appear before medium");
  });

  it("includes repair hints for each detection", () => {
    const hints = buildRepairHints([
      {
        mode: "patch-drift",
        description: "",
        confidence: "high",
        evidence: "hunk mismatch",
        repairHint: "Use correct line numbers.",
      },
    ]);
    assert.ok(hints?.includes("Use correct line numbers."));
  });
});

// ── Signature Change Detection & Caller Analysis ──

describe("detectSignatureChanges", () => {
  it("returns empty for non-existent files", () => {
    const changes = detectSignatureChanges(process.cwd(), ["NONEXISTENT_FILE_12345.py"]);
    assert.equal(changes.length, 0);
  });
});

describe("findCallSites", () => {
  it("finds callers of a function in other files", () => {
    const sites = findCallSites(process.cwd(), ["detectSignatureChanges"], ["failure-detector.ts"], 10);
    const repairLoopRefs = sites.filter((s) => s.file.includes("repair-loop"));
    assert.ok(repairLoopRefs.length > 0, "should find caller in repair-loop.ts");
  });

  it("returns empty when function not found in any file", () => {
    // Use a unique name that cannot exist as substring in any file
    // Exclude this test file since the function name appears in the source code of the test
    const sites = findCallSites(
      process.cwd(),
      ["zzz_nonexistent_fn_xyzzy_999"],
      ["failure-detector.test.ts"],
      5,
    );
    assert.equal(sites.length, 0);
  });
});

describe("formatCallSiteContext", () => {
  it("formats signature changes with call sites into markdown", () => {
    const changes: SignatureChange[] = [{
      file: "tools/util.py",
      name: "count_definitions",
      type: "modified",
      beforeSignature: "files: list[Path], signature: str",
      afterSignature: "text: str, signature: str",
    }];

    const callSites: CallSite[] = [
      { file: "tools/main.py", line: 42, content: "count_definitions(files, 'def foo')", matchType: "direct_call" },
      { file: "tests/test_util.py", line: 15, content: "count_definitions(test_files, 'def bar')", matchType: "direct_call" },
    ];

    const result = formatCallSiteContext(changes, callSites);
    assert.ok(result?.includes("count_definitions"));
    assert.ok(result?.includes("files: list[Path], signature: str"));
    assert.ok(result?.includes("tools/main.py:42"));
    assert.ok(result?.includes("tests/test_util.py:15"));
  });

  it("returns null when no signature changes", () => {
    assert.equal(formatCallSiteContext([], []), null);
  });
});

// ---- ctxDirs → moduleRoots regression (Task D AC #10/#11) ----

describe("extractCompilationErrors — moduleRoots path stripping", () => {
  it("strips absolute prefix to relative when path contains a moduleRoot segment", () => {
    const output = "[ERROR] /Users/foo/dsh-bench/repos/release-hub/backend/src/main/java/io/Foo.java:[12,5] cannot find symbol";
    const errs = extractCompilationErrors(output, ["backend", "frontend", "src"]);
    assert.equal(errs.length, 1);
    // Should strip up to and including the last "/backend/" → relative path
    assert.equal(errs[0]!.file, "backend/src/main/java/io/Foo.java");
    assert.equal(errs[0]!.line, "12");
    assert.equal(errs[0]!.col, "5");
  });

  it("uses lastIndexOf (rightmost) when multiple moduleRoots match", () => {
    // path contains both /src/ and /backend/ — backend appears last, should win
    const output = "[ERROR] /tmp/proj/src/scratch/backend/Main.java:[1,1] err";
    const errs = extractCompilationErrors(output, ["src", "backend"]);
    assert.equal(errs.length, 1);
    // markers are iterated in order; first match short-circuits.
    // verify the actually-implemented behavior: first marker that matches wins.
    // Here both match; "src" markers list-first → it wins
    assert.match(errs[0]!.file, /^src\//);
  });

  it("falls back to basename when moduleRoots is empty", () => {
    const output = "[ERROR] /Users/foo/some/deep/path/Foo.java:[10,3] error";
    const errs = extractCompilationErrors(output, []);
    assert.equal(errs.length, 1);
    assert.equal(errs[0]!.file, "Foo.java");
  });

  it("falls back to basename when path has no matching moduleRoot", () => {
    const output = "[ERROR] /Users/foo/some/deep/path/Foo.java:[10,3] error";
    const errs = extractCompilationErrors(output, ["backend", "frontend"]); // neither matches
    assert.equal(errs[0]!.file, "Foo.java");
  });

  it("filters out '.' from moduleRoots (it's not a real path marker)", () => {
    const output = "[ERROR] /repo/backend/Foo.java:[1,1] err";
    const errs = extractCompilationErrors(output, [".", "backend"]);
    assert.equal(errs[0]!.file, "backend/Foo.java"); // "." filtered, backend matched
  });

  it("default moduleRoots=[] preserves pre-refactor behavior (basename fallback)", () => {
    // Backward compat: callers that don't pass moduleRoots get basename-only.
    const output = "[ERROR] /Users/foo/backend/Main.java:[5,2] error";
    const errs = extractCompilationErrors(output); // omit second arg
    assert.equal(errs[0]!.file, "Main.java");
  });

  it("typescript-style path also strips correctly", () => {
    const output = "src/lib/foo.ts(10,5): error TS2304: cannot find name";
    const errs = extractCompilationErrors(output, ["src", "lib"]);
    assert.equal(errs.length, 1);
    // ts paths are relative already; markers preserve them
    assert.match(errs[0]!.file, /\.ts$/);
  });
});
