import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { z } from "zod";

/** v0.3 协议操作类型（SPEC v0.3 §7.3.2） */
export type ProtocolOp = "CREATE" | "PATCH" | "SEARCH_REPLACE" | "INSERT" | "DELETE" | "RENAME";

export const PROTOCOL_OP_SCHEMA = z.enum([
  "CREATE",
  "PATCH",
  "SEARCH_REPLACE",
  "INSERT",
  "DELETE",
  "RENAME",
]);

export const TASK_FIXTURE_SCHEMA = z.object({
  id: z.string(),
  description: z.string(),
  category: z.enum(["bugfix", "feature", "refactor", "test", "docs", "failure_mode"]),
  taskPrompt: z.string(),
  expectedFiles: z.array(z.string()).default([]),
  expectPass: z.boolean().default(true),
  verificationCommands: z.array(z.string()).default([]),
  architectureRules: z.array(z.string()).default([]),
  maxRepairRounds: z.number().optional(),
  repoPath: z.string().optional(),
  expectedProtocolOperations: z.array(PROTOCOL_OP_SCHEMA).min(1,
    "expectedProtocolOperations is required — must list at least one protocol operation"),
});

export interface TaskFixture extends z.infer<typeof TASK_FIXTURE_SCHEMA> {
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
  expectedProtocolOperations: ProtocolOp[];
}

export interface LoadedFixture extends TaskFixture {
  filePath: string;
}

export function loadFixture(filePath: string): LoadedFixture {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw) as Record<string, unknown>;
  try {
    const validated = TASK_FIXTURE_SCHEMA.parse(parsed);
    const fixture: LoadedFixture = {
      id: validated.id,
      description: validated.description,
      category: validated.category,
      taskPrompt: validated.taskPrompt,
      expectedFiles: validated.expectedFiles,
      expectPass: validated.expectPass,
      verificationCommands: validated.verificationCommands,
      architectureRules: validated.architectureRules,
      maxRepairRounds: validated.maxRepairRounds,
      repoPath: validated.repoPath,
      expectedProtocolOperations: validated.expectedProtocolOperations,
      filePath,
    };
    return fixture;
  } catch (e) {
    if (e instanceof z.ZodError) {
      const issues = e.issues.map(
        (i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`,
      ).join("\n");
      throw new Error(
        `Fixture "${filePath}" validation failed:\n${issues}`,
        { cause: e },
      );
    }
    throw new Error(
      `Failed to parse fixture "${filePath}": ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
}

export function loadAllFixtures(dir: string): LoadedFixture[] {
  const fixtures: LoadedFixture[] = [];
  const errors: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
        const filePath = path.join(dir, entry.name);
        try {
          fixtures.push(loadFixture(filePath));
        } catch (e) {
          if (e instanceof z.ZodError) {
            const issues = e.issues.map(
              (i) => `    ${i.path.join(".") || "(root)"}: ${i.message}`,
            ).join("\n");
            errors.push(`${entry.name}: validation failed:\n${issues}`);
          } else {
            const msg = e instanceof Error ? e.message : String(e);
            errors.push(`${entry.name}: ${msg}`);
          }
        }
      }
    }
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return fixtures;
    }
    throw new Error(
      `Failed to read fixtures directory "${dir}": ${err?.message ?? String(e)}`,
      { cause: e },
    );
  }
  if (errors.length > 0) {
    throw new Error(
      `Failed to load ${errors.length} fixture(s):\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
  return fixtures;
}
