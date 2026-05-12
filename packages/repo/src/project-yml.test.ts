import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ProjectYmlSchema, readProjectYml, writeProjectYml, projectYmlPath, renderProjectYml } from "./project-yml.js";
import { assembleIntelligence } from "./intelligence.js";

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-project-yml-"));
  try { return fn(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

describe("ProjectYmlSchema", () => {
  it("parses minimal yml (all fields optional)", () => {
    assert.doesNotThrow(() => ProjectYmlSchema.parse({}));
  });

  it("parses fully-populated yml", () => {
    const parsed = ProjectYmlSchema.parse({
      language: "java",
      buildSystem: "maven",
      framework: "spring-boot",
      modules: [
        { path: "backend", language: "java", buildSystem: "maven", framework: "spring-boot" },
        { path: "frontend", language: "typescript", framework: "vue" },
      ],
      verifyOverride: { test: "mvn -pl backend test", lint: null },
    });
    assert.equal(parsed.language, "java");
    assert.equal(parsed.modules?.length, 2);
  });

  it("rejects unknown top-level fields", () => {
    assert.throws(() => ProjectYmlSchema.parse({ unknownField: 1 }));
  });

  it("rejects modules without path", () => {
    assert.throws(() => ProjectYmlSchema.parse({ modules: [{ language: "java" }] }));
  });
});

describe("readProjectYml / writeProjectYml", () => {
  it("returns null when file missing", () => {
    withTmp((tmp) => {
      assert.equal(readProjectYml(tmp), null);
    });
  });

  it("round-trips through write → read", () => {
    withTmp((tmp) => {
      writeProjectYml(tmp, { language: "java", buildSystem: "gradle" });
      assert.ok(fs.existsSync(projectYmlPath(tmp)));
      const parsed = readProjectYml(tmp);
      assert.deepEqual(parsed, { language: "java", buildSystem: "gradle" });
    });
  });

  it("returns empty object for empty file", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, ".dsh"));
      fs.writeFileSync(projectYmlPath(tmp), "", "utf-8");
      assert.deepEqual(readProjectYml(tmp), {});
    });
  });

  it("throws ZodError on schema-invalid file", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, ".dsh"));
      fs.writeFileSync(projectYmlPath(tmp), "language: 123\n", "utf-8"); // number not string
      assert.throws(() => readProjectYml(tmp));
    });
  });
});

describe("assembleIntelligence override via project.yml", () => {
  it("locks buildSystem to gradle even when pom.xml is present", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "pom.xml"), "<project></project>", "utf-8");
      writeProjectYml(tmp, { buildSystem: "gradle" });
      const pi = assembleIntelligence(tmp);
      assert.equal(pi.buildSystem.mode, "auto");
      assert.equal(pi.buildSystem.selected, "gradle");
      assert.equal(pi.buildSystem.confidence, 1.0);
      assert.match(pi.buildSystem.reason[0]!, /manual override/);
    });
  });

  it("locks language to python even with .java source files", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, "src"));
      fs.writeFileSync(path.join(tmp, "src", "a.java"), "class A{}", "utf-8");
      fs.writeFileSync(path.join(tmp, "src", "b.java"), "class B{}", "utf-8");
      fs.writeFileSync(path.join(tmp, "src", "c.java"), "class C{}", "utf-8");
      writeProjectYml(tmp, { language: "python" });
      const pi = assembleIntelligence(tmp);
      assert.equal(pi.language.mode, "auto");
      assert.equal(pi.language.selected, "python");
    });
  });

  it("partial override: lock framework only, language/buildSystem inferred normally", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "pom.xml"), "<project></project>", "utf-8");
      fs.mkdirSync(path.join(tmp, "src"));
      fs.writeFileSync(path.join(tmp, "src", "a.java"), "class A{}", "utf-8");
      fs.writeFileSync(path.join(tmp, "src", "b.java"), "class B{}", "utf-8");
      fs.writeFileSync(path.join(tmp, "src", "c.java"), "class C{}", "utf-8");
      writeProjectYml(tmp, { framework: "quarkus" });
      const pi = assembleIntelligence(tmp);
      assert.equal(pi.language.selected, "java");
      assert.equal(pi.buildSystem.selected, "maven");
      const ymlFact = pi.facts.find((f) => f.key === "project_yml.framework");
      assert.equal(ymlFact?.value, "quarkus");
    });
  });

  it("malformed project.yml is silently ignored (does not break assembleIntelligence)", () => {
    withTmp((tmp) => {
      fs.mkdirSync(path.join(tmp, ".dsh"));
      fs.writeFileSync(projectYmlPath(tmp), "language: 123\n", "utf-8"); // schema-invalid
      fs.writeFileSync(path.join(tmp, "pom.xml"), "<project></project>", "utf-8");
      const pi = assembleIntelligence(tmp);
      // pom.xml still drives the decision normally
      assert.equal(pi.buildSystem.selected, "maven");
    });
  });
});

describe("renderProjectYml", () => {
  it("emits language/buildSystem/framework + modules for a mixed project", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "pom.xml"),
        "<project><dependencies><dependency>spring-boot-starter</dependency></dependencies></project>",
        "utf-8");
      fs.mkdirSync(path.join(tmp, "src"));
      fs.writeFileSync(path.join(tmp, "src", "a.java"), "class A{}", "utf-8");
      fs.writeFileSync(path.join(tmp, "src", "b.java"), "class B{}", "utf-8");
      fs.writeFileSync(path.join(tmp, "src", "c.java"), "class C{}", "utf-8");
      fs.mkdirSync(path.join(tmp, "frontend"));
      fs.writeFileSync(path.join(tmp, "frontend", "package.json"),
        JSON.stringify({ dependencies: { vue: "^3.0.0" } }), "utf-8");
      const pi = assembleIntelligence(tmp);
      const draft = renderProjectYml(pi);
      assert.equal(draft.language, "java");
      assert.equal(draft.buildSystem, "maven");
      assert.equal(draft.framework, "spring-boot");
      assert.equal(draft.modules?.length, 1);
      assert.equal(draft.modules?.[0]?.path, "frontend");
      assert.equal(draft.modules?.[0]?.buildSystem, "npm");
      assert.equal(draft.modules?.[0]?.framework, "vue");
    });
  });

  it("draft passes its own schema validation (round-trippable)", () => {
    withTmp((tmp) => {
      fs.writeFileSync(path.join(tmp, "pom.xml"), "<project></project>", "utf-8");
      fs.mkdirSync(path.join(tmp, "src"));
      fs.writeFileSync(path.join(tmp, "src", "a.java"), "class A{}", "utf-8");
      fs.writeFileSync(path.join(tmp, "src", "b.java"), "class B{}", "utf-8");
      fs.writeFileSync(path.join(tmp, "src", "c.java"), "class C{}", "utf-8");
      const pi = assembleIntelligence(tmp);
      const draft = renderProjectYml(pi);
      assert.doesNotThrow(() => ProjectYmlSchema.parse(draft));
      writeProjectYml(tmp, draft);
      const round = readProjectYml(tmp);
      assert.deepEqual(round, draft);
    });
  });

  it("emits empty draft for project with no auto decisions", () => {
    withTmp((tmp) => {
      const pi = assembleIntelligence(tmp);
      const draft = renderProjectYml(pi);
      // Empty cwd → no facts, no decisions → empty draft
      assert.deepEqual(draft, {});
    });
  });
});
