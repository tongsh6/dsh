import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface VerifyCommand {
  name: string;
  command: string;
}

export interface VerifyRunResult {
  command: string;
  status: "passed" | "failed";
  exit_code: number;
  output: string;
  duration_ms: number;
}

// ---- Structured Verify Assertions (spec 2026-05-08-verify-protocol-structured) ----

export type VerifyAssertion =
  | { type: "file_exists"; file: string; name?: string }
  | { type: "file_not_exists"; file: string; name?: string }
  | { type: "file_contains"; file: string; pattern: string; regex?: boolean; name?: string }
  | { type: "file_not_contains"; file: string; pattern: string; regex?: boolean; name?: string }
  | { type: "shell"; command: string; timeout_ms?: number; name?: string }
  | {
      type: "maven_test";
      project_dir?: string;
      module: string;
      tests?: string;
      also_make?: boolean;
      quiet?: boolean;
      timeout_ms?: number;
      name?: string;
    };

const FILE_CONTAINS_MAX_BYTES = 10 * 1024 * 1024; // 10MB safety bound

function readFileForAssertion(absPath: string): { ok: true; content: string } | { ok: false; reason: string } {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return { ok: false, reason: "path is not a regular file" };
    if (stat.size > FILE_CONTAINS_MAX_BYTES) {
      return { ok: false, reason: `file exceeds ${FILE_CONTAINS_MAX_BYTES} bytes safety bound` };
    }
    return { ok: true, content: fs.readFileSync(absPath, "utf-8") };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }
}

function patternMatches(content: string, pattern: string, regex: boolean | undefined): boolean {
  if (regex) {
    try {
      // m flag: ^ and $ match start/end of each line (matching grep BRE behavior)
      return new RegExp(pattern, "m").test(content);
    } catch {
      return false;
    }
  }
  return content.includes(pattern);
}

