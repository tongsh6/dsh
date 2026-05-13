// CONSTITUTION 原则 8 兜底 CI 脚本。
// 扫描 docs/specs/*.md（创建日期 ≥ 2026-05-05）和 docs/reports/**/analysis.md
// 中的「本 spec 引发的跟踪事项」章节，与 docs/project-ledger.md §8 长期跟踪
// 事项表格比对差集。差集非空时退出码 1，CI 阻断。
//
// 用法：
//   tsx scripts/check-tracked-items.ts                   # 默认人类可读输出
//   tsx scripts/check-tracked-items.ts --json            # JSON 输出
//   tsx scripts/check-tracked-items.ts --root=<dir>      # 指定项目根（用于测试）

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

// ---- Domain ----

const VALID_TYPES = ["deferred", "bug", "debt", "evidence"] as const;
const VALID_STATUS = [
  "waiting",
  "ready",
  "in_progress",
  "resolved",
  "cancelled",
] as const;
const VALID_PRIORITY = ["P0", "P1", "P2", "P3"] as const;

const SPEC_DATE_CUTOFF_MS = new Date("2026-05-05").getTime();

interface DeclaredRow {
  type: string;
  id: string;
  trigger: string;
  priority: string;
  notes: string;
  source: string; // path of the declaring file (rel to root)
  lineNumber: number;
}

interface LedgerRow {
  type: string;
  id: string;
  source: string;
  title: string;
  trigger: string;
  priority: string;
  status: string;
  lastReviewed: string;
  lineNumber: number;
}

interface ErrorRecord {
  kind: string;
  message: string;
  details?: Record<string, unknown>;
}

interface WarningRecord {
  kind: string;
  message: string;
  details?: Record<string, unknown>;
}

interface CheckResult {
  errors: ErrorRecord[];
  warnings: WarningRecord[];
  stats: {
    specRows: number;
    reportRows: number;
    ledgerRows: number;
    skippedHistoricalSpecs: string[];
  };
}

// ---- Markdown helpers ----

/**
 * Parse a markdown table data row. Returns trimmed cell values, or null
 * if the line is not a valid table row (separator, blockquote, prose, ...).
 */
function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  // Skip header separator: |---|---|
  if (/^\|[-:|\s]+\|$/.test(trimmed)) return null;
  return trimmed
    .split("|")
    .slice(1, -1)
    .map((s) => s.trim());
}

/**
 * Compute a per-line mask: mask[i] = true means line i is inside a fenced
 * code block (or is a fence delimiter itself). Such lines must be ignored
 * by heading/table parsers — otherwise example markdown inside ```...``` is
 * misread as real content.
 */
