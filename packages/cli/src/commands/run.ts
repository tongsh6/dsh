import type { DeepSeekClient } from "@dsh/provider";
import { runFullPipeline } from "@dsh/core";
import type { TaskState } from "@dsh/core";
import { createClient } from "../utils/config.js";

type TaskType = "bugfix" | "feature" | "refactor" | "test" | "docs";

export interface RunOptions {
  type?: string;
  dryRun?: boolean;
  maxRepairRounds?: number | string;
}

export interface RunCommandDeps {
  createClient: (cwd: string) => DeepSeekClient;
  runFullPipeline: typeof runFullPipeline;
}

const defaultDeps: RunCommandDeps = {
  createClient,
  runFullPipeline,
};

function parseTaskType(value: string | undefined): TaskType {
  const raw = value ?? "feature";
  if (raw === "bugfix" || raw === "feature" || raw === "refactor" || raw === "test" || raw === "docs") return raw;
  throw new Error(`不支持的任务类型: ${raw}`);
}

function parseRepairRounds(value: number | string | undefined): number {
  if (value === undefined) return 5;
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`无效的 --max-repair-rounds: ${value}`);
  return n;
}

function summarizeChangedFiles(state: TaskState): string[] {
  return [...new Set(state.patches.flatMap((p) => p.files_changed))].sort();
}

function summarizeVerify(state: TaskState): string {
  const latest = state.verify_results.at(-1);
  if (!latest || latest.results.length === 0) return "not_run";
  const passed = latest.results.filter((r) => r.status === "passed").length;
  return `${passed}/${latest.results.length} passed`;
}

function nextAction(state: TaskState): string {
  if (state.status === "verified") return "handoff complete";
  if (state.status === "repair_exhausted") return "manual intervention";
  if (state.status === "patch_failed") return "inspect patch failure";
  return "inspect task state";
}

export function formatRunSummary(state: TaskState): string[] {
  const changed = summarizeChangedFiles(state);
  return [
    `Status: ${state.status}`,
    `Changed files: ${changed.length > 0 ? changed.join(", ") : "(none)"}`,
    `Verify summary: ${summarizeVerify(state)}`,
    `Repair rounds: ${state.repair_rounds}`,
    `Handoff path: ${state.handoff_path ?? "(none)"}`,
    `Next action: ${nextAction(state)}`,
  ];
}

export async function runCommand(
  description: string,
  opts: RunOptions,
  deps: RunCommandDeps = defaultDeps,
): Promise<void> {
  const cwd = process.cwd();

  let client: DeepSeekClient;
  try {
    client = deps.createClient(cwd);
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  let state: TaskState;
  try {
    state = await deps.runFullPipeline({
      cwd,
      client,
      description,
      taskType: parseTaskType(opts.type),
      auto: true,
      dryRun: !!opts.dryRun,
      maxRepairRounds: parseRepairRounds(opts.maxRepairRounds),
    });
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  for (const line of formatRunSummary(state)) console.log(line);
}
