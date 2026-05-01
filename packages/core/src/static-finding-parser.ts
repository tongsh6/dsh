import * as path from "node:path";
import type { StaticScanFinding } from "./task-state.js";

export interface StaticFindingParser {
  name: string;
  canParse(output: string): boolean;
  parse(output: string, cwd: string, round: number): StaticScanFinding[];
}

type FindingSeed = Omit<StaticScanFinding, "id" | "scanner" | "raw"> & {
  raw?: unknown;
};

function makeFindings(
  scanner: string,
  round: number,
  seeds: FindingSeed[],
): StaticScanFinding[] {
  return seeds.map((seed, i) => ({
    ...seed,
    id: `S${round}-${i + 1}`,
    scanner,
  }));
}

// ── Helpers ──

function normalizeFile(value: string, cwd: string): string | null {
  const cleaned = value.trim();
  if (!cleaned) return null;
  const absolute = path.isAbsolute(cleaned)
    ? cleaned
    : path.join(cwd, cleaned);
  const relative = path.relative(cwd, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return cleaned;
  return relative || cleaned;
}

function toSeverity(value: string | undefined): StaticScanFinding["severity"] {
  if (!value) return "error";
  const lower = value.toLowerCase();
  if (lower === "critical") return "critical";
  if (lower === "high") return "high";
  if (lower === "error") return "error";
  if (lower === "medium") return "medium";
  if (lower === "warning") return "warning";
  if (lower === "low") return "low";
  if (lower === "info" || lower === "note") return "info";
  return "error";
}

function inferCategory(
  rule: string | null,
  severity: StaticScanFinding["severity"],
  scanner: string,
): StaticScanFinding["category"] {
  if (scanner === "gitleaks") return "secret";
  if (scanner === "codeql") return "security";
  if (severity === "critical" || severity === "high") return "bug";
  if (rule) {
    const lower = rule.toLowerCase();
    if (lower.includes("security") || lower.includes("cwe-") || lower.includes("injection")) return "security";
  }
  return "unknown";
}

// ── ESLint Parser ──

export const eslintParser: StaticFindingParser = {
  name: "eslint-stylish",

  canParse(output: string): boolean {
    return /^\s*\d+:\d+\s+(error|warning|info)\s+/m.test(output);
  },

  parse(output: string, cwd: string, round: number): StaticScanFinding[] {
    const seeds: FindingSeed[] = [];
    let currentFile: string | null = null;

    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;

      const fileOnly = normalizeFile(trimmed, cwd);
      if (fileOnly && !trimmed.includes(" ")) {
        currentFile = fileOnly;
        continue;
      }

      const m = trimmed.match(
        /^\s*(\d+):(\d+)\s+(error|warning|info)\s+(.+?)(?:\s{2,}([\w@/-]+(?:\/[\w-]+)?))?$/,
      );
      if (m && currentFile) {
        const severity = toSeverity(m[3]);
        const rule = m[5]?.trim() ?? null;
        seeds.push({
          file: currentFile,
          line: Number(m[1]),
          column: Number(m[2]),
          severity,
          category: inferCategory(rule, severity, "eslint"),
          message: m[4]?.trim() ?? "",
          rule,
        });
      }
    }

    return makeFindings("eslint", round, seeds);
  },
};

// ── TypeScript Diagnostics Parser ──

export const tscParser: StaticFindingParser = {
  name: "tsc-diagnostics",

  canParse(output: string): boolean {
    return /^.+?\(\d+,\d+\):\s+(error|warning)\s+TS\d+:\s+.+$/m.test(output);
  },

  parse(output: string, cwd: string, round: number): StaticScanFinding[] {
    const seeds: FindingSeed[] = [];

    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;

      const m = trimmed.match(
        /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/,
      );
      if (m) {
        const severity = toSeverity(m[4]);
        const rule = m[5]?.trim() ?? null;
        seeds.push({
          file: normalizeFile(m[1] ?? "", cwd) ?? (m[1] ?? "<unknown>"),
          line: Number(m[2]),
          column: Number(m[3]),
          severity,
          category: severity === "error" ? "type" : "style",
          message: m[6]?.trim() ?? "",
          rule,
        });
      }
    }

    return makeFindings("tsc", round, seeds);
  },
};

// ── SARIF v2.1.0 Parser ──

interface SarifLog {
  version: string;
  runs?: SarifRun[];
}

interface SarifRun {
  tool?: { driver?: { name?: string } };
  results?: SarifResult[];
}

interface SarifResult {
  ruleId?: string;
  level?: string;
  message?: { text?: string };
  locations?: SarifLocation[];
}

interface SarifLocation {
  physicalLocation?: {
    artifactLocation?: { uri?: string };
    region?: { startLine?: number; startColumn?: number };
  };
}

function isSarifOutput(output: string): boolean {
  try {
    const parsed = JSON.parse(output);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.version === "string" &&
      (parsed.version === "2.1.0" || parsed.version.startsWith("2.")) &&
      Array.isArray(parsed.runs)
    );
  } catch {
    return false;
  }
}

function sarifToolName(log: SarifLog): string {
  const name = log.runs?.[0]?.tool?.driver?.name?.toLowerCase() ?? "";
  if (name.includes("gitleaks")) return "gitleaks";
  if (name.includes("codeql")) return "codeql";
  return "sarif";
}

export const sarifParser: StaticFindingParser = {
  name: "sarif",

  canParse(output: string): boolean {
    return isSarifOutput(output);
  },

  parse(output: string, _cwd: string, round: number): StaticScanFinding[] {
    const log: SarifLog = JSON.parse(output);
    const scanner = sarifToolName(log);
    const seeds: FindingSeed[] = [];

    for (const run of log.runs ?? []) {
      for (const result of run.results ?? []) {
        const loc = result.locations?.[0]?.physicalLocation;
        seeds.push({
          file: loc?.artifactLocation?.uri ?? "<unknown>",
          line: loc?.region?.startLine ?? null,
          column: loc?.region?.startColumn ?? null,
          severity: toSeverity(result.level),
          category: inferCategory(result.ruleId ?? null, toSeverity(result.level), scanner),
          message: result.message?.text ?? result.ruleId ?? "<no message>",
          rule: result.ruleId ?? null,
          raw: result,
        });
      }
    }

    return makeFindings(scanner, round, seeds);
  },
};

// ── Fallback Text Parser ──

export const fallbackParser: StaticFindingParser = {
  name: "text-fallback",

  canParse(_output: string): boolean {
    return true;
  },

  parse(output: string, _cwd: string, round: number): StaticScanFinding[] {
    if (output.trim().length === 0) return [];

    return makeFindings("generic", round, [
      {
        file: "<project>",
        line: null,
        column: null,
        severity: "error",
        category: "unknown",
        message: output.trim().split(/\r?\n/).slice(0, 12).join("\n"),
        rule: null,
        raw: output,
      },
    ]);
  },
};

// ── Parser Registry ──

const PARSERS: StaticFindingParser[] = [
  eslintParser,
  tscParser,
  sarifParser,
  fallbackParser,
];

export function resolveParser(output: string): StaticFindingParser {
  for (const parser of PARSERS) {
    if (parser.canParse(output)) return parser;
  }
  return fallbackParser;
}

export function parseFindings(
  output: string,
  cwd: string,
  round: number,
): StaticScanFinding[] {
  const parser = resolveParser(output);
  return parser.parse(output, cwd, round);
}
