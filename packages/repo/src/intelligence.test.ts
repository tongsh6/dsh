import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  collectFacts,
  generateBuildSystemCandidates,
  decide,
  deriveCapabilities,
  assembleIntelligence,
  toProjectCard,
  toLegacyTechStack,
  pickVerifyPlan,
  moduleRoots,
  DEFAULT_POLICY,
} from "./intelligence.js";

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-intel-"));
  try { return fn(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function touch(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content + "\n", "utf-8");
}

// ---- Fact Collection ----

describe("collectFacts", () => {
  it("collects Java source facts without assuming Maven", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "src", "Foo.java"), "class Foo {}");
      touch(path.join(tmp, "src", "Bar.java"), "class Bar {}");
      touch(path.join(tmp, "src", "Baz.java"), "class Baz {}");
      const facts = collectFacts(tmp);
      const factSet = new Map(facts.map((f) => [f.key, f.value]));
      assert.equal(factSet.get("source.java.exists"), true);
      // No pom.xml → descriptor should be false
      assert.equal(factSet.get("build.descriptor.maven"), false);
    });
  });

  it("collects build descriptor facts when pom.xml exists", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "src", "Foo.java"), "class Foo {}");
      touch(path.join(tmp, "src", "Bar.java"), "class Bar {}");
      touch(path.join(tmp, "src", "Baz.java"), "class Baz {}");
      fs.writeFileSync(path.join(tmp, "pom.xml"), "<project></project>", "utf-8");
      const facts = collectFacts(tmp);
      const factSet = new Map(facts.map((f) => [f.key, f.value]));
      assert.equal(factSet.get("build.descriptor.maven"), true);
      assert.equal(factSet.get("source.java.exists"), true);
    });
  });

  it("collects layout hints", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src", "main", "java"), { recursive: true });
      const facts = collectFacts(tmp);
      const layoutFacts = facts.filter((f) => f.key.startsWith("layout."));
      assert.ok(layoutFacts.some((f) => f.key === "layout.src/main/java"));
    });
  });

  it("collects submodule build descriptor facts for mixed projects (no top-level pom)", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "backend", "pom.xml"), "<project></project>");
      touch(path.join(tmp, "frontend", "package.json"), JSON.stringify({ name: "frontend" }));
      const facts = collectFacts(tmp);
      const keys = new Set(facts.filter((f) => f.value === true).map((f) => f.key));
      assert.ok(keys.has("submodule.backend.maven"), "missing submodule.backend.maven");
      assert.ok(keys.has("submodule.backend.lang.java"), "missing submodule.backend.lang.java");
      assert.ok(keys.has("submodule.frontend.npm"), "missing submodule.frontend.npm");
      assert.ok(keys.has("submodule.frontend.lang.javascript"), "missing submodule.frontend.lang.javascript");
    });
  });

  it("detects TypeScript submodule via tsconfig.json or typescript devDep", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "frontend", "package.json"),
        JSON.stringify({ devDependencies: { typescript: "^5.0.0" } }));
      const facts = collectFacts(tmp);
      const keys = new Set(facts.filter((f) => f.value === true).map((f) => f.key));
      assert.ok(keys.has("submodule.frontend.npm"));
      assert.ok(keys.has("submodule.frontend.lang.typescript"),
        "should detect typescript via devDependencies");
    });
  });

  it("collects framework facts for primary pom.xml (spring-boot)", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "pom.xml"),
        "<project><dependencies><dependency>spring-boot-starter</dependency></dependencies></project>",
        "utf-8");
      const facts = collectFacts(tmp);
      const keys = new Set(facts.filter((f) => f.value === true).map((f) => f.key));
      assert.ok(keys.has("framework.primary.spring-boot"), "missing framework.primary.spring-boot");
    });
  });

  it("collects framework facts for submodule pom.xml (spring-boot)", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "backend", "pom.xml"),
        "<project><dependencies><dependency>spring-boot-starter</dependency></dependencies></project>");
      const facts = collectFacts(tmp);
      const keys = new Set(facts.filter((f) => f.value === true).map((f) => f.key));
      assert.ok(keys.has("submodule.backend.maven"));
      assert.ok(keys.has("framework.submodule.backend.spring-boot"),
        "missing framework.submodule.backend.spring-boot");
    });
  });

  it("collects framework facts for primary package.json (vue)", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "package.json"),
        JSON.stringify({ dependencies: { vue: "^3.0.0" } }), "utf-8");
      const facts = collectFacts(tmp);
      const keys = new Set(facts.filter((f) => f.value === true).map((f) => f.key));
      assert.ok(keys.has("framework.primary.vue"), "missing framework.primary.vue");
    });
  });

  it("ignores node_modules and hidden dirs during submodule shallow scan", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "node_modules", "foo", "package.json"), "{}");
      touch(path.join(tmp, ".git", "config"), "");
      touch(path.join(tmp, "target", "pom.xml"), "<project/>");
      const facts = collectFacts(tmp);
      const submoduleFacts = facts.filter((f) => f.key.startsWith("submodule."));
      assert.equal(submoduleFacts.length, 0, `expected no submodule facts, got: ${submoduleFacts.map(f=>f.key).join(",")}`);
    });
  });
});

