import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

export interface TaskFixture {
  id: string;
  description: string;
  category: "bugfix" | "feature" | "refactor" | "test" | "docs" | "failure_mode";
  taskPrompt: string;
  expectedFiles: string[];
  expectPass: boolean;
  verificationCommands: string[];
  architectureRules: string[];
  maxRepairRounds?: number;
  repoPath?: string;
}

export interface LoadedFixture extends TaskFixture {
  filePath: string;
}

export function loadFixture(filePath: string): LoadedFixture {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw) as Record<string, unknown>;
  const fixture: LoadedFixture = {
    id: parsed.id as string,
    description: parsed.description as string,
    category: parsed.category as TaskFixture["category"],
    taskPrompt: parsed.taskPrompt as string,
    expectedFiles: (parsed.expectedFiles as string[]) ?? [],
    expectPass: (parsed.expectPass as boolean) ?? true,
    verificationCommands: (parsed.verificationCommands as string[]) ?? [],
    architectureRules: (parsed.architectureRules as string[]) ?? [],
    maxRepairRounds: parsed.maxRepairRounds as number | undefined,
    repoPath: parsed.repoPath as string | undefined,
    filePath,
  };
  return fixture;
}

export function loadAllFixtures(dir: string): LoadedFixture[] {
  const fixtures: LoadedFixture[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
        fixtures.push(loadFixture(path.join(dir, entry.name)));
      }
    }
  } catch {
    // no fixtures dir
  }
  return fixtures;
}
