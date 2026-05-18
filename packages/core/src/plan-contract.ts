import * as path from "node:path";
import {
  extractPlanBlock,
  extractRisksBlock,
  extractVerifyBlock,
  extractVerifyStrategyBlock,
} from "./patch-parser.js";

export type PlanContractFailureReason =
  | "missing_plan"
  | "missing_files"
  | "missing_risks"
  | "natural_language_only"
  | "truncated_or_empty"
  | "tool_call_in_finalize"
  | "invalid_files_entry"
  | "provider_network"
  | "unknown";

export interface PlanContractValidationResult {
  valid: boolean;
  reason?: PlanContractFailureReason;
  planRaw?: string;
  files?: string[];
  risks?: string[];
  verifyCommands?: string[];
  verifyStrategy?: string;
  diagnostics?: Record<string, unknown>;
}

export const PLAN_CONTRACT_TEMPLATE = `<PLAN>
## Goal
...

## Strategy
...

## Verification Strategy
...
</PLAN>
<FILES>
- path/to/file.ts
</FILES>
<VERIFY_STRATEGY>
...
</VERIFY_STRATEGY>
<VERIFY>
...
</VERIFY>
<RISKS>
- specific risk 1
- specific risk 2
</RISKS>`;

export function validatePlanContract(input: {
  content: string;
  hasToolCalls?: boolean;
}): PlanContractValidationResult {
  const content = input.content ?? "";
  const trimmed = content.trim();

  if (input.hasToolCalls) {
    return invalid("tool_call_in_finalize", { hasToolCalls: true });
  }

  if (trimmed.length === 0) {
    return invalid("truncated_or_empty", { empty: true });
  }

  if (hasUnclosedContractTag(trimmed)) {
    return invalid("truncated_or_empty", { unclosedTag: true });
  }

  const planRaw = extractPlanBlock(trimmed);
  if (!planRaw) {
    const hasXml = /<\/?[A-Z_]+[\s>]/.test(trimmed);
    return invalid(hasXml ? "missing_plan" : "natural_language_only", {
      hasXml,
      contentLength: trimmed.length,
    });
  }

  const filesBlock = extractSingleBlock(trimmed, "FILES");
  if (filesBlock === null) {
    return invalid("missing_files", { hasPlanFilesInPlan: /files involved/i.test(planRaw) });
  }

  const filesResult = parseStrictFilesBlock(filesBlock);
  if (!filesResult.valid) {
    return invalid("invalid_files_entry", filesResult.diagnostics);
  }
  if (filesResult.files.length === 0) {
    return invalid("missing_files", { emptyFilesBlock: true });
  }

  const risks = extractRisksBlock(trimmed)
    .map((risk) => risk.trim())
    .filter((risk) => risk.length > 0 && !/^(n\/a|none|无|no risks?)$/i.test(risk));
  if (risks.length < 2) {
    return invalid("missing_risks", { riskCount: risks.length });
  }

  const verifyCommands = extractVerifyBlock(trimmed);
  const verifyStrategy = extractVerifyStrategyBlock(trimmed);
  const diagnostics: Record<string, unknown> = {};
  if (filesResult.duplicates.length > 0) {
    diagnostics["duplicate_files_deduped"] = filesResult.duplicates;
  }

  return {
    valid: true,
    planRaw,
    files: filesResult.files,
    risks,
    verifyCommands,
    verifyStrategy,
    diagnostics,
  };
}

function invalid(
  reason: PlanContractFailureReason,
  diagnostics?: Record<string, unknown>,
): PlanContractValidationResult {
  return { valid: false, reason, diagnostics };
}

function extractSingleBlock(content: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = content.match(regex);
  return match?.[1] ?? null;
}

function hasUnclosedContractTag(content: string): boolean {
  for (const tag of ["PLAN", "FILES", "RISKS", "VERIFY", "VERIFY_STRATEGY"]) {
    const opens = countMatches(content, new RegExp(`<${tag}>`, "gi"));
    const closes = countMatches(content, new RegExp(`</${tag}>`, "gi"));
    if (opens !== closes) return true;
  }
  return false;
}

function countMatches(content: string, regex: RegExp): number {
  return [...content.matchAll(regex)].length;
}

function parseStrictFilesBlock(block: string): {
  valid: boolean;
  files: string[];
  duplicates: string[];
  diagnostics?: Record<string, unknown>;
} {
  const files: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  const invalidEntries: Array<{ line: string; reason: string }> = [];

  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const entry = line.replace(/^-\s*/, "").trim();
    const entryError = validateFilesEntry(entry);
    if (entryError) {
      invalidEntries.push({ line, reason: entryError });
      continue;
    }

    if (seen.has(entry)) {
      duplicates.push(entry);
      continue;
    }
    seen.add(entry);
    files.push(entry);
  }

  if (invalidEntries.length > 0) {
    return {
      valid: false,
      files,
      duplicates,
      diagnostics: { invalidEntries },
    };
  }

  return { valid: true, files, duplicates };
}

function validateFilesEntry(entry: string): string | null {
  if (entry.length === 0) return "empty";
  if (/^(n\/a|none|无|null)$/i.test(entry)) return "placeholder";
  if (path.isAbsolute(entry) || entry.startsWith("~")) return "absolute_path";
  if (entry.split(/[\\/]+/).includes("..")) return "parent_traversal";
  if (entry.endsWith("/") || entry.endsWith("\\")) return "directory";
  if (/[*?[\]{}]/.test(entry)) return "glob_pattern";
  if (entry.includes(":")) return "description_or_absolute_drive";
  if (/\s/.test(entry)) return "natural_language_or_description";
  return null;
}
