import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DeepSeekClient } from "@dsh/provider";
import {
  detectTechStack,
  generateRepoContext,
  loadRuleContents,
  loadTopFiles,
} from "@dsh/repo";
import type { RankedFile } from "@dsh/repo";
import { assembleContext } from "./context-builder.js";
import { buildMessages } from "./prompt-builder.js";
import { applyChanges, parseChanges } from "./patch-parser.js";
import { parseFindings } from "./static-finding-parser.js";
import type {
  StaticRepairResult,
  StaticScanFinding,
  StaticScanRun,
  TaskState,
} from "./task-state.js";

export interface StaticScanConfig {
  enabled: boolean;
  command: string | null;
  topN: number;
}

export interface StaticScanResult {
  run: StaticScanRun;
  findings: StaticScanFinding[];
}

interface RunCommandResult {
  exitCode: number;
  output: string;
  durationMs: number;
}

const DEFAULT_TOP_N = 5;
const MAX_REPAIR_CONTEXT_FILES = 10;

export function resolveStaticScanConfig(config: Record<string, unknown>): StaticScanConfig {
  const staticConfig = isRecord(config["static_scan"]) ? config["static_scan"] : {};
  const verifyConfig = isRecord(config["verify"]) ? config["verify"] : {};
  const explicitCommand = typeof staticConfig["command"] === "string"
    ? staticConfig["command"].trim()
    : "";
  const fallbackCommand = typeof verifyConfig["lint"] === "string"
    ? verifyConfig["lint"].trim()
    : "";
  const topN = typeof staticConfig["top_n"] === "number" && staticConfig["top_n"] > 0
    ? Math.floor(staticConfig["top_n"])
    : DEFAULT_TOP_N;
  const enabled = staticConfig["enabled"] !== false;

  return {
    enabled,
    command: explicitCommand || fallbackCommand || null,
    topN,
  };
}

export function runStaticScan(
  cwd: string,
  command: string,
  round: number,
  changedFiles: string[] = [],
  topN: number = DEFAULT_TOP_N,
): StaticScanResult {
  const result = runCommand(command, cwd);
  const outputPath = writeScanOutput(cwd, round, result.output);
  const findings = parseStaticScanFindings(result.output, cwd, round, result.exitCode !== 0);
  const selected = selectTopFindings(findings, changedFiles, topN);
  const run: StaticScanRun = {
    round,
    command,
    status: result.exitCode === 0 ? "passed" : "failed",
    exit_code: result.exitCode,
    duration_ms: result.durationMs,
    output_path: outputPath,
    output_excerpt: result.output.slice(0, 4000),
    total_findings: findings.length,
    selected_top_n: selected,
    top_n_reasoning: buildTopNReasoning(selected, changedFiles, topN),
    created_at: new Date().toISOString(),
  };

  return { run, findings };
}