function computeFenceMask(lines: string[]): boolean[] {
  const mask: boolean[] = new Array(lines.length).fill(false);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*```/.test(line)) {
      mask[i] = true; // the fence delimiter itself
      inFence = !inFence;
    } else {
      mask[i] = inFence;
    }
  }
  return mask;
}

/**
 * Locate a markdown section by heading regex, ignoring matches inside fenced
 * code blocks. Returns [start, end) — end is the next heading of any depth or EOF.
 */
function findSection(
  lines: string[],
  headingPattern: RegExp,
  fenceMask: boolean[],
): { start: number; end: number } | null {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (fenceMask[i]) continue;
    const line = lines[i];
    if (line === undefined) continue;
    if (headingPattern.test(line)) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (fenceMask[i]) continue;
    const line = lines[i];
    if (line === undefined) continue;
    if (/^#{1,6}\s/.test(line)) {
      end = i;
      break;
    }
  }
  return { start, end };
}

// ---- Spec date filter ----

function extractSpecDateMs(filename: string): number | null {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})-/);
  if (!m) return null;
  const t = new Date(m[1]!).getTime();
  return Number.isNaN(t) ? null : t;
}

// ---- Declaration scanning (spec §9 / report analysis §「跟踪事项」) ----

const TRACKED_HEADING = /^#{1,4}\s+.*本 spec 引发的跟踪事项/;
// also accept the more generic phrasing in report analysis files
const TRACKED_HEADING_GENERIC = /^#{1,4}\s+.*跟踪事项/;

function parseDeclaredRows(
  content: string,
  sourceRel: string,
  headingPattern: RegExp,
): DeclaredRow[] {
  const lines = content.split("\n");
  const fenceMask = computeFenceMask(lines);
  const section = findSection(lines, headingPattern, fenceMask);
  if (!section) return [];
  const rows: DeclaredRow[] = [];
  for (let i = section.start + 1; i < section.end; i++) {
    if (fenceMask[i]) continue;
    const raw = lines[i];
    if (raw === undefined) continue;
    // Skip blockquote (e.g. examples)
    if (raw.trim().startsWith(">")) continue;
    const cells = parseTableRow(raw);
    if (!cells) continue;
    if (cells.length < 4) continue;
    const type = cells[0];
    const id = cells[1];
    if (type === undefined || id === undefined) continue;
    // Skip header
    if (type === "type" && id === "id") continue;
    // Skip placeholder rows
    if (type.includes("/")) continue;
    if (type.startsWith("<") && type.endsWith(">")) continue;
    if (id.startsWith("<") && id.endsWith(">")) continue;
    rows.push({
      type,
      id,
      trigger: cells[2] ?? "",
      priority: cells[3] ?? "",
      notes: cells[4] ?? "",
      source: sourceRel,
      lineNumber: i + 1,
    });
  }
  return rows;
}

function scanSpecs(rootDir: string): {
  rows: DeclaredRow[];
  skipped: string[];
} {
  const specsDir = path.join(rootDir, "docs", "specs");
  if (!fs.existsSync(specsDir)) return { rows: [], skipped: [] };
  const files = fs
    .readdirSync(specsDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  const rows: DeclaredRow[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const dateMs = extractSpecDateMs(f);
    if (dateMs !== null && dateMs < SPEC_DATE_CUTOFF_MS) {
      skipped.push(f);
      continue;
    }
    const fullPath = path.join(specsDir, f);
    const content = fs.readFileSync(fullPath, "utf-8");
    const relPath = path.posix.join("docs", "specs", f);
    rows.push(...parseDeclaredRows(content, relPath, TRACKED_HEADING));
  }
  return { rows, skipped };
}

function scanReports(rootDir: string): DeclaredRow[] {
  const reportsDir = path.join(rootDir, "docs", "reports");
  if (!fs.existsSync(reportsDir)) return [];
  const dirs = fs
    .readdirSync(reportsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const rows: DeclaredRow[] = [];
  for (const dir of dirs) {
    const analysisPath = path.join(reportsDir, dir, "analysis.md");
    if (!fs.existsSync(analysisPath)) continue;
    const content = fs.readFileSync(analysisPath, "utf-8");
    const relPath = path.posix.join("docs", "reports", dir, "analysis.md");
    rows.push(...parseDeclaredRows(content, relPath, TRACKED_HEADING_GENERIC));
  }
  return rows;
}

// ---- Ledger §8 scanning ----

function parseLedgerRows(
  content: string,
): { rows: LedgerRow[]; columnErrors: ErrorRecord[]; sectionFound: boolean } {
  const lines = content.split("\n");
  const fenceMask = computeFenceMask(lines);
  const section = findSection(lines, /^##\s+8\.\s+长期跟踪事项/, fenceMask);
  if (!section) {
    return { rows: [], columnErrors: [], sectionFound: false };
  }
  const rows: LedgerRow[] = [];
  const columnErrors: ErrorRecord[] = [];
  for (let i = section.start + 1; i < section.end; i++) {
    if (fenceMask[i]) continue;
    const raw = lines[i];
    if (raw === undefined) continue;
    if (raw.trim().startsWith(">")) continue;
    const cells = parseTableRow(raw);
    if (!cells) continue;
    if (cells[0] === "type" && cells[1] === "id") continue;
    if (cells.length !== 8) {
      columnErrors.push({
        kind: "ledger-column-count",
        message: `project-ledger.md §8 line ${i + 1}: expected 8 columns, got ${cells.length}`,
        details: { line: i + 1, columns: cells.length },
      });
      continue;
    }
    rows.push({
      type: cells[0]!,
      id: cells[1]!,
      source: cells[2]!,
      title: cells[3]!,
      trigger: cells[4]!,
      priority: cells[5]!,
      status: cells[6]!,
      lastReviewed: cells[7]!,
      lineNumber: i + 1,
    });
  }
  return { rows, columnErrors, sectionFound: true };
}

// ---- Validators ----

function checkConsistency(
  declared: DeclaredRow[],
  ledger: LedgerRow[],
): ErrorRecord[] {
  const errors: ErrorRecord[] = [];
  const ledgerKeys = new Set(ledger.map((r) => `${r.type}|${r.id}`));
  for (const row of declared) {
    const key = `${row.type}|${row.id}`;
    if (!ledgerKeys.has(key)) {
      errors.push({
        kind: "missing-in-ledger",
        message: `${row.source}:${row.lineNumber} declares (${row.type}, ${row.id}) but it is not registered in project-ledger.md §8`,
        details: {
          source: row.source,
          line: row.lineNumber,
          type: row.type,
          id: row.id,
        },
      });
    }
  }
  return errors;
}

function checkSourcePaths(
  rootDir: string,
  ledger: LedgerRow[],
): ErrorRecord[] {
  const errors: ErrorRecord[] = [];
  for (const row of ledger) {
    // Source path is "historical pointer" once the row is resolved/cancelled —
    // the originally-referenced file may have been legitimately deleted or
    // refactored away (e.g. scanner.ts retired in Task C of pie-phase2-tier1).
    // Path-existence check only applies to entries still under active tracking.
    if (row.status === "resolved" || row.status === "cancelled") continue;
    const m = row.source.match(/^(spec|report|code):(.+?)(?::(\d+))?$/);
    if (!m) {
      errors.push({
        kind: "invalid-source-format",
        message: `Ledger §8 line ${row.lineNumber} (${row.type}, ${row.id}): source "${row.source}" does not match prefix:path[:line] format`,
        details: { line: row.lineNumber, type: row.type, id: row.id, source: row.source },
      });
      continue;
    }
    const filePath = m[2]!;
    const fullPath = path.join(rootDir, filePath);
    if (!fs.existsSync(fullPath)) {
      errors.push({
        kind: "source-path-missing",
        message: `Ledger §8 line ${row.lineNumber} (${row.type}, ${row.id}): source path "${filePath}" does not exist`,
        details: { line: row.lineNumber, type: row.type, id: row.id, source: row.source, filePath },
      });
    }
  }
  return errors;
}

function checkLedgerEnums(ledger: LedgerRow[]): ErrorRecord[] {
  const errors: ErrorRecord[] = [];
  for (const row of ledger) {
    if (!(VALID_TYPES as readonly string[]).includes(row.type)) {
      errors.push({
        kind: "ledger-invalid-type",
        message: `Ledger §8 line ${row.lineNumber}: type="${row.type}" not in (${VALID_TYPES.join(", ")})`,
      });
    }
    if (!(VALID_STATUS as readonly string[]).includes(row.status)) {
      errors.push({
        kind: "ledger-invalid-status",
        message: `Ledger §8 line ${row.lineNumber}: status="${row.status}" not in (${VALID_STATUS.join(", ")})`,
      });
    }
    if (!(VALID_PRIORITY as readonly string[]).includes(row.priority)) {
      errors.push({
        kind: "ledger-invalid-priority",
        message: `Ledger §8 line ${row.lineNumber}: prio="${row.priority}" not in (${VALID_PRIORITY.join(", ")})`,
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.lastReviewed)) {
      errors.push({
        kind: "ledger-invalid-date",
        message: `Ledger §8 line ${row.lineNumber}: last_reviewed="${row.lastReviewed}" is not YYYY-MM-DD`,
      });
    }
  }
  return errors;
}

function checkLastReviewed(
  ledger: LedgerRow[],
  now: Date,
  maxDays: number,
): WarningRecord[] {
  const warnings: WarningRecord[] = [];
  const cutoff = now.getTime() - maxDays * 24 * 60 * 60 * 1000;
  for (const row of ledger) {
    if (row.status === "resolved" || row.status === "cancelled") continue;
    const t = new Date(row.lastReviewed).getTime();
    if (Number.isNaN(t)) continue;
    if (t < cutoff) {
      const days = Math.floor(
        (now.getTime() - t) / (24 * 60 * 60 * 1000),
      );
      warnings.push({
        kind: "stale-review",
        message: `Ledger §8 line ${row.lineNumber} (${row.type}, ${row.id}): last_reviewed=${row.lastReviewed} (${days} days ago, > ${maxDays} days)`,
        details: { line: row.lineNumber, type: row.type, id: row.id, lastReviewed: row.lastReviewed, days },
      });
    }
  }
  return warnings;
}

// ---- Public API ----

export interface CheckOptions {
  rootDir: string;
  now?: Date;
  maxStaleDays?: number;
}

export function checkTrackedItems(opts: CheckOptions): CheckResult {
  const { rootDir, now = new Date(), maxStaleDays = 90 } = opts;
  const errors: ErrorRecord[] = [];
  const warnings: WarningRecord[] = [];

  const ledgerPath = path.join(rootDir, "docs", "project-ledger.md");
  if (!fs.existsSync(ledgerPath)) {
    errors.push({
      kind: "missing-ledger",
      message: `${path.posix.join("docs", "project-ledger.md")} not found`,
    });
    return {
      errors,
      warnings,
      stats: {
        specRows: 0,
        reportRows: 0,
        ledgerRows: 0,
        skippedHistoricalSpecs: [],
      },
    };
  }

  const ledgerContent = fs.readFileSync(ledgerPath, "utf-8");
  const { rows: ledger, columnErrors, sectionFound } =
    parseLedgerRows(ledgerContent);
  errors.push(...columnErrors);

  if (!sectionFound) {
    errors.push({
      kind: "missing-section",
      message:
        "project-ledger.md §8 长期跟踪事项 section not found (CONSTITUTION 原则 8 requires this section)",
    });
  }

  errors.push(...checkLedgerEnums(ledger));

  const { rows: specRows, skipped } = scanSpecs(rootDir);
  const reportRows = scanReports(rootDir);
  const declared = [...specRows, ...reportRows];

  errors.push(...checkConsistency(declared, ledger));
  errors.push(...checkSourcePaths(rootDir, ledger));
  warnings.push(...checkLastReviewed(ledger, now, maxStaleDays));

  return {
    errors,
    warnings,
    stats: {
      specRows: specRows.length,
      reportRows: reportRows.length,
      ledgerRows: ledger.length,
      skippedHistoricalSpecs: skipped,
    },
  };
}

// ---- Reporters ----

export function formatHumanReport(r: CheckResult): string {
  const out: string[] = [];
  if (r.errors.length === 0 && r.warnings.length === 0) {
    out.push("✓ Tracked-items consistency check passed");
    out.push(
      `  spec rows: ${r.stats.specRows}, report rows: ${r.stats.reportRows}, ledger rows: ${r.stats.ledgerRows}` +
        (r.stats.skippedHistoricalSpecs.length > 0
          ? `, skipped ${r.stats.skippedHistoricalSpecs.length} historical spec(s)`
          : ""),
    );
    return out.join("\n");
  }
  if (r.errors.length > 0) {
    out.push(`❌ ${r.errors.length} error(s):`);
    for (const e of r.errors) {
      out.push(`  - [${e.kind}] ${e.message}`);
    }
  }
  if (r.warnings.length > 0) {
    out.push(`⚠ ${r.warnings.length} warning(s):`);
    for (const w of r.warnings) {
      out.push(`  - [${w.kind}] ${w.message}`);
    }
  }
  out.push(
    `Stats: spec=${r.stats.specRows}, report=${r.stats.reportRows}, ledger=${r.stats.ledgerRows}, skipped=${r.stats.skippedHistoricalSpecs.length}`,
  );
  return out.join("\n");
}

export function formatJsonReport(r: CheckResult): string {
  return JSON.stringify(
    {
      ok: r.errors.length === 0,
      errors: r.errors,
      warnings: r.warnings,
      stats: r.stats,
    },
    null,
    2,
  );
}

// ---- CLI ----

function isMain(): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  return import.meta.url === pathToFileURL(argvPath).href;
}

if (isMain()) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const rootArg = args.find((a) => a.startsWith("--root="));
  const rootDir = rootArg
    ? path.resolve(rootArg.slice("--root=".length))
    : process.cwd();
  const result = checkTrackedItems({ rootDir });
  process.stdout.write(
    (json ? formatJsonReport(result) : formatHumanReport(result)) + "\n",
  );
  process.exit(result.errors.length > 0 ? 1 : 0);
}
