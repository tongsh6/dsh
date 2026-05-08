import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { detectTechStack } from "./scanner.js";

function touch(filePath: string, content: string = ""): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

describe("detectTechStack", () => {
  it("detects python from .py files when no config file exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      // Create 5 .py files in subdirectories (simulating pi-proof-forge structure)
      touch(path.join(tmp, "tools", "main.py"), "# main");
      touch(path.join(tmp, "tools", "cli", "commands.py"), "# commands");
      touch(path.join(tmp, "tools", "engines", "engine.py"), "# engine");
      touch(path.join(tmp, "tests", "test_main.py"), "# test");
      touch(path.join(tmp, "lib", "utils.py"), "# utils");

      const stack = detectTechStack(tmp);
      assert.equal(stack.language, "python");
      assert.equal(stack.packageManager, null, "no pyproject.toml → packageManager should be null");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("detects typescript from .ts files when no config file exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      touch(path.join(tmp, "src", "index.ts"), "export const x = 1;");
      touch(path.join(tmp, "src", "utils.ts"), "export const y = 2;");
      touch(path.join(tmp, "src", "types.ts"), "export type T = string;");

      const stack = detectTechStack(tmp);
      assert.equal(stack.language, "typescript");
      assert.equal(stack.packageManager, null, "no package.json → packageManager should be null");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("detects go from .go files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      touch(path.join(tmp, "cmd", "main.go"), "package main");
      touch(path.join(tmp, "pkg", "foo.go"), "package foo");
      touch(path.join(tmp, "pkg", "bar.go"), "package bar");

      const stack = detectTechStack(tmp);
      assert.equal(stack.language, "go");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("prioritizes package.json over file-based detection", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      // Both package.json AND .py files exist
      touch(path.join(tmp, "package.json"), JSON.stringify({ name: "test", type: "module" }));
      touch(path.join(tmp, "src", "main.py"), "# python");
      touch(path.join(tmp, "src", "utils.py"), "# python");
      touch(path.join(tmp, "src", "lib.py"), "# python");

      const stack = detectTechStack(tmp);
      // package.json takes priority over .py files → JavaScript
      assert.equal(stack.language, "javascript");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns unknown when no config and too few source files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      touch(path.join(tmp, "src", "main.py"), "# only one py file");
      touch(path.join(tmp, "config.txt"), "not a source file");

      const stack = detectTechStack(tmp);
      assert.equal(stack.language, "unknown");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("detects rust from .rs files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      touch(path.join(tmp, "src", "main.rs"), "fn main() {}");
      touch(path.join(tmp, "src", "lib.rs"), "pub fn foo() {}");
      touch(path.join(tmp, "src", "mod.rs"), "");

      const stack = detectTechStack(tmp);
      assert.equal(stack.language, "rust");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("ignores hidden directories and node_modules during scan", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      // .py files in node_modules should be ignored
      touch(path.join(tmp, "node_modules", "pkg", "dep.py"), "# dep");
      touch(path.join(tmp, "node_modules", "pkg", "lib.py"), "# lib");
      touch(path.join(tmp, "node_modules", "pkg", "util.py"), "# util");
      // .py files in .venv should be ignored
      touch(path.join(tmp, ".venv", "lib", "mod.py"), "# mod");
      // .py files in __pycache__ should be ignored
      touch(path.join(tmp, "__pycache__", "cache.py"), "# cache");
      // Only 1 valid .py file
      touch(path.join(tmp, "src", "main.py"), "# main");

      const stack = detectTechStack(tmp);
      // Only 1 .py found (below threshold of 3) → unknown
      assert.equal(stack.language, "unknown");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("detects pyproject.toml-based Python project without fallback", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      touch(path.join(tmp, "pyproject.toml"), "[project]\nname = 'test'");

      const stack = detectTechStack(tmp);
      assert.equal(stack.language, "python");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("detects go.mod-based Go project without fallback", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      touch(path.join(tmp, "go.mod"), "module example.com/test");

      const stack = detectTechStack(tmp);
      assert.equal(stack.language, "go");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("detects Java Maven project from pom.xml", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      touch(path.join(tmp, "pom.xml"), "<project></project>");

      const stack = detectTechStack(tmp);
      assert.equal(stack.language, "java");
      assert.equal(stack.packageManager, "maven");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("detects Java Maven from backend/pom.xml for mixed projects", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      fs.mkdirSync(path.join(tmp, "backend"), { recursive: true });
      touch(path.join(tmp, "backend", "pom.xml"), "<project></project>");

      const stack = detectTechStack(tmp);
      assert.equal(stack.language, "java");
      assert.equal(stack.packageManager, "maven");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("detects Spring Boot framework from pom.xml", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      touch(path.join(tmp, "pom.xml"), "<project><parent><groupId>org.springframework.boot</groupId></parent></project>");

      const stack = detectTechStack(tmp);
      assert.equal(stack.language, "java");
      assert.equal(stack.framework, "spring-boot");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("detects mixed project with backend Java and frontend TypeScript", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      fs.mkdirSync(path.join(tmp, "backend"), { recursive: true });
      touch(path.join(tmp, "backend", "pom.xml"), "<project></project>");
      fs.mkdirSync(path.join(tmp, "frontend"), { recursive: true });
      touch(path.join(tmp, "frontend", "package.json"), '{"name":"web","devDependencies":{"typescript":"^5.0"}}');
      touch(path.join(tmp, "frontend", "tsconfig.json"), "{}");

      const stack = detectTechStack(tmp);
      assert.equal(stack.language, "java");
      assert.equal(stack.packageManager, "maven");
      assert.ok(stack.modules);
      assert.equal(stack.modules!.length, 1);
      assert.equal(stack.modules![0]!.path, "frontend");
      assert.equal(stack.modules![0]!.language, "typescript");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns no modules for single-language project", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-scanner-"));
    try {
      touch(path.join(tmp, "package.json"), '{"name":"test"}');
      touch(path.join(tmp, "tsconfig.json"), "{}");

      const stack = detectTechStack(tmp);
      assert.equal(stack.language, "typescript");
      assert.equal(stack.modules, undefined);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
