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
  | { type: "shell"; command: string; timeout_ms?: number; name?: string };

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
  }
}

export function runAssertion(assertion: VerifyAssertion, cwd: string, idx?: number): VerifyRunResult {
  const start = Date.now();
  const display = describeAssertion(assertion, idx);

  if (assertion.type === "shell") {
    const result = runCommand(assertion.command, cwd, assertion.timeout_ms);
    // Use the human display name (or command itself) so reports stay readable
    return { ...result, command: assertion.name ? `${assertion.name}: ${assertion.command}` : result.command };
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
      lines.push(`  ${r.output.slice(0, 500)}`);
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
