import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface TechStack {
  language: string;
  packageManager: string | null;
  framework: string | null;
  details: Record<string, string>;
}

export interface VerifyCommands {
  test: string | null;
  lint: string | null;
  typecheck: string | null;
  build: string | null;
}

export interface RepoContext {
  techStack: TechStack;
  verifyCommands: VerifyCommands;
  directoryTree: string;
  keyFiles: string[];
  recentChanges: string | null;
}

export function detectTechStack(cwd: string): TechStack {
  const files = listFiles(cwd, 1);

  // Node / TypeScript
  if (files.has("package.json")) {
    const pkg = readJsonFile(path.join(cwd, "package.json"));
    const hasTypeScript = files.has("tsconfig.json") ||
      (pkg?.devDependencies && "typescript" in (pkg.devDependencies ?? {}));
    const pkgManager = detectPackageManager(cwd, files);

    return {
      language: hasTypeScript ? "typescript" : "javascript",
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
  if (files.has("pyproject.toml")) {
    return {
      language: "python",
      packageManager: detectPythonPM(cwd, files),
      framework: null,
      details: {},
    };
  }

  // Go
  if (files.has("go.mod")) {
    return {
      language: "go",
      packageManager: null,
      framework: null,
      details: {},
    };
  }

  // Rust
  if (files.has("Cargo.toml")) {
    return {
      language: "rust",
      packageManager: null,
      framework: null,
      details: {},
    };
  }

  // Fallback: detect by file extensions
  const extLang = detectLanguageByFiles(cwd);
  if (extLang) return extLang;

  return {
    language: "unknown",
    packageManager: null,
    framework: null,
    details: {},
  };
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
    return { language: "python", packageManager: "pip", framework: null, details: {} };
  }
  if (tsCount >= threshold) {
    return { language: "typescript", packageManager: "npm", framework: null, details: {} };
  }
  if (jsCount >= threshold && jsCount > tsCount) {
    return { language: "javascript", packageManager: "npm", framework: null, details: {} };
  }
  if (goCount >= threshold) {
    return { language: "go", packageManager: null, framework: null, details: {} };
  }
  if (rsCount >= threshold) {
    return { language: "rust", packageManager: null, framework: null, details: {} };
  }

  return null;
}

export function detectVerifyCommands(
  cwd: string,
  stack: TechStack,
): VerifyCommands {
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

  return { test: null, lint: null, typecheck: null, build: null };
}

export function generateRepoContext(
  cwd: string,
  stack: TechStack,
  maxDepth: number = 3,
): RepoContext {
  const tree = generateDirectoryTree(cwd, maxDepth);
  const keyFiles = findKeyFiles(cwd);
  const recentChanges = getRecentGitLog(cwd, 20);

  return {
    techStack: stack,
    verifyCommands: detectVerifyCommands(cwd, stack),
    directoryTree: tree,
    keyFiles,
    recentChanges,
  };
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
  // fallback: try first candidate with inferred runner
  for (const name of candidates) {
    if (typeof scripts[name] === "string") return scripts[name] as string;
  }
  return null;
}

function generateDirectoryTree(cwd: string, maxDepth: number): string {
  const lines: string[] = [];
  const rootName = path.basename(cwd) || ".";

  function walk(dir: string, prefix: string, depth: number) {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // filter hidden and noise
    entries = entries.filter((e) =>
      !e.name.startsWith(".") &&
      e.name !== "node_modules" &&
      e.name !== "dist" &&
      e.name !== "__pycache__" &&
      e.name !== "target" &&
      e.name !== ".git"
    );

    // sort dirs first
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const isLast = i === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const fullPath = path.join(dir, entry.name);

      lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? "/" : ""}`);

      if (entry.isDirectory()) {
        const nextPrefix = prefix + (isLast ? "    " : "│   ");
        walk(fullPath, nextPrefix, depth + 1);
      }
    }
  }

  lines.push(`${rootName}/`);
  walk(cwd, "", 1);
  return lines.join("\n");
}

function findKeyFiles(cwd: string): string[] {
  const candidates = [
    "package.json",
    "tsconfig.json",
    "pyproject.toml",
    "go.mod",
    "Cargo.toml",
    "README.md",
    "CLAUDE.md",
    "AGENTS.md",
    ".cursorrules",
    "AIEF",
  ];

  return candidates.filter((f) => {
    try {
      return fs.existsSync(path.join(cwd, f));
    } catch {
      return false;
    }
  });
}

function getRecentGitLog(cwd: string, count: number): string | null {
  try {
    return execSync(`git log --oneline -${count}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim() || null;
  } catch {
    return null;
  }
}