// ---- Candidate Generation ----

describe("generateBuildSystemCandidates", () => {
  it("suggests weak candidates when Java source exists but no build descriptors", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "src", "Foo.java"), "class Foo {}");
      touch(path.join(tmp, "src", "Bar.java"), "class Bar {}");
      touch(path.join(tmp, "src", "Baz.java"), "class Baz {}");
      const facts = collectFacts(tmp);
      const candidates = generateBuildSystemCandidates(facts);
      assert.ok(candidates.length >= 1, "should suggest at least 1 candidate");
      // Weak suggestions should have low confidence (< 0.4)
      for (const c of candidates) {
        assert.ok(c.confidence < 0.4, `expected confidence < 0.4, got ${c.confidence} for ${c.value}`);
      }
    });
  });

  it("high-confidence Maven when pom.xml + Java source both present", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "src", "Foo.java"), "class Foo {}");
      touch(path.join(tmp, "src", "Bar.java"), "class Bar {}");
      touch(path.join(tmp, "src", "Baz.java"), "class Baz {}");
      fs.writeFileSync(path.join(tmp, "pom.xml"), "<project></project>", "utf-8");
      const facts = collectFacts(tmp);
      const candidates = generateBuildSystemCandidates(facts);
      assert.ok(candidates.length > 0);
      assert.equal(candidates[0]!.value, "maven");
      assert.ok(candidates[0]!.confidence > 0.7, `expected > 0.7, got ${candidates[0]!.confidence}`);
    });
  });
});

// ---- Decision ----

describe("decide", () => {
  it("auto mode when single candidate above threshold with margin", () => {
    const d = decide([
      { value: "maven", confidence: 0.9, evidence: ["pom.xml"], missingEvidence: [] },
      { value: "gradle", confidence: 0.1, evidence: [], missingEvidence: [] },
    ], DEFAULT_POLICY, "build.system");
    assert.equal(d.mode, "auto");
    assert.equal(d.selected, "maven");
  });

  it("suggest mode when candidate above suggest but not auto threshold", () => {
    const d = decide([
      { value: "maven", confidence: 0.5, evidence: ["Java source"], missingEvidence: ["pom.xml"] },
    ], DEFAULT_POLICY, "build.system");
    assert.equal(d.mode, "suggest");
    assert.equal(d.selected, "maven");
  });

  it("blocked when no candidates exist", () => {
    const d = decide([], DEFAULT_POLICY, "language.primary");
    assert.equal(d.mode, "blocked");
    assert.equal(d.selected, null);
  });

  it("blocked when all candidates below suggest threshold", () => {
    const d = decide([
      { value: "maven", confidence: 0.25, evidence: [], missingEvidence: ["pom.xml"] },
      { value: "gradle", confidence: 0.20, evidence: [], missingEvidence: ["build.gradle"] },
    ], DEFAULT_POLICY, "build.system");
    assert.equal(d.mode, "blocked");
    assert.equal(d.selected, null);
  });
});

