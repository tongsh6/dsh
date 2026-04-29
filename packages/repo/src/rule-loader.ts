import * as fs from "node:fs";
import * as path from "node:path";

export interface RuleFile {
  path: string;
  name: string;
  content: string;
}

const RULE_CANDIDATES = [
  ".cursorrules",
  "CLAUDE.md",
  "AGENTS.md",
  "AIEF",
  ".github/copilot-instructions.md",
  ".aider.conf.yml",
  ".windsurfrules",
];

export function findRuleFiles(cwd: string): string[] {
  const found: string[] = [];

  for (const relPath of RULE_CANDIDATES) {
    const absPath = path.join(cwd, relPath);
    try {
      const stat = fs.statSync(absPath);
      if (stat.isFile()) {
        found.push(relPath);
      }
    } catch {
      // file not found, skip
    }
  }

  // also check AIEF directory
  const aiefDir = path.join(cwd, "AIEF");
  try {
    const entries = fs.readdirSync(aiefDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))) {
        found.push(`AIEF/${entry.name}`);
      }
    }
  } catch {
    // no AIEF dir
  }

  return found;
}

export function loadRuleFiles(cwd: string, files: string[]): RuleFile[] {
  return files.map((relPath) => {
    const absPath = path.join(cwd, relPath);
    try {
      const content = fs.readFileSync(absPath, "utf-8");
      return {
        path: relPath,
        name: path.basename(relPath),
        content,
      };
    } catch {
      return {
        path: relPath,
        name: path.basename(relPath),
        content: `[could not read: ${relPath}]`,
      };
    }
  });
}

export function loadRuleContents(cwd: string): RuleFile[] {
  const files = findRuleFiles(cwd);
  return loadRuleFiles(cwd, files);
}
