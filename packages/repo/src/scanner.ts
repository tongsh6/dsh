import * as fs from "node:fs";
import * as path from "node:path";

export interface SubModule {
  path: string;
  language: string;
  packageManager: string | null;
  framework: string | null;
}

export interface TechStack {
  language: string;
  packageManager: string | null;
  framework: string | null;
  details: Record<string, string>;
  /** Sub-modules detected in mixed projects (e.g., backend/ + frontend/) */
  modules?: SubModule[];
}

// VerifyCommands moved to repo-context.ts. Re-export here for back-compat
// until scanner.ts is fully deleted in Task C.
export type { VerifyCommands } from "./repo-context.js";

export function detectTechStack(cwd: string): TechStack {
  const files = listFiles(cwd, 1);
  let primary: TechStack | null = null;

  // Node / TypeScript
  if (files.has("package.json")) {
    const pkg = readJsonFile(path.join(cwd, "package.json"));
    const hasTypeScript = files.has("tsconfig.json") ||
      files.has("tsconfig.base.json") ||
      (pkg?.devDependencies && "typescript" in (pkg.devDependencies ?? {})) ||
      (pkg?.devDependencies && "typescript-eslint" in (pkg.devDependencies ?? {}));
    const pkgManager = detectPackageManager(cwd, files);

    let language = hasTypeScript ? "typescript" : "javascript";
    if (!hasTypeScript) {
      const extLang = detectLanguageByFiles(cwd);
      if (extLang && (extLang.language === "typescript" || extLang.language === "javascript")) {
        language = extLang.language;
      }
    }

    primary = {
      language,
      packageManager: pkgManager,
      framework: detectFramework(pkg),
      details: {
        name: pkg?.name ?? "unknown",
        type: pkg?.type ?? "commonjs",
        nodeVersion: pkg?.engines?.node ?? "unknown",
      },
    };
  }

  // Python
  if (!primary && files.has("pyproject.toml")) {
    primary = {
      language: "python",
      packageManager: detectPythonPM(cwd, files),
      framework: null,
      details: {},
    };
  }

  // Go
  if (!primary && files.has("go.mod")) {
    primary = { language: "go", packageManager: null, framework: null, details: {} };
  }

  // Rust
  if (!primary && files.has("Cargo.toml")) {
    primary = { language: "rust", packageManager: null, framework: null, details: {} };
  }

  // Java / Maven (including backend/ subdirectory)
  if (!primary && files.has("pom.xml")) {
    primary = { language: "java", packageManager: "maven", framework: detectJavaFramework(cwd), details: {} };
  }
  if (!primary && fs.existsSync(path.join(cwd, "backend", "pom.xml"))) {
    primary = { language: "java", packageManager: "maven", framework: detectJavaFramework(path.join(cwd, "backend")), details: {} };
  }

  // Java / Gradle
  if (!primary && (files.has("build.gradle") || files.has("build.gradle.kts"))) {
    primary = { language: "java", packageManager: "gradle", framework: detectJavaFramework(cwd), details: {} };
  }

  // Fallback: detect by file extensions
  if (!primary) {
    primary = detectLanguageByFiles(cwd);
  }

  if (!primary) {
    primary = { language: "unknown", packageManager: null, framework: null, details: {} };
  }

  // Scan sub-modules for all detected languages
  primary.modules = scanSubModules(cwd, primary.language);
  return primary;
}

type SubModuleDetector = (dir: string, name: string) => SubModule | null;

function detectTypeScriptModule(dir: string, name: string): SubModule | null {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  const pkg = readJsonFile(pkgPath);
  const hasTS = fs.existsSync(path.join(dir, "tsconfig.json")) ||
    (pkg?.devDependencies && "typescript" in (pkg.devDependencies ?? {}));
  const pm = detectPackageManager(dir, listFiles(dir, 1));
  return {
    path: name,
    language: hasTS ? "typescript" : "javascript",
    packageManager: pm,
    framework: pkg ? detectFramework(pkg) : null,
  };
}