// ---- Capability Derivation ----

describe("deriveCapabilities", () => {
  it("returns available build/test when Maven is auto-confirmed", () => {
    const lang = { key: "x", selected: "java", mode: "auto" as const, confidence: 0.95, reason: ["pom.xml"], alternatives: [] };
    const build = { key: "x", selected: "maven", mode: "auto" as const, confidence: 0.95, reason: ["pom.xml"], alternatives: [] };
    const caps = deriveCapabilities(lang, build);
    const test = caps.find((c) => c.key === "test")!;
    assert.equal(test.status, "available");
    assert.ok(test.command!.includes("mvn"));
  });

  it("returns unavailable build when build system is blocked", () => {
    const lang = { key: "x", selected: "java", mode: "auto" as const, confidence: 0.9, reason: ["source"], alternatives: [] };
    const build = { key: "x", selected: null, mode: "blocked" as const, confidence: 0, reason: ["no descriptor"], alternatives: [] };
    const caps = deriveCapabilities(lang, build);
    const b = caps.find((c) => c.key === "build")!;
    assert.equal(b.status, "unavailable");
  });

  it("patch capability is likely (not unavailable) even without build system, because language is known", () => {
    const lang = { key: "x", selected: "java", mode: "auto" as const, confidence: 0.9, reason: ["source"], alternatives: [] };
    const build = { key: "x", selected: null, mode: "blocked" as const, confidence: 0, reason: ["no descriptor"], alternatives: [] };
    const caps = deriveCapabilities(lang, build);
    const patch = caps.find((c) => c.key === "patch")!;
    assert.equal(patch.status, "likely");
  });

  it("emits lint capability — available for Maven", () => {
    const lang = { key: "x", selected: "java", mode: "auto" as const, confidence: 0.95, reason: ["pom"], alternatives: [] };
    const build = { key: "x", selected: "maven", mode: "auto" as const, confidence: 0.95, reason: ["pom"], alternatives: [] };
    const caps = deriveCapabilities(lang, build);
    const lint = caps.find((c) => c.key === "lint")!;
    assert.equal(lint.status, "available");
    assert.match(lint.command!, /mvn.*checkstyle/);
  });

  it("emits lint capability — available for Gradle / Go / Rust", () => {
    const auto = (v: string) => ({ key: "x", selected: v, mode: "auto" as const, confidence: 0.95, reason: ["x"], alternatives: [] });
    for (const [lang, bld, expectCmd] of [
      ["java", "gradle", /gradle.*checkstyle/i],
      ["go", null, /golangci-lint/],
      ["rust", null, /cargo clippy/],
    ] as const) {
      const caps = deriveCapabilities(auto(lang), bld ? auto(bld) : { key: "x", selected: null, mode: "blocked" as const, confidence: 0, reason: [], alternatives: [] });
      const lint = caps.find((c) => c.key === "lint")!;
      assert.equal(lint.status, "available", `${lang}/${bld}: expected available`);
      assert.match(lint.command!, expectCmd);
    }
  });

  it("emits lint capability — likely for typescript / python (command derivation deferred to caller)", () => {
    const auto = (v: string) => ({ key: "x", selected: v, mode: "auto" as const, confidence: 0.95, reason: ["x"], alternatives: [] });
    const blocked = { key: "x", selected: null, mode: "blocked" as const, confidence: 0, reason: [], alternatives: [] };
    for (const lang of ["typescript", "python"] as const) {
      const caps = deriveCapabilities(auto(lang), blocked);
      const lint = caps.find((c) => c.key === "lint")!;
      assert.equal(lint.status, "likely", `${lang}: expected likely`);
      assert.equal(lint.command, null);
    }
  });
});

