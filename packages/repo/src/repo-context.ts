import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProjectIntelligence, TechStack } from "./intelligence.js";
import { toLegacyTechStack } from "./intelligence.js";

export interface VerifyCommands {
  test: string | null;
  lint: string | null;
  typecheck: string | null;
  build: string | null;
}

export interface RepoContext {
  techStack: TechStack;
  intelligence: ProjectIntelligence;
  verifyCommands: VerifyCommands;
  directoryTree: string;
  keyFiles: string[];
  recentChanges: string | null;
}

export function generateRepoContext(
  cwd: string,
  pi: ProjectIntelligence,
  maxDepth: number = 3,
): RepoContext {
  const techStack = toLegacyTechStack(cwd, pi);
  const tree = generateDirectoryTree(cwd, maxDepth);
  const keyFiles = findKeyFiles(cwd);
  const recentChanges = getRecentGitLog(cwd, 20);

  return {
    techStack,
    intelligence: pi,
    verifyCommands: { test: null, lint: null, typecheck: null, build: null },
    directoryTree: tree,
    keyFiles,
    recentChanges,
  };
}

// ---- Directory tree ----

function generateDirectoryTree(cwd: string, maxDepth: number): string {
  const lines: string[] = [];
  const rootName = path.basename(cwd) || ".";

  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries = entries.filter((e) =>
      !e.name.startsWith(".") &&
      e.name !== "node_modules" &&
      e.name !== "dist" &&
      e.name !== "__pycache__" &&
      e.name !== "target" &&
      e.name !== ".git"
    );

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