function detectJavaModule(dir: string, name: string, buildTool: "maven" | "gradle"): SubModule {
  return {
    path: name,
    language: "java",
    packageManager: buildTool,
    framework: detectJavaFramework(dir),
  };
}

function detectPythonModule(dir: string, name: string): SubModule | null {
  if (!fs.existsSync(path.join(dir, "pyproject.toml"))) return null;
  return { path: name, language: "python", packageManager: detectPythonPM(dir, listFiles(dir, 1)), framework: null };
}

function scanSubModules(cwd: string, primaryLanguage: string): SubModule[] | undefined {
  // Ordered by priority: each subdirectory matches the first config file found
  const configDetectors: { file: string; detect: SubModuleDetector }[] = [
    { file: "pom.xml",          detect: (dir, name) => detectJavaModule(dir, name, "maven") },
    { file: "build.gradle",     detect: (dir, name) => detectJavaModule(dir, name, "gradle") },
    { file: "package.json",     detect: detectTypeScriptModule },
    { file: "pyproject.toml",   detect: detectPythonModule },
    { file: "go.mod",           detect: (dir, name) => ({ path: name, language: "go", packageManager: null, framework: null }) },
    { file: "Cargo.toml",       detect: (dir, name) => ({ path: name, language: "rust", packageManager: null, framework: null }) },
  ];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(cwd, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const modules: SubModule[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith(".") || name === "node_modules") continue;

    const dir = path.join(cwd, name);
    for (const detector of configDetectors) {
      if (!fs.existsSync(path.join(dir, detector.file))) continue;
      const result = detector.detect(dir, name);
      if (result && result.language !== primaryLanguage) {
        modules.push(result);
      }
      break; // one project type per directory
    }
  }

  return modules.length > 0 ? modules : undefined;
}

function detectLanguageByFiles(cwd: string): TechStack | null {
  const extCounts: Record<string, number> = {};
  const maxDepth = 3;
  const stopDirs = new Set(["node_modules", ".git", "dist", "__pycache__", "target", ".venv", "venv", ".dsh"]);

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (stopDirs.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        extCounts[ext] = (extCounts[ext] ?? 0) + 1;
      }
    }
  }

  walk(cwd, 1);

  const pyCount = (extCounts[".py"] ?? 0);
  const tsCount = (extCounts[".ts"] ?? 0) + (extCounts[".tsx"] ?? 0);
  const jsCount = (extCounts[".js"] ?? 0) + (extCounts[".jsx"] ?? 0);
  const goCount = (extCounts[".go"] ?? 0);
  const rsCount = (extCounts[".rs"] ?? 0);

  const threshold = 3;

  if (pyCount >= threshold) {
    return { language: "python", packageManager: null, framework: null, details: { detection: "file-extension" } };
  }
  if (tsCount >= threshold) {
    return { language: "typescript", packageManager: null, framework: null, details: { detection: "file-extension" } };
  }
  if (jsCount >= threshold && jsCount > tsCount) {
    return { language: "javascript", packageManager: null, framework: null, details: { detection: "file-extension" } };
  }
  if (goCount >= threshold) {
    return { language: "go", packageManager: null, framework: null, details: {} };
  }
  if (rsCount >= threshold) {
    return { language: "rust", packageManager: null, framework: null, details: {} };
  }
  const javaCount = (extCounts[".java"] ?? 0);
  if (javaCount >= threshold) {
    return { language: "java", packageManager: null, framework: null, details: { detection: "file-extension" } };
  }

  return null;
}

function detectJavaFramework(cwd: string): string | null {
  try {
    const pomPath = path.join(cwd, "pom.xml");
    if (!fs.existsSync(pomPath)) return null;
    const pom = fs.readFileSync(pomPath, "utf-8");
    if (pom.includes("spring-boot") || pom.includes("springframework.boot")) return "spring-boot";
    if (pom.includes("quarkus")) return "quarkus";
    if (pom.includes("micronaut")) return "micronaut";
    return null;
  } catch {
    return null;
  }
}