// ---- Assemble + Views + Legacy ----

describe("assembleIntelligence + views", () => {
  it("produces a ProjectCard for Java with Maven", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "src", "Foo.java"), "class Foo {}");
      touch(path.join(tmp, "src", "Bar.java"), "class Bar {}");
      touch(path.join(tmp, "src", "Baz.java"), "class Baz {}");
      fs.writeFileSync(path.join(tmp, "pom.xml"), "<project></project>", "utf-8");
      const pi = assembleIntelligence(tmp);
      const card = toProjectCard(pi);
      assert.ok(card.includes("java"), `card should contain "java":\n${card}`);
      assert.ok(card.includes("pom.xml"), `card should contain "pom.xml":\n${card}`);
      assert.ok(card.includes("patch"));
      assert.ok(card.includes("test"));
    });
  });

  it("ProjectCard shows unknown entries for project with no build descriptors", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "src", "Foo.java"), "class Foo {}");
      touch(path.join(tmp, "src", "Bar.java"), "class Bar {}");
      touch(path.join(tmp, "src", "Baz.java"), "class Baz {}");
      const pi = assembleIntelligence(tmp);
      const card = toProjectCard(pi);
      assert.ok(card.includes("inferred") || card.includes("Unknown") || card.includes("unconfirmed"),
        `card should indicate uncertainty, got:\n${card}`);
    });
  });

  it("toLegacyTechStack maps auto decision to correct TechStack", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "src", "Foo.java"), "class Foo {}");
      touch(path.join(tmp, "src", "Bar.java"), "class Bar {}");
      touch(path.join(tmp, "src", "Baz.java"), "class Baz {}");
      fs.writeFileSync(path.join(tmp, "pom.xml"), "<project></project>", "utf-8");
      const pi = assembleIntelligence(tmp);
      const stack = toLegacyTechStack(tmp, pi);
      assert.equal(stack.language, "java");
      assert.equal(stack.packageManager, "maven");
    });
  });

  it("toLegacyTechStack returns null packageManager when build system is suggest", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "src", "Foo.java"), "class Foo {}");
      touch(path.join(tmp, "src", "Bar.java"), "class Bar {}");
      touch(path.join(tmp, "src", "Baz.java"), "class Baz {}");
      const pi = assembleIntelligence(tmp);
      const stack = toLegacyTechStack(tmp, pi);
      // Java detected from source files (auto) but build system is suggest → null
      assert.equal(stack.language, "java");
      assert.equal(stack.packageManager, null);
    });
  });

  it("toLegacyTechStack populates framework from primary pom (spring-boot)", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "src", "a.java"), "class A{}");
      touch(path.join(tmp, "src", "b.java"), "class B{}");
      touch(path.join(tmp, "src", "c.java"), "class C{}");
      fs.writeFileSync(path.join(tmp, "pom.xml"),
        "<project><dependencies><dependency>spring-boot-starter</dependency></dependencies></project>",
        "utf-8");
      const pi = assembleIntelligence(tmp);
      const stack = toLegacyTechStack(tmp, pi);
      assert.equal(stack.framework, "spring-boot");
    });
  });

  it("toLegacyTechStack populates modules with frontend (Vue) only — Java primary excludes Java submodules", () => {
    withTmp((tmp) => {
      // primary Java + Maven
      touch(path.join(tmp, "src", "a.java"), "class A{}");
      touch(path.join(tmp, "src", "b.java"), "class B{}");
      touch(path.join(tmp, "src", "c.java"), "class C{}");
      fs.writeFileSync(path.join(tmp, "pom.xml"), "<project></project>", "utf-8");
      // submodule backend (same lang Java) and frontend (Vue/Node)
      touch(path.join(tmp, "backend", "pom.xml"), "<project></project>");
      touch(path.join(tmp, "frontend", "package.json"),
        JSON.stringify({ dependencies: { vue: "^3.0.0" } }));
      const pi = assembleIntelligence(tmp);
      const stack = toLegacyTechStack(tmp, pi);
      assert.equal(stack.language, "java");
      assert.equal(stack.modules?.length, 1, "backend(java) should be excluded; only frontend should remain");
      assert.equal(stack.modules?.[0]?.path, "frontend");
      assert.equal(stack.modules?.[0]?.language, "javascript");
      assert.equal(stack.modules?.[0]?.framework, "vue");
    });
  });

  it("toLegacyTechStack detects Node packageManager via pnpm-lock.yaml", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "x" }), "utf-8");
      fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf-8");
      fs.writeFileSync(path.join(tmp, "tsconfig.json"), "{}", "utf-8");
      touch(path.join(tmp, "src", "a.ts"), "export {};");
      touch(path.join(tmp, "src", "b.ts"), "export {};");
      touch(path.join(tmp, "src", "c.ts"), "export {};");
      const pi = assembleIntelligence(tmp);
      const stack = toLegacyTechStack(tmp, pi);
      assert.equal(stack.language, "typescript");
      assert.equal(stack.packageManager, "pnpm");
    });
  });

  it("toLegacyTechStack detects Python poetry via poetry.lock", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "pyproject.toml"), "[tool.poetry]\nname='x'\n", "utf-8");
      fs.writeFileSync(path.join(tmp, "poetry.lock"), "", "utf-8");
      touch(path.join(tmp, "a.py"), "x=1");
      touch(path.join(tmp, "b.py"), "x=1");
      touch(path.join(tmp, "c.py"), "x=1");
      const pi = assembleIntelligence(tmp);
      const stack = toLegacyTechStack(tmp, pi);
      assert.equal(stack.language, "python");
      assert.equal(stack.packageManager, "poetry");
    });
  });

  it("toLegacyTechStack: framework falls back to first submodule when primary has none", () => {
    withTmp((tmp) => {
      // No top-level pom/package.json; only submodule
      fs.mkdirSync(path.join(tmp, "frontend"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "frontend", "package.json"),
        JSON.stringify({ dependencies: { next: "^14.0.0" } }), "utf-8");
      const pi = assembleIntelligence(tmp);
      const stack = toLegacyTechStack(tmp, pi);
      assert.equal(stack.framework, "next.js");
    });
  });
});

