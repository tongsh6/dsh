import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const productionRoots = [
  "packages/core/src",
  "packages/cli/src",
  "packages/repo/src",
];

const forbidden = /\b(?:detectTechStack|detectVerifyCommands)\b/;
const allowedRelativePaths = new Set([
  "packages/repo/src/legacy-scanner.ts",
]);

function walk(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      files.push(...walk(full));
    } else if (entry.isFile() && full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("legacy scanner guard", () => {
  it("production path must not import or call legacy scanner APIs", () => {
    const offenders: string[] = [];
    for (const root of productionRoots) {
      for (const file of walk(path.join(repoRoot, root))) {
        const rel = path.relative(repoRoot, file);
        if (allowedRelativePaths.has(rel) || rel.includes("/compat/") || rel.includes("/migration/")) continue;
        const content = fs.readFileSync(file, "utf-8");
        if (forbidden.test(content)) offenders.push(rel);
      }
    }

    assert.deepEqual(offenders, [], `legacy scanner API leaked into production files: ${offenders.join(", ")}`);
  });
});
