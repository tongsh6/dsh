import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { z } from "zod";
import type { ProtocolOp } from "@dsh/core";

export type { ProtocolOp };

export const PROTOCOL_OP_SCHEMA = z.enum([
  "CREATE",
  "PATCH",
  "SEARCH_REPLACE",
  "INSERT",
  "DELETE",
  "RENAME",
]);

export const BENCHMARK_REPO_SCHEMA = z.enum([
  "loamlog",
  "pi-proof-forge",
  "release-hub",
]);

export const BENCHMARK_REF_SCHEMA = z.object({
  repo: BENCHMARK_REPO_SCHEMA.optional(),
  branch: z.string().min(1).optional(),
  commit: z.string().min(7).optional(),
});

// Structured verify assertion schema (spec 2026-05-08-verify-protocol-structured §3).
// Discriminated by `type`; loose validation here — runtime parsing in @dsh/core.
export const VERIFY_ASSERTION_SCHEMA = z.union([
  z.object({
    type: z.literal("file_exists"),
    file: z.string().min(1),
    name: z.string().optional(),
  }),
  z.object({
    type: z.literal("file_not_exists"),
    file: z.string().min(1),
    name: z.string().optional(),
  }),
  z.object({
    type: z.literal("file_contains"),
    file: z.string().min(1),
    pattern: z.string().min(1),
    regex: z.boolean().optional(),
    name: z.string().optional(),
  }),
  z.object({
    type: z.literal("file_not_contains"),
    file: z.string().min(1),
    pattern: z.string().min(1),
    regex: z.boolean().optional(),
    name: z.string().optional(),
  }),
  z.object({
    type: z.literal("shell"),
    command: z.string().min(1),
    timeout_ms: z.number().int().positive().optional(),
    name: z.string().optional(),
  }),
  z.object({
    type: z.literal("maven_test"),
    project_dir: z.string().min(1).optional(),
    module: z.string().min(1),
    tests: z.string().min(1).optional(),
    also_make: z.boolean().optional(),
    quiet: z.boolean().optional(),
    timeout_ms: z.number().int().positive().optional(),
    name: z.string().optional(),
  }),
]);

export type VerifyAssertion = z.infer<typeof VERIFY_ASSERTION_SCHEMA>;

export const TASK_FIXTURE_SCHEMA = z.object({
  id: z.string(),
  description: z.string(),
  category: z.enum(["bugfix", "feature", "refactor", "test", "docs", "failure_mode"]),
  taskPrompt: z.string(),
  expectedFiles: z.array(z.string()).default([]),
  expectPass: z.boolean().default(true),
  verificationCommands: z.array(z.string()).default([]),
  // Structured assertions (preferred over verificationCommands when present).
  // Mutual exclusion with verificationCommands enforced by .superRefine below.
  verifications: z.array(VERIFY_ASSERTION_SCHEMA).optional(),
  architectureRules: z.array(z.string()).default([]),
  maxRepairRounds: z.number().optional(),
  repoPath: z.string().optional(),
  benchmarkRef: BENCHMARK_REF_SCHEMA.optional(),
  preflightFiles: z.array(z.string()).default([]),
  designGoal: z.string().optional(),
  verificationGoal: z.string().optional(),
  expectedProtocolOperations: z.array(PROTOCOL_OP_SCHEMA).min(1,
    "expectedProtocolOperations is required — must list at least one protocol operation"),
}).superRefine((data, ctx) => {
  if (
    data.verifications && data.verifications.length > 0 &&
    data.verificationCommands && data.verificationCommands.length > 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "verifications and verificationCommands are mutually exclusive — declare one or the other, not both",
      path: ["verifications"],
    });
  }
});

export interface TaskFixture extends z.infer<typeof TASK_FIXTURE_SCHEMA> {
  id: string;
  description: string;
  category: "bugfix" | "feature" | "refactor" | "test" | "docs" | "failure_mode";
  taskPrompt: string;
  expectedFiles: string[];
  expectPass: boolean;
  verificationCommands: string[];
  verifications?: VerifyAssertion[];
  architectureRules: string[];
  maxRepairRounds?: number;
  repoPath?: string;
  benchmarkRef?: z.infer<typeof BENCHMARK_REF_SCHEMA>;
  preflightFiles: string[];
  designGoal?: string;
  verificationGoal?: string;
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
      verifications: validated.verifications,
      architectureRules: validated.architectureRules,
      maxRepairRounds: validated.maxRepairRounds,
      repoPath: validated.repoPath,
      benchmarkRef: validated.benchmarkRef,
      preflightFiles: validated.preflightFiles,
      designGoal: validated.designGoal,
      verificationGoal: validated.verificationGoal,
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
          // loadFixture wraps ZodError in plain Error with { cause }
          const cause = e instanceof Error ? e.cause : undefined;
          if (cause instanceof z.ZodError) {
            const issues = cause.issues.map(
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
