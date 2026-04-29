import * as fs from "node:fs";
import * as path from "node:path";
import fg from "fast-glob";

export interface RankedFile {
  path: string;
  score: number;
  content: string | null;
}

export function rankFiles(
  description: string,
  fileList: string[],
): RankedFile[] {
  const keywords = extractKeywords(description);

  return fileList
    .map((filePath) => ({
      path: filePath,
      score: scoreFile(filePath, keywords),
      content: null,
    }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function loadTopFiles(
  cwd: string,
  ranked: RankedFile[],
  limit: number,
): RankedFile[] {
  return ranked.slice(0, limit).map((f) => ({
    ...f,
    content: readFileSafe(path.join(cwd, f.path)),
  }));
}

export async function scanProjectFiles(
  cwd: string,
  include: string[] = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go", "**/*.rs"],
  exclude: string[] = ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/__pycache__/**", "**/target/**"],
): Promise<string[]> {
  try {
    const files = await fg(include, {
      cwd,
      ignore: exclude,
      absolute: false,
    });
    return files;
  } catch {
    return [];
  }
}

// ---- helpers ----

function extractKeywords(description: string): string[] {
  // split on non-word chars, filter short words, de-dupe
  return [...new Set(
    description
      .toLowerCase()
      .split(/[\s,;:.!?()\[\]{}"']+/)
      .filter((w) => w.length > 1),
  )];
}

function scoreFile(filePath: string, keywords: string[]): number {
  const lower = filePath.toLowerCase();
  const name = path.basename(lower);
  let score = 0;

  for (const kw of keywords) {
    // exact match in file name
    if (name.includes(kw)) score += 5;
    // match in path
    if (lower.includes(kw)) score += 2;
    // partial word match (e.g. "token" matches "token.ts")
    if (name.startsWith(kw) || name.endsWith(kw)) score += 3;
  }

  return score;
}

function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
