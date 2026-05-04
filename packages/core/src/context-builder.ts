import type { TaskState } from "./task-state.js";
import type { RuleFile, RepoContext, RankedFile } from "@dsh/repo";

export interface ContextLayers {
  base: string;
  repo: string;
  task: string;
  dynamic: string | null;
  estimatedTokens: number;
}

export interface ContextInput {
  config: Record<string, any>;
  rules: RuleFile[];
  repoContext: RepoContext;
  taskState: TaskState;
  taskFiles: RankedFile[];
  maxDynamicRounds?: number;
}

const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 3.5;

export function buildBaseContext(
  rules: RuleFile[],
  config: Record<string, any>,
): string {
  const parts: string[] = [];

  parts.push("## Project Rules");
  for (const rule of rules) {
    parts.push(`### ${rule.path}`);
    parts.push(rule.content);
    parts.push("");
  }

  if (Object.keys(config).length > 0) {
    parts.push("## Project Configuration");
    parts.push(JSON.stringify(config, null, 2));
  }

  return parts.join("\n");
}

export function buildRepoContext(ctx: RepoContext): string {
  const parts: string[] = [];

  parts.push(`## Tech Stack: ${ctx.techStack.language}`);
  if (ctx.techStack.framework) {
    parts.push(`Framework: ${ctx.techStack.framework}`);
  }
  if (ctx.techStack.modules && ctx.techStack.modules.length > 0) {
    parts.push("Sub-projects:");
    for (const m of ctx.techStack.modules) {
      const fw = m.framework ? ` (${m.framework})` : "";
      parts.push(`  - ${m.path}/  ${m.language}${fw}`);
    }
  }

  parts.push("");
  parts.push("## Directory Structure");
  parts.push("```");
  parts.push(ctx.directoryTree);
  parts.push("```");

  if (ctx.recentChanges) {
    parts.push("");
    parts.push("## Recent Git History");
    parts.push("```");
    parts.push(ctx.recentChanges);
    parts.push("```");
  }

  return parts.join("\n");
}

export function buildTaskContext(
  taskState: TaskState,
  taskFiles: RankedFile[],
): string {
  const parts: string[] = [];

  parts.push("## Task");
  parts.push(`Description: ${taskState.task.description}`);
  parts.push(`Type: ${taskState.task.type}`);

  if (taskState.plan) {
    parts.push("");
    parts.push("## Plan");
    parts.push(taskState.plan.raw_xml);
  }

  if (taskFiles.length > 0) {
    parts.push("");
    parts.push("## Relevant Files");
    for (const file of taskFiles) {
      parts.push(`### ${file.path}`);
      parts.push("```");
      parts.push(file.content ?? "[file not readable]");
      parts.push("```");
      parts.push("");
    }
  }

  return parts.join("\n");
}

export function buildDynamicContext(
  patches: TaskState["patches"],
  verifyResults: TaskState["verify_results"],
  maxRounds: number = 2,
): string | null {
  if (patches.length === 0 && verifyResults.length === 0) {
    return null;
  }

  const parts: string[] = [];
  parts.push("## Previous Attempts");

  // Only keep the most recent N rounds
  const recentPatches = patches.slice(-maxRounds);
  const recentResults = verifyResults.slice(-maxRounds);

  for (let i = 0; i < Math.max(recentPatches.length, recentResults.length); i++) {
    const round = i + 1;
    parts.push(`### Round ${round}`);

    const patch = recentPatches[i];
    if (patch) {
      parts.push(`**Patch (${patch.apply_status}):**`);
      parts.push("```diff");
      parts.push(patch.patch);
      parts.push("```");
    }

    const results = recentResults[i];
    if (results) {
      parts.push("**Verify Results:**");
      for (const r of results.results) {
        parts.push(`- ${r.status === "passed" ? "PASS" : "FAIL"} ${r.command}`);
        if (r.status === "failed") {
          parts.push("```");
          parts.push(smartTruncateVerifyOutput(r.output, 3000));
          parts.push("```");
        }
      }
    }
    parts.push("");
  }

  return parts.join("\n");
}

export function assembleContext(input: ContextInput): ContextLayers {
  const base = buildBaseContext(input.rules, input.config);
  const repo = buildRepoContext(input.repoContext);
  const task = buildTaskContext(input.taskState, input.taskFiles);
  const dynamic = buildDynamicContext(
    input.taskState.patches,
    input.taskState.verify_results,
    input.maxDynamicRounds,
  );

  const totalChars = base.length + repo.length + task.length +
    (dynamic?.length ?? 0);
  const estimatedTokens = Math.ceil(totalChars / TOKEN_ESTIMATE_CHARS_PER_TOKEN);

  return { base, repo, task, dynamic, estimatedTokens };
}

function smartTruncateVerifyOutput(output: string, maxChars: number = 3000): string {
  if (output.length <= maxChars) return output;

  const lines = output.split("\n");
  const headCount = Math.min(20, lines.length);
  const headLines = lines.slice(0, headCount);
  const remainingChars = maxChars - headLines.join("\n").length - 100;

  if (remainingChars <= 0) return headLines.join("\n") + "\n...[truncated]";

  const errorPatterns: RegExp[] = [
    /error/i, /fail/i, /Error/, /FAIL/, /TypeError/, /ReferenceError/,
    /assert/i, /AssertionError/, /expected/i, /received/i, /traceback/i,
    /File\s+"/, /line\s+\d+/i, /TS\d+/, /at\s+\S+\.\S+/,
  ];

  const tailLines: string[] = [];
  let tailChars = 0;
  for (let i = headCount; i < lines.length; i++) {
    const line = lines[i]!;
    const isErrorLine = errorPatterns.some((p) => p.test(line));
    if (isErrorLine && tailChars + line.length + 1 < remainingChars) {
      tailLines.push(line);
      tailChars += line.length + 1;
    }
  }

  const result = headLines.join("\n");
  if (tailLines.length > 0) {
    return result + "\n...[error lines]\n" + tailLines.join("\n");
  }
  return result + "\n...[" + (lines.length - headCount) + " lines truncated]";
}