function describeAssertion(a: VerifyAssertion, idx?: number): string {
  if (a.name) return a.name;
  switch (a.type) {
    case "file_exists":
    case "file_not_exists":
      return `${a.type} ${a.file}`;
    case "file_contains":
    case "file_not_contains":
      return `${a.type} ${a.file} ~ ${a.pattern}`;
    case "shell":
      return idx !== undefined ? `shell[${idx}]` : "shell";
    case "maven_test":
      return idx !== undefined ? `maven_test[${idx}]` : "maven_test";
  }
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildMavenTestCommand(assertion: Extract<VerifyAssertion, { type: "maven_test" }>): string {
  const args = ["mvn", "test", "-pl", assertion.module];
  if (assertion.also_make) args.push("-am");
  if (assertion.tests) args.push(`-Dtest=${assertion.tests}`);
  args.push("-Dsurefire.failIfNoSpecifiedTests=false");
  if (assertion.quiet) args.push("-q");

  const mvn = args.map(shellQuote).join(" ");
  return assertion.project_dir
    ? `cd ${shellQuote(assertion.project_dir)} && ${mvn}`
    : mvn;
}

export function runAssertion(assertion: VerifyAssertion, cwd: string, idx?: number): VerifyRunResult {
  const start = Date.now();
  const display = describeAssertion(assertion, idx);

  if (assertion.type === "shell") {
    const result = runCommand(assertion.command, cwd, assertion.timeout_ms);
    // Use the human display name (or command itself) so reports stay readable
    return { ...result, command: assertion.name ? `${assertion.name}: ${assertion.command}` : result.command };
  }

  if (assertion.type === "maven_test") {
    const command = buildMavenTestCommand(assertion);
    const result = runCommand(command, cwd, assertion.timeout_ms);
    return { ...result, command: assertion.name ? `${assertion.name}: ${command}` : result.command };
  }

  const absPath = path.isAbsolute(assertion.file) ? assertion.file : path.join(cwd, assertion.file);

  if (assertion.type === "file_exists") {
    const exists = fs.existsSync(absPath);
    return {
      command: display,
      status: exists ? "passed" : "failed",
      exit_code: exists ? 0 : 1,
      output: exists
        ? "(file exists)"
        : `assertion 'file_exists' failed: file does not exist: ${assertion.file}`,
      duration_ms: Date.now() - start,
    };
  }

  if (assertion.type === "file_not_exists") {
    const exists = fs.existsSync(absPath);
    return {
      command: display,
      status: exists ? "failed" : "passed",
      exit_code: exists ? 1 : 0,
      output: exists
        ? `assertion 'file_not_exists' failed: file should not exist but does: ${assertion.file}`
        : "(file absent as expected)",
      duration_ms: Date.now() - start,
    };
  }

  // file_contains / file_not_contains
  const read = readFileForAssertion(absPath);
  if (!read.ok) {
    // Treat unreadable files as "pattern absent" — matches contains=fail, not_contains=pass
    const isContains = assertion.type === "file_contains";
    return {
      command: display,
      status: isContains ? "failed" : "passed",
      exit_code: isContains ? 1 : 0,
      output: isContains
        ? `assertion 'file_contains' failed: file '${assertion.file}' could not be read (reason: ${read.reason})`
        : `(file '${assertion.file}' unreadable, treated as pattern absent: ${read.reason})`,
      duration_ms: Date.now() - start,
    };
  }

  const matched = patternMatches(read.content, assertion.pattern, assertion.regex);

  if (assertion.type === "file_contains") {
    return {
      command: display,
      status: matched ? "passed" : "failed",
      exit_code: matched ? 0 : 1,
      output: matched
        ? "(pattern found)"
        : `assertion 'file_contains' failed: file '${assertion.file}' does not contain pattern '${assertion.pattern}'${assertion.regex ? " (regex)" : ""}`,
      duration_ms: Date.now() - start,
    };
  }

  // file_not_contains
  return {
    command: display,
    status: matched ? "failed" : "passed",
    exit_code: matched ? 1 : 0,
    output: matched
      ? `assertion 'file_not_contains' failed: file '${assertion.file}' contains pattern '${assertion.pattern}'${assertion.regex ? " (regex)" : ""} (should not)`
      : "(pattern absent as expected)",
    duration_ms: Date.now() - start,
  };
}

export function runVerifyAssertions(assertions: VerifyAssertion[], cwd: string): VerifyRunResult[] {
  return assertions.map((a, i) => runAssertion(a, cwd, i));
}

function truncateForRepair(value: string, max = 600): string {
  const normalized = value.replace(/\s+$/g, "");
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function quoteForRepair(value: string, max = 160): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const truncated = compact.length > max ? `${compact.slice(0, max)}...` : compact;
  return JSON.stringify(truncated);
}

function looksLikeReferencePattern(pattern: string): boolean {
  return /(?:^|[./@_-])[\w.-]+\.(?:js|ts|tsx|jsx|mjs|cjs)$/.test(pattern)
    || pattern.includes("./")
    || pattern.includes("../")
    || /\b(import|export|require)\b/.test(pattern);
}

function isContentEqualityShell(assertion: VerifyAssertion): boolean {
  if (assertion.type !== "shell") return false;
  const text = `${assertion.name ?? ""} ${assertion.command}`.toLowerCase();
  return text.includes("cmp")
    || text.includes("content_unchanged")
    || text.includes("content unchanged")
    || text.includes("same content")
    || text.includes("equivalent content");
}

function semanticHintForFailedAssertion(
  assertion: VerifyAssertion | undefined,
  result: VerifyRunResult,
): string | null {
  if (result.status !== "failed") return null;
  if (!assertion) return `verification_command_failed: inspect the failed command output and emit a concrete change block; command=${quoteForRepair(result.command)}`;

  switch (assertion.type) {
    case "file_exists":
      return `file_exists_failed: ensure ${assertion.file} exists. If the task is a rename/move, prefer <RENAME from="old/path" to="${assertion.file}" /> so content is preserved; otherwise use <CREATE> or <PATCH> as appropriate.`;
    case "file_not_exists":
      return `file_not_exists_failed: stale file remains at ${assertion.file}. Remove it with <DELETE path="${assertion.file}" /> or use <RENAME from="${assertion.file}" to="new/path" /> when preserving content under a new name.`;
    case "file_contains": {
      const protocol = looksLikeReferencePattern(assertion.pattern)
        ? " This looks like an import/export/reference expectation; update the existing reference with a precise <SEARCH_REPLACE> block."
        : " Add the missing required text with the smallest task-correct edit.";
      return `file_contains_failed: ${assertion.file} must contain ${assertion.regex ? "regex" : "text"} ${quoteForRepair(assertion.pattern)}.${protocol}`;
    }
    case "file_not_contains":
      return `file_not_contains_failed: ${assertion.file} still contains forbidden ${assertion.regex ? "regex" : "text"} ${quoteForRepair(assertion.pattern)}. Remove only the stale occurrence with a precise <SEARCH_REPLACE> or <PATCH>.`;
    case "shell":
      if (isContentEqualityShell(assertion)) {
        return "content_equality_failed: destination content does not match the required source content. For rename/move tasks, prefer <RENAME> to preserve bytes instead of recreating a large file by hand.";
      }
      return `shell_verification_failed: repair the concrete failure reported by ${quoteForRepair(assertion.name ?? assertion.command)}; do not change verification commands.`;
    case "maven_test":
      return `maven_test_failed: fix the compilation or test failure reported by ${quoteForRepair(result.command)} with the smallest code change.`;
  }
}

export function buildSemanticRepairHints(
  assertions: VerifyAssertion[],
  results: VerifyRunResult[],
): string[] {
  const hints: string[] = [];
  const seen = new Set<string>();

  results.forEach((result, index) => {
    const hint = semanticHintForFailedAssertion(assertions[index], result);
    if (!hint || seen.has(hint)) return;
    seen.add(hint);
    hints.push(hint);
  });

  return hints;
}

export function formatSemanticRepairHints(hints: string[]): string | null {
  if (hints.length === 0) return null;
  return [
    "## SEMANTIC REPAIR HINTS",
    "These hints are derived from failed verification assertions. They describe the next repair constraints; they are not fixture-specific answer injection.",
    ...hints.map((hint) => `- ${hint}`),
  ].join("\n");
}

function describeFailedAssertionForRepair(
  assertion: VerifyAssertion | undefined,
  result: VerifyRunResult,
): string {
  if (!assertion) {
    return [
      `- Verification command failed: ${result.command}`,
      `  Output: ${truncateForRepair(result.output)}`,
    ].join("\n");
  }

  switch (assertion.type) {
    case "file_exists":
      return [
        `- File existence assertion failed: ${assertion.file}`,
        "  Expected: the file must exist.",
        `  Output: ${truncateForRepair(result.output)}`,
      ].join("\n");
    case "file_not_exists":
      return [
        `- File absence assertion failed: ${assertion.file}`,
        "  Expected: the file must not exist.",
        `  Output: ${truncateForRepair(result.output)}`,
      ].join("\n");
    case "file_contains":
      return [
        `- File content assertion failed: ${assertion.file}`,
        `  Expected: file should contain ${assertion.regex ? "regex" : "text"} pattern: ${assertion.pattern}`,
        `  Output: ${truncateForRepair(result.output)}`,
      ].join("\n");
    case "file_not_contains":
      return [
        `- File negative-content assertion failed: ${assertion.file}`,
        `  Expected: file should not contain ${assertion.regex ? "regex" : "text"} pattern: ${assertion.pattern}`,
        `  Output: ${truncateForRepair(result.output)}`,
      ].join("\n");
    case "shell":
      return [
        `- Shell verification failed: ${assertion.name ? `${assertion.name}: ` : ""}${assertion.command}`,
        `  Output: ${truncateForRepair(result.output)}`,
      ].join("\n");
    case "maven_test":
      return [
        `- Maven verification failed: ${result.command}`,
        `  Output: ${truncateForRepair(result.output)}`,
      ].join("\n");
  }
}

export function buildFailedAssertionDiagnostics(
  assertions: VerifyAssertion[],
  results: VerifyRunResult[],
): string | null {
  const failed = results
    .map((result, index) => ({ result, assertion: assertions[index] }))
    .filter(({ result }) => result.status === "failed");

  if (failed.length === 0) return null;

  return [
    "## FAILED VERIFICATION CONTRACTS",
    "These are structured diagnostics from the configured verification assertions. Treat them as evidence for the repair, not as fixture-specific code hints.",
    "If a low-level pattern appears to conflict with the original task semantics, prefer the smallest task-correct change and make the verification pass through that design.",
    "",
    ...failed.map(({ assertion, result }) => describeFailedAssertionForRepair(assertion, result)),
  ].join("\n");
}

// Parse a single assertion value (typically loaded from YAML/JSON config).
// Returns null on schema violation; caller decides whether to drop or throw.
export function parseAssertion(raw: unknown): VerifyAssertion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r["type"];
  const name = typeof r["name"] === "string" ? (r["name"] as string) : undefined;

  switch (type) {
    case "file_exists":
    case "file_not_exists": {
      const file = r["file"];
      if (typeof file !== "string" || file.length === 0) return null;
      return { type, file, ...(name ? { name } : {}) };
    }
    case "file_contains":
    case "file_not_contains": {
      const file = r["file"];
      const pattern = r["pattern"];
      if (typeof file !== "string" || file.length === 0) return null;
      if (typeof pattern !== "string" || pattern.length === 0) return null;
      const regex = r["regex"] === true;
      return { type, file, pattern, ...(regex ? { regex: true } : {}), ...(name ? { name } : {}) };
    }
    case "shell": {
      const command = r["command"];
      if (typeof command !== "string" || command.trim().length === 0) return null;
      const timeoutMs = typeof r["timeout_ms"] === "number" ? (r["timeout_ms"] as number) : undefined;
      return {
        type: "shell",
        command,
        ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
        ...(name ? { name } : {}),
      };
    }
    case "maven_test": {
      const module = r["module"];
      if (typeof module !== "string" || module.trim().length === 0) return null;
      const projectDir = typeof r["project_dir"] === "string" && r["project_dir"].trim().length > 0
        ? r["project_dir"]
        : undefined;
      const tests = typeof r["tests"] === "string" && r["tests"].trim().length > 0
        ? r["tests"]
        : undefined;
      const timeoutMs = typeof r["timeout_ms"] === "number" ? (r["timeout_ms"] as number) : undefined;
      return {
        type: "maven_test",
        ...(projectDir ? { project_dir: projectDir } : {}),
        module,
        ...(tests ? { tests } : {}),
        ...(r["also_make"] === true ? { also_make: true } : {}),
        ...(r["quiet"] === true ? { quiet: true } : {}),
        ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
        ...(name ? { name } : {}),
      };
    }
    default:
      return null;
  }
}