// ---- Projections: pickVerifyPlan + moduleRoots ----

describe("pickVerifyPlan", () => {
  it("returns Maven commands when build=maven auto", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "src", "Foo.java"), "class Foo {}");
      touch(path.join(tmp, "src", "Bar.java"), "class Bar {}");
      touch(path.join(tmp, "src", "Baz.java"), "class Baz {}");
      fs.writeFileSync(path.join(tmp, "pom.xml"), "<project></project>", "utf-8");
      const pi = assembleIntelligence(tmp);
      const plan = pickVerifyPlan(tmp, pi);
      assert.match(plan.test!, /mvn/);
      assert.match(plan.typecheck!, /mvn compile/);
      assert.match(plan.lint!, /checkstyle/);
      assert.match(plan.build!, /mvn package/);
    });
  });

  it("returns null fields for bare TS project with no package.json scripts", () => {
    withTmp((tmp) => {
      // 3 .ts files but no package.json → language ts (auto via file ext), no scripts → null
      touch(path.join(tmp, "src", "a.ts"), "export const a = 1;");
      touch(path.join(tmp, "src", "b.ts"), "export const b = 2;");
      touch(path.join(tmp, "src", "c.ts"), "export const c = 3;");
      const pi = assembleIntelligence(tmp);
      const plan = pickVerifyPlan(tmp, pi);
      assert.equal(plan.test, null);
      assert.equal(plan.lint, null);
    });
  });

  it("falls back to package.json scripts for TS project (test/lint/typecheck/build)", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({
        name: "x",
        devDependencies: { typescript: "^5.0.0" },
        scripts: {
          test: "vitest run",
          lint: "eslint .",
          typecheck: "tsc --noEmit",
          build: "tsc",
        },
      }), "utf-8");
      fs.writeFileSync(path.join(tmp, "tsconfig.json"), "{}", "utf-8");
      touch(path.join(tmp, "src", "a.ts"), "export const a = 1;");
      touch(path.join(tmp, "src", "b.ts"), "export const b = 2;");
      touch(path.join(tmp, "src", "c.ts"), "export const c = 3;");
      const pi = assembleIntelligence(tmp);
      const plan = pickVerifyPlan(tmp, pi);
      assert.equal(plan.test, "vitest run");
      assert.equal(plan.lint, "eslint .");
      assert.equal(plan.typecheck, "tsc --noEmit");
      assert.equal(plan.build, "tsc");
    });
  });

  it("Python: poetry-lock present → commands prefixed with 'poetry run'", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "pyproject.toml"), "[tool.poetry]\nname='x'\n", "utf-8");
      fs.writeFileSync(path.join(tmp, "poetry.lock"), "", "utf-8");
      fs.mkdirSync(path.join(tmp, "tests"));
      touch(path.join(tmp, "a.py"), "x=1");
      touch(path.join(tmp, "b.py"), "x=1");
      touch(path.join(tmp, "c.py"), "x=1");
      const pi = assembleIntelligence(tmp);
      const plan = pickVerifyPlan(tmp, pi);
      assert.match(plan.test!, /^poetry run pytest tests\/ -x/);
      assert.match(plan.lint!, /^poetry run ruff/);
      assert.match(plan.typecheck!, /^poetry run mypy/);
    });
  });

  it("returns Go commands when language=go auto", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "go.mod"), "module foo\ngo 1.21\n", "utf-8");
      touch(path.join(tmp, "main.go"), "package main");
      touch(path.join(tmp, "foo.go"), "package main");
      touch(path.join(tmp, "bar.go"), "package main");
      const pi = assembleIntelligence(tmp);
      const plan = pickVerifyPlan(tmp, pi);
      assert.match(plan.test!, /go test/);
      assert.match(plan.typecheck!, /go vet/);
      assert.match(plan.lint!, /golangci-lint/);
    });
  });
});

