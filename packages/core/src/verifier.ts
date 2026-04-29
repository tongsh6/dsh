import { execSync } from "node:child_process";
import type { VerifyResult } from "./task-state.js";

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
