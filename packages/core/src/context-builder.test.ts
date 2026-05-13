import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildRepoContext } from "./context-builder.js";
import { assembleIntelligence, generateRepoContext } from "@dsh/repo";

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-ctx-builder-"));
  try { return fn(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function setupMavenSpringBoot(tmp: string): void {
  fs.writeFileSync(path.join(tmp, "pom.xml"),
    "<project><dependencies><dependency>spring-boot-starter</dependency></dependencies></project>",
    "utf-8");
  fs.mkdirSync(path.join(tmp, "src"));
  for (const n of ["A.java", "B.java", "C.java"]) {
    fs.writeFileSync(path.join(tmp, "src", n), "class X{}", "utf-8");
  }
}

describe("buildRepoContext — Project Card injection", () => {
  let savedEnv: string | undefined;

  beforeEach(() => { savedEnv = process.env["DSH_INJECT_PROJECT_CARD"]; });
  afterEach(() => {
    if (savedEnv === undefined) delete process.env["DSH_INJECT_PROJECT_CARD"];
    else process.env["DSH_INJECT_PROJECT_CARD"] = savedEnv;
  });

  it("injects Project Card by default", () => {
    withTmp((tmp) => {
      setupMavenSpringBoot(tmp);
      const pi = assembleIntelligence(tmp);
      const ctx = generateRepoContext(tmp, pi);
      const out = buildRepoContext(ctx);
      assert.ok(out.includes("## Project Card"), `expected Project Card section:\n${out}`);
      assert.ok(out.includes("Capabilities"), "Project Card should include Capabilities section");
    });
  });

  it("preserves the legacy Tech Stack header before the Project Card", () => {
    withTmp((tmp) => {
      setupMavenSpringBoot(tmp);
      const pi = assembleIntelligence(tmp);
      const ctx = generateRepoContext(tmp, pi);
      const out = buildRepoContext(ctx);
      const techIdx = out.indexOf("## Tech Stack:");
      const cardIdx = out.indexOf("## Project Card");
      assert.ok(techIdx >= 0, "missing Tech Stack header");
      assert.ok(cardIdx > techIdx, "Project Card must come after Tech Stack header");
    });
  });

  it("DSH_INJECT_PROJECT_CARD=false disables injection (A/B kill switch)", () => {
    withTmp((tmp) => {
      setupMavenSpringBoot(tmp);
      const pi = assembleIntelligence(tmp);
      const ctx = generateRepoContext(tmp, pi);
      process.env["DSH_INJECT_PROJECT_CARD"] = "false";
      const out = buildRepoContext(ctx);
      assert.ok(!out.includes("## Project Card"), "Project Card should not appear when disabled");
      // Existing Tech Stack section still intact
      assert.ok(out.includes("## Tech Stack: java"));
    });
  });

  it("character-level parity: with-injection output minus Project Card === without-injection output", () => {
    withTmp((tmp) => {
      setupMavenSpringBoot(tmp);
      const pi = assembleIntelligence(tmp);
      const ctx = generateRepoContext(tmp, pi);

      process.env["DSH_INJECT_PROJECT_CARD"] = "false";
      const without = buildRepoContext(ctx);

      delete process.env["DSH_INJECT_PROJECT_CARD"];
      const withCard = buildRepoContext(ctx);

      // Strip the Project Card section from `withCard`; result should equal
      // `without` exactly. Validates spec §5.2 "diff except Project Card 新章节 == 0".
      const cardStart = withCard.indexOf("## Project Card");
      assert.ok(cardStart >= 0);
      const dirStart = withCard.indexOf("## Directory Structure", cardStart);
      assert.ok(dirStart >= 0);
      const stripped = withCard.slice(0, cardStart) + withCard.slice(dirStart);
      assert.equal(stripped, without, "stripped output must equal without-injection output exactly");
    });
  });
});