describe("moduleRoots", () => {
  it("returns submodule names + layout hints + '.' for mixed projects", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "backend", "pom.xml"), "<project/>");
      touch(path.join(tmp, "frontend", "package.json"), "{}");
      fs.mkdirSync(path.join(tmp, "src", "main", "java"), { recursive: true });
      const pi = assembleIntelligence(tmp);
      const roots = moduleRoots(pi);
      assert.ok(roots.includes("backend"), `roots missing backend: ${roots.join(",")}`);
      assert.ok(roots.includes("frontend"), `roots missing frontend: ${roots.join(",")}`);
      assert.ok(roots.includes("."), `roots missing '.': ${roots.join(",")}`);
      // layout hint contributes
      assert.ok(roots.some((r) => r.startsWith("src")), `roots missing src layout hint: ${roots.join(",")}`);
    });
  });

  it("returns ['.'] (plus any layout hints) for single-package project with no submodules", () => {
    withTmp((tmp) => {
      touch(path.join(tmp, "src", "a.ts"), "export const a = 1;");
      touch(path.join(tmp, "src", "b.ts"), "export const b = 1;");
      touch(path.join(tmp, "src", "c.ts"), "export const c = 1;");
      const pi = assembleIntelligence(tmp);
      const roots = moduleRoots(pi);
      assert.ok(roots.includes("."));
      // no submodules
      assert.ok(!roots.includes("backend"));
      assert.ok(!roots.includes("frontend"));
    });
  });
});
