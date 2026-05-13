import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { doctorCommand } from "./doctor.js";
import { readProjectYml } from "@dsh/repo";

describe("doctorCommand", () => {
  let tmp: string;
  let originalCwd: string;
  let logs: string[];
  let restoreLog: () => void;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cli-doctor-"));
    originalCwd = process.cwd();
    process.chdir(tmp);
    logs = [];
    const origLog = console.log;
    console.log = ((...args: unknown[]) => { logs.push(args.map(String).join(" ")); }) as typeof console.log;
    restoreLog = () => { console.log = origLog; };
  });

  afterEach(() => {
    process.chdir(originalCwd);
    restoreLog();
    mock.restoreAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function out(): string {
    return logs.join("\n");
  }

  function setupTsProject(): void {
    fs.writeFileSync(path.join(tmp, "package.json"),
      JSON.stringify({ name: "x", devDependencies: { typescript: "^5.0" } }), "utf-8");
    fs.writeFileSync(path.join(tmp, "tsconfig.json"), "{}", "utf-8");
    fs.mkdirSync(path.join(tmp, "src"));
    for (const name of ["a.ts", "b.ts", "c.ts"]) {
      fs.writeFileSync(path.join(tmp, "src", name), "export const x = 1;", "utf-8");
    }
  }

  function setupMavenProject(): void {
    fs.writeFileSync(path.join(tmp, "pom.xml"),
      "<project><dependencies><dependency>spring-boot-starter</dependency></dependencies></project>",
      "utf-8");
    fs.mkdirSync(path.join(tmp, "src"));
    for (const name of ["A.java", "B.java", "C.java"]) {
      fs.writeFileSync(path.join(tmp, "src", name), "class X{}", "utf-8");
    }
  }

  it("prints Project Card for a typescript project", async () => {
    setupTsProject();
    await doctorCommand({});
    const o = out();
    assert.ok(o.includes("Project Card"), "missing Project Card heading");
    assert.ok(o.includes("typescript"), `should mention typescript:\n${o}`);
    assert.ok(o.includes("Capabilities"), "missing Capabilities section");
  });

  it("prints Project Card for a maven+spring-boot project (auto decisions)", async () => {
    setupMavenProject();
    await doctorCommand({});
    const o = out();
    assert.ok(o.includes("Project Card"));
    assert.ok(o.includes("java"));
    assert.ok(o.includes("spring-boot"), `should mention spring-boot:\n${o}`);
  });

  it("--write creates .dsh/project.yml with schema-valid draft", async () => {
    setupMavenProject();
    await doctorCommand({ write: true });
    const ymlPath = path.join(tmp, ".dsh", "project.yml");
    assert.ok(fs.existsSync(ymlPath), "project.yml should exist");
    const parsed = readProjectYml(tmp);
    assert.equal(parsed?.language, "java");
    assert.equal(parsed?.buildSystem, "maven");
    assert.equal(parsed?.framework, "spring-boot");
  });

  it("--write refuses to overwrite existing project.yml without --force", async () => {
    setupTsProject();
    fs.mkdirSync(path.join(tmp, ".dsh"));
    fs.writeFileSync(path.join(tmp, ".dsh", "project.yml"), "language: java\n", "utf-8");
    await doctorCommand({ write: true });
    const o = out();
    assert.match(o, /已存在.*--force/);
    // file unchanged
    assert.equal(fs.readFileSync(path.join(tmp, ".dsh", "project.yml"), "utf-8"), "language: java\n");
  });

  it("--write --force overwrites existing malformed project.yml with fresh draft", async () => {
    setupMavenProject();
    fs.mkdirSync(path.join(tmp, ".dsh"));
    // schema-invalid: language must be string, not number. assembleIntelligence
    // silently ignores malformed yml, so the override does not poison the draft.
    fs.writeFileSync(path.join(tmp, ".dsh", "project.yml"), "language: 123\n", "utf-8");
    await doctorCommand({ write: true, force: true });
    const parsed = readProjectYml(tmp);
    assert.equal(parsed?.language, "java");
    assert.equal(parsed?.buildSystem, "maven");
  });

  it("warns when existing project.yml is malformed", async () => {
    setupMavenProject();
    fs.mkdirSync(path.join(tmp, ".dsh"));
    fs.writeFileSync(path.join(tmp, ".dsh", "project.yml"), "language: 123\n", "utf-8");
    await doctorCommand({});
    const o = out();
    assert.match(o, /警告.*无法解析/);
    // Project Card still printed
    assert.ok(o.includes("Project Card"));
  });
});
