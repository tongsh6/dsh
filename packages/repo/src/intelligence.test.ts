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
      const stack = toLegacyTechStack(pi);
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
      const stack = toLegacyTechStack(pi);
      // Java detected from source files (auto) but build system is suggest → null
      assert.equal(stack.language, "java");
      assert.equal(stack.packageManager, null);
    });
  });
});