export function detectVerifyCommands(
  cwd: string,
  stack: TechStack,
): import("./repo-context.js").VerifyCommands {
  const pkg = readJsonFile(path.join(cwd, "package.json"));

  if (stack.language === "typescript" || stack.language === "javascript") {
    const scripts = pkg?.scripts ?? {};
    return {
      test: findScript(scripts, ["test", "jest", "vitest", "mocha"]),
      lint: findScript(scripts, ["lint", "eslint"]),
      typecheck: stack.language === "typescript"
        ? findScript(scripts, ["typecheck", "type-check", "tsc", "check-types"])
        : null,
      build: findScript(scripts, ["build", "compile"]),
    };
  }

  if (stack.language === "python") {
    const pm = stack.packageManager === "poetry" ? "poetry run" : "";
    const testDir = fs.existsSync(path.join(cwd, "tests")) ? "tests/ -x" : "-x";
    return {
      test: `${pm}pytest ${testDir}`.trim() || null,
      lint: `${pm}ruff check .`.trim() || null,
      typecheck: `${pm}mypy .`.trim() || null,
      build: null,
    };
  }

  if (stack.language === "go") {
    return {
      test: "go test ./...",
      lint: "golangci-lint run",
      typecheck: "go vet ./...",
      build: "go build ./...",
    };
  }

  if (stack.language === "java") {
    if (!stack.packageManager) {
      return { test: null, lint: null, typecheck: null, build: null };
    }
    const mvnCmd = stack.packageManager === "gradle" ? "gradle" : "mvn";
    const testCmd = mvnCmd === "gradle" ? "gradle test" : "mvn test -q";
    return {
      test: testCmd,
      lint: mvnCmd === "gradle" ? "gradle checkstyleMain" : "mvn checkstyle:check -q",
      typecheck: mvnCmd === "gradle" ? "gradle compileJava" : "mvn compile -q",
      build: mvnCmd === "gradle" ? "gradle build" : "mvn package -DskipTests -q",
    };
  }

  return { test: null, lint: null, typecheck: null, build: null };
}

// ---- helpers ----

function listFiles(cwd: string, _depth: number): Set<string> {
  const result = new Set<string>();
  try {
    for (const entry of fs.readdirSync(cwd, { withFileTypes: true })) {
      if (entry.isFile() && !entry.name.startsWith(".")) {
        result.add(entry.name);
      }
    }
  } catch {
    // skip unreadable
  }
  return result;
}

function readJsonFile(filePath: string): Record<string, any> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    return null;
  }
}

function detectPackageManager(
  cwd: string,
  files: Set<string>,
): string | null {
  if (files.has("pnpm-lock.yaml") || files.has("pnpm-workspace.yaml")) {
    return "pnpm";
  }
  if (files.has("yarn.lock")) return "yarn";
  if (files.has("package-lock.json")) return "npm";
  if (files.has("bun.lockb")) return "bun";
  return null;
}

function detectPythonPM(
  cwd: string,
  files: Set<string>,
): string | null {
  if (files.has("poetry.lock")) return "poetry";
  if (files.has("Pipfile")) return "pipenv";
  if (files.has("requirements.txt")) return "pip";
  return null;
}

function detectFramework(pkg: Record<string, any> | null): string | null {
  if (!pkg) return null;
  const deps = {
    ...(pkg.dependencies as Record<string, unknown> ?? {}),
    ...(pkg.devDependencies as Record<string, unknown> ?? {}),
  };
  if ("next" in deps) return "next.js";
  if ("react" in deps && "vite" in deps) return "vite-react";
  if ("react" in deps) return "react";
  if ("vue" in deps) return "vue";
  if ("svelte" in deps) return "svelte";
  if ("express" in deps) return "express";
  if ("fastify" in deps) return "fastify";
  return null;
}

function findScript(
  scripts: Record<string, any>,
  candidates: string[],
): string | null {
  if (!scripts) return null;
  for (const name of candidates) {
    if (typeof scripts[name] === "string") {
      return scripts[name] as string;
    }
  }
  return null;
}