export function runCommand(command: string, cwd: string, timeoutMs: number = 120_000): VerifyRunResult {
  const start = Date.now();
  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    const duration = Date.now() - start;
    return {
      command,
      status: "passed",
      exit_code: 0,
      output: output.trim() || "(no output)",
      duration_ms: duration,
    };
  } catch (e: any) {
    const duration = Date.now() - start;
    return {
      command,
      status: "failed",
      exit_code: e.status ?? 1,
      output: (e.stdout ?? "") + "\n" + (e.stderr ?? ""),
      duration_ms: duration,
    };
  }
}

export function runVerify(
  commands: string[],
  cwd: string,
): VerifyRunResult[] {
  return commands
    .filter((cmd) => cmd.trim().length > 0)
    .map((cmd) => runCommand(cmd, cwd));
}

export function isAllPassed(results: VerifyRunResult[]): boolean {
  return results.length > 0 && results.every((r) => r.status === "passed");
}

export function formatResults(results: VerifyRunResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    const icon = r.status === "passed" ? "✓" : "✗";
    const time = `(${(r.duration_ms / 1000).toFixed(1)}s)`;
    lines.push(`${icon} ${r.command.padEnd(40)} ${time}`);

    if (r.status === "failed") {
      lines.push(`  ${r.output.slice(0, 2000)}`);
    }
  }
  return lines.join("\n");
}

export function summarizeResults(results: VerifyRunResult[]): string {
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  if (failed === 0) return `All ${passed} checks passed`;
  return `${passed} passed, ${failed} failed`;
}