export async function repairStaticScanTopN(params: {
  cwd: string;
  client: DeepSeekClient;
  state: TaskState;
  scanRun: StaticScanRun;
  selectedFindings: StaticScanFinding[];
  command: string;
  topN: number;
}): Promise<{
  repair: StaticRepairResult;
  patchRecord?: TaskState["patches"][number];
  postScan?: StaticScanResult;
}> {
  const { cwd, client, state, scanRun, selectedFindings, command, topN } = params;
  const round = (state.static_repair_results?.length ?? 0) + 1;

  if (selectedFindings.length === 0) {
    return {
      repair: {
        round,
        scan_round: scanRun.round,
        selected_finding_ids: [],
        strategy: "No findings selected for Top N repair.",
        patch: "",
        apply_status: "skipped",
        files_changed: [],
        post_scan_status: "skipped",
        remaining_findings: scanRun.total_findings,
        created_at: new Date().toISOString(),
      },
    };
  }

  const context = buildStaticRepairContext(cwd, state, selectedFindings);
  const strategy = [
    `Fix only the selected Top ${Math.min(topN, selectedFindings.length)} static scan findings.`,
    "Selection method: error severity first, files changed by the AI patch first, then scanner order.",
    "Do not refactor unrelated code or fix unselected findings unless required by the selected findings.",
  ].join(" ");

  const taskDescription = [
    "STATIC CODE SCAN FAILED AFTER AI CODE IMPLEMENTATION.",
    "",
    strategy,
    "",
    "Scanner command:",
    command,
    "",
    "Selected findings:",
    formatFindings(selectedFindings),
    "",
    "Return the smallest possible patch that fixes these selected findings.",
  ].join("\n");

  const response = await client.chat({
    model: "deepseek-v4-pro",
    messages: buildMessages({ context, taskDescription, phase: "patch" }),
    thinking: true,
  });

  const content = response.choices[0]?.message.content ?? "";
  let patch = "";
  let applyStatus: "ok" | "failed" = "failed";
  let filesChanged: string[] = [];
  let error: string | undefined;
  let patchRecord: TaskState["patches"][number] | undefined;
  let postScan: StaticScanResult | undefined;

  try {
    const changes = parseChanges(content);
    patch = [
      ...changes.creates.map((c) => `<CREATE path="${c.path}">\n${c.content}\n</CREATE>`),
      ...changes.renames.map((r) => `<RENAME from="${r.from}" to="${r.to}" />`),
      ...changes.deletePaths.map((p) => `<DELETE path="${p}" />`),
      changes.patchText ?? "",
    ].filter(Boolean).join("\n\n") || "<empty>";

    const applyResult = applyChanges(cwd, changes, false);
    applyStatus = applyResult.success ? "ok" : "failed";
    filesChanged = [
      ...applyResult.createdFiles,
      ...applyResult.renamedFiles,
      ...applyResult.patchedFiles,
      ...applyResult.deletedFiles,
    ];
    if (!applyResult.success) {
      error = applyResult.error ?? "static scan repair patch failed to apply";
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (applyStatus === "ok") {
    patchRecord = {
      round: state.patches.length + 1,
      patch,
      apply_status: "ok",
      files_changed: filesChanged,
    };
    postScan = runStaticScan(
      cwd,
      command,
      scanRun.round + 1,
      filesChanged,
      topN,
    );
  }

  const repair: StaticRepairResult = {
    round,
    scan_round: scanRun.round,
    selected_finding_ids: selectedFindings.map((f) => f.id),
    strategy,
    patch,
    apply_status: applyStatus,
    files_changed: filesChanged,
    post_scan_status: postScan?.run.status ?? "skipped",
    remaining_findings: postScan?.run.total_findings ?? scanRun.total_findings,
    created_at: new Date().toISOString(),
  };
  if (postScan) repair.post_scan_round = postScan.run.round;
  if (error) repair.error = error;

  return { repair, patchRecord, postScan };
}

export function parseStaticScanFindings(
  output: string,
  cwd: string,
  round: number,
  includeFallback: boolean = true,
): StaticScanFinding[] {
  const findings = parseFindings(output, cwd, round);
  if (!includeFallback) {
    return findings.filter((f) => f.scanner !== "generic");
  }
  return findings;
}

function runCommand(command: string, cwd: string): RunCommandResult {
  const start = Date.now();
  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { exitCode: 0, output, durationMs: Date.now() - start };
  } catch (e) {
    const err = e as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
    const stdout = bufferToString(err.stdout);
    const stderr = bufferToString(err.stderr);
    const output = [stdout, stderr].filter(Boolean).join("\n") || err.message || "static scan failed";
    return { exitCode: err.status ?? 1, output, durationMs: Date.now() - start };
  }
}

function writeScanOutput(cwd: string, round: number, output: string): string {
  const dir = path.join(cwd, ".dsh", "static-scan");
  fs.mkdirSync(dir, { recursive: true });
  const relativePath = path.join(".dsh", "static-scan", `scan-round-${round}.txt`);
  fs.writeFileSync(path.join(cwd, relativePath), output, "utf-8");
  return relativePath;
}

function selectTopFindings(
  findings: StaticScanFinding[],
  changedFiles: string[],
  topN: number,
): StaticScanFinding[] {
  const changed = new Set(changedFiles);
  return findings
    .map((finding, index) => ({
      finding,
      score: severityScore(finding.severity) + (changed.has(finding.file) ? 100 : 0) - index / 1000,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((item) => item.finding);
}

function buildTopNReasoning(
  selected: StaticScanFinding[],
  changedFiles: string[],
  topN: number,
): string[] {
  if (selected.length === 0) {
    return [`No findings were selected from the configured Top N limit (${topN}).`];
  }

  const changed = new Set(changedFiles);
  return selected.map((finding, index) => {
    const location = formatLocation(finding);
    const changedReason = changed.has(finding.file) ? "changed file" : "scanner order";
    return `${index + 1}. ${finding.id} selected because it is ${finding.severity} severity in ${changedReason}: ${location}`;
  });
}

function buildStaticRepairContext(
  cwd: string,
  state: TaskState,
  findings: StaticScanFinding[],
) {
  const config = {};
  const rules = loadRuleContents(cwd);
  const stack = detectTechStack(cwd);
  const repoContext = generateRepoContext(cwd, stack);
  const rankedFiles = buildRankedFilesFromFindings(findings);
  const taskFiles = loadTopFiles(cwd, rankedFiles, MAX_REPAIR_CONTEXT_FILES);

  return assembleContext({
    config,
    rules,
    repoContext,
    taskState: state,
    taskFiles,
  });
}

function buildRankedFilesFromFindings(findings: StaticScanFinding[]): RankedFile[] {
  const scores = new Map<string, number>();
  for (const finding of findings) {
    if (finding.file === "<project>") continue;
    scores.set(finding.file, (scores.get(finding.file) ?? 0) + severityScore(finding.severity));
  }
  return [...scores.entries()]
    .map(([filePath, score]) => ({ path: filePath, score, content: null }))
    .sort((a, b) => b.score - a.score);
}

function formatFindings(findings: StaticScanFinding[]): string {
  return findings.map((finding) => {
    const rule = finding.rule ? ` (${finding.rule})` : "";
    return `- ${finding.id} ${formatLocation(finding)} ${finding.severity}${rule}: ${finding.message}`;
  }).join("\n");
}

function formatLocation(finding: StaticScanFinding): string {
  const line = finding.line === null ? "" : `:${finding.line}`;
  const column = finding.column === null ? "" : `:${finding.column}`;
  return `${finding.file}${line}${column}`;
}

function severityScore(severity: StaticScanFinding["severity"]): number {
  if (severity === "critical") return 2000;
  if (severity === "high") return 1500;
  if (severity === "error") return 1000;
  if (severity === "medium") return 700;
  if (severity === "warning") return 500;
  if (severity === "low") return 200;
  return 100; // info
}

function bufferToString(value: string | Buffer | undefined): string {
  if (!value) return "";
  return Buffer.isBuffer(value) ? value.toString("utf-8") : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
