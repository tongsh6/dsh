import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

// ---- Schema ----

const verifyResultSchema = z.object({
  command: z.string(),
  status: z.enum(["passed", "failed"]),
  exit_code: z.number(),
  output: z.string(),
  duration_ms: z.number(),
});

const patchRecordSchema = z.object({
  round: z.number(),
  patch: z.string(),
  apply_status: z.enum(["ok", "failed", "skipped"]),
  files_changed: z.array(z.string()),
});

const planSchema = z.object({
  summary: z.string(),
  files: z.array(z.string()),
  risks: z.array(z.string()),
  raw_xml: z.string(),
  verify_commands: z.array(z.string()).optional(),
});

const verifyRoundSchema = z.object({
  round: z.number(),
  results: z.array(verifyResultSchema),
});

const staticScanFindingSchema = z.object({
  id: z.string(),
  file: z.string(),
  line: z.number().nullable(),
  column: z.number().nullable(),
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
  rule: z.string().nullable(),
});

const staticScanRunSchema = z.object({
  round: z.number(),
  command: z.string(),
  status: z.enum(["passed", "failed"]),
  exit_code: z.number(),
  duration_ms: z.number(),
  output_path: z.string(),
  output_excerpt: z.string(),
  total_findings: z.number(),
  selected_top_n: z.array(staticScanFindingSchema),
  top_n_reasoning: z.array(z.string()),
  created_at: z.string(),
});

const staticRepairResultSchema = z.object({
  round: z.number(),
  scan_round: z.number(),
  selected_finding_ids: z.array(z.string()),
  strategy: z.string(),
  patch: z.string(),
  apply_status: z.enum(["ok", "failed", "skipped"]),
  files_changed: z.array(z.string()),
  post_scan_round: z.number().optional(),
  post_scan_status: z.enum(["passed", "failed", "skipped"]),
  remaining_findings: z.number(),
  error: z.string().optional(),
  created_at: z.string(),
});

export const taskStateSchema = z.object({
  version: z.literal("0.1"),
  status: z.enum([
    "init",
    "planned",
    "patched",
    "verified",
    "verification_failed",
    "repairing",
    "repair_exhausted",
    "done",
  ]),
  task: z.object({
    description: z.string(),
    type: z.enum(["bugfix", "feature", "refactor", "test", "docs"]),
    created_at: z.string(),
  }),
  plan: planSchema.optional(),
  patches: z.array(patchRecordSchema).default([]),
  verify_results: z.array(verifyRoundSchema).default([]),
  static_scan_runs: z.array(staticScanRunSchema).default([]),
  static_repair_results: z.array(staticRepairResultSchema).default([]),
  repair_rounds: z.number().default(0),
  handoff_path: z.string().optional(),
});

export type TaskState = z.infer<typeof taskStateSchema>;
export type VerifyResult = z.infer<typeof verifyResultSchema>;
export type PatchRecord = z.infer<typeof patchRecordSchema>;
export type StaticScanFinding = z.infer<typeof staticScanFindingSchema>;
export type StaticScanRun = z.infer<typeof staticScanRunSchema>;
export type StaticRepairResult = z.infer<typeof staticRepairResultSchema>;

export type TaskStatus = TaskState["status"];

// ---- State machine ----

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  "init": ["planned"],
  "planned": ["patched"],
  "patched": ["verified", "verification_failed"],
  "verified": ["done"],
  "verification_failed": ["repairing", "repair_exhausted"],
  "repairing": ["patched", "repair_exhausted"],
  "repair_exhausted": ["done"],
  "done": [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

// ---- File I/O ----

const STATE_FILE = ".dsh/task-state.json";

export function readTaskState(cwd: string): TaskState | null {
  const filePath = path.join(cwd, STATE_FILE);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const json = JSON.parse(raw);
    return taskStateSchema.parse(json);
  } catch {
    return null;
  }
}

export function writeTaskState(cwd: string, state: TaskState): void {
  const dshDir = path.join(cwd, ".dsh");
  fs.mkdirSync(dshDir, { recursive: true });
  const filePath = path.join(cwd, STATE_FILE);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export function transition(
  state: TaskState,
  newStatus: TaskStatus,
): TaskState {
  if (!canTransition(state.status, newStatus)) {
    throw new Error(
      `Invalid state transition: ${state.status} -> ${newStatus}`,
    );
  }
  return { ...state, status: newStatus };
}

// ---- Factory ----

export function createTaskState(
  description: string,
  taskType: TaskState["task"]["type"],
): TaskState {
  return {
    version: "0.1",
    status: "init",
    task: {
      description,
      type: taskType,
      created_at: new Date().toISOString(),
    },
    patches: [],
    verify_results: [],
    static_scan_runs: [],
    static_repair_results: [],
    repair_rounds: 0,
  };
}
