import type { StaticScanFinding } from "./task-state.js";

// ---- Types ----

export interface TopNWeights {
  severity: number;
  changedFile: number;
  security: number;
  buildBlocking: number;
  ruleConfidence: number;
}

export interface TopNConfig {
  topN: number;
  weights: TopNWeights;
}

export interface DimensionScore {
  severity: number;
  changedFile: number;
  security: number;
  buildBlocking: number;
  ruleConfidence: number;
  scannerOrder: number;
}

export interface ScoredFinding {
  finding: StaticScanFinding;
  dimensions: DimensionScore;
  total: number;
  reason: string;
}

// ---- Defaults ----

const DEFAULT_TOP_N = 5;

const DEFAULT_WEIGHTS: TopNWeights = {
  severity: 400,
  changedFile: 300,
  security: 200,
  buildBlocking: 150,
  ruleConfidence: 50,
};

// ---- Config Resolution ----

export function resolveTopNConfig(config: Record<string, unknown>): TopNConfig {
  const sc = isRecord(config["static_scan"]) ? config["static_scan"] : {};
  const sel = isRecord(sc["selection"]) ? sc["selection"] : {};
  const weights = isRecord(sel["weights"]) ? sel["weights"] : {};

  const topN = typeof sc["top_n"] === "number" && sc["top_n"] > 0
    ? Math.floor(sc["top_n"])
    : DEFAULT_TOP_N;

  return {
    topN,
    weights: {
      severity: readWeight(weights, "severity", DEFAULT_WEIGHTS.severity),
      changedFile: readWeight(weights, "changed_file", DEFAULT_WEIGHTS.changedFile),
      security: readWeight(weights, "security", DEFAULT_WEIGHTS.security),
      buildBlocking: readWeight(weights, "build_blocking", DEFAULT_WEIGHTS.buildBlocking),
      ruleConfidence: readWeight(weights, "rule_confidence", DEFAULT_WEIGHTS.ruleConfidence),
    },
  };
}

// ---- Scoring ----

export function selectTopFindings(
  findings: StaticScanFinding[],
  changedFiles: string[],
  config: TopNConfig,
): ScoredFinding[] {
  const scored = scoreFindings(findings, changedFiles, config.weights);
  scored.sort((a, b) => b.total - a.total || a.dimensions.scannerOrder - b.dimensions.scannerOrder);
  return scored.slice(0, config.topN);
}

export function scoreFindings(
  findings: StaticScanFinding[],
  changedFiles: string[],
  weights: TopNWeights,
): ScoredFinding[] {
  const changed = new Set(changedFiles);
  return findings.map((finding, index) => {
    const dimensions = scoreDimensions(finding, changed, index, weights);
    const total = dimensions.severity + dimensions.changedFile + dimensions.security
      + dimensions.buildBlocking + dimensions.ruleConfidence + dimensions.scannerOrder;
    const reason = buildReason(dimensions, weights);
    return { finding, dimensions, total, reason };
  });
}

function scoreDimensions(
  finding: StaticScanFinding,
  changedFiles: Set<string>,
  index: number,
  weights: TopNWeights,
): DimensionScore {
  const severity = scoreSeverity(finding.severity, weights.severity);
  const changedFile = changedFiles.has(finding.file) ? weights.changedFile : 0;
  const isSecurity = finding.category === "security" || finding.category === "secret";
  const security = isSecurity ? weights.security : 0;
  const isBuild = severityLevel(finding.severity) >= ERROR_LEVEL
    && (finding.category === "bug" || finding.category === "type");
  const buildBlocking = isBuild ? weights.buildBlocking : 0;
  const ruleConfidence = finding.rule !== null ? weights.ruleConfidence : 0;
  const scannerOrder = -index / 1000;

  return { severity, changedFile, security, buildBlocking, ruleConfidence, scannerOrder };
}

// ---- Dimension Helpers ----

const ERROR_LEVEL = 3;

function severityLevel(severity: StaticScanFinding["severity"]): number {
  switch (severity) {
    case "critical": return 5;
    case "high": return 4;
    case "error": return 3;
    case "medium": return 2;
    case "warning": return 1;
    case "low": return 0;
    case "info": return -1;
  }
}

function scoreSeverity(severity: StaticScanFinding["severity"], weight: number): number {
  const ratios: Record<string, number> = {
    critical: 1.0,
    high: 0.75,
    error: 0.5,
    medium: 0.25,
    warning: 0.125,
    low: 0,
    info: 0,
  };
  return Math.round(weight * (ratios[severity] ?? 0));
}

// ---- Reason Generation ----

export function buildReason(dimensions: DimensionScore, weights?: TopNWeights): string {
  const parts: string[] = [];
  const w = weights ?? {
    severity: 400, changedFile: 300, security: 200, buildBlocking: 150, ruleConfidence: 50,
  };
  // Reconstruct severity label from its weighted score
  const sevFraction = w.severity > 0 ? dimensions.severity / w.severity : 0;
  if (dimensions.severity > 0) parts.push(`${severityLabel(sevFraction)} severity (${dimensions.severity})`);
  if (dimensions.changedFile > 0) parts.push(`changed file (${dimensions.changedFile})`);
  if (dimensions.security > 0) parts.push(`security/secret (${dimensions.security})`);
  if (dimensions.buildBlocking > 0) parts.push(`build blocking (${dimensions.buildBlocking})`);
  if (dimensions.ruleConfidence > 0) parts.push(`rule confidence (${dimensions.ruleConfidence})`);
  if (parts.length === 0) parts.push("scanner order");
  return parts.join(" + ");
}

function severityLabel(fraction: number): string {
  if (fraction >= 1.0) return "critical";
  if (fraction >= 0.75) return "high";
  if (fraction >= 0.5) return "error";
  if (fraction >= 0.25) return "medium";
  if (fraction >= 0.125) return "warning";
  return "info";
}

// ---- Formatting ----

export function formatScoredFindings(scored: ScoredFinding[]): string {
  return scored.map((s, i) => {
    const f = s.finding;
    const rule = f.rule ? ` (${f.rule})` : "";
    const loc = [f.file, f.line, f.column].filter((v) => v !== null).join(":");
    return `${i + 1}. ${f.id} ${loc} ${f.severity}${rule}: ${f.message} [total=${s.total}]`;
  }).join("\n");
}

// ---- Internal Helpers ----

function readWeight(
  weights: Record<string, unknown>,
  key: string,
  defaultVal: number,
): number {
  const val = weights[key];
  if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
    return val;
  }
  return defaultVal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
