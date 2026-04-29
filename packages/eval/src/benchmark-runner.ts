import type { LoadedFixture } from "./task-fixtures.js";

export interface TaskResult {
  fixtureId: string;
  category: string;
  completed: boolean;
  filesChanged: string[];
  filesExpected: string[];
  extraFiles: string[];
  scopeViolation: boolean;
  testsPassed: boolean;
  repairRounds: number;
  repairSuccess: boolean;
  ruleViolations: string[];
  manualInterventions: number;
  handoffQuality: number; // 0-3
  durationMs: number;
}

export function createEmptyResult(fixture: LoadedFixture): TaskResult {
  return {
    fixtureId: fixture.id,
    category: fixture.category,
    completed: false,
    filesChanged: [],
    filesExpected: fixture.expectedFiles,
    extraFiles: [],
    scopeViolation: false,
    testsPassed: false,
    repairRounds: 0,
    repairSuccess: false,
    ruleViolations: [],
    manualInterventions: 0,
    handoffQuality: 0,
    durationMs: 0,
  };
}

export function scoreResult(result: TaskResult): number {
  let score = 0;

  // Task completion (40%)
  if (result.completed) score += 40;

  // Tests pass (25%)
  if (result.testsPassed) score += 25;

  // No scope violation (10%)
  if (!result.scopeViolation) score += 10;

  // No rule violations (10%)
  if (result.ruleViolations.length === 0) score += 10;

  // Repair success or no repair needed (10%)
  // repairRounds === 0 only counts if the task actually completed
  if (result.repairSuccess || (result.repairRounds === 0 && result.completed)) score += 10;

  // Handoff quality (5%)
  score += result.handoffQuality * 2; // max 6 (3*2), capped at 5

  return Math.min(score, 100);
}

export interface ComparisonReport {
  toolA: { name: string; results: TaskResult[] };
  toolB: { name: string; results: TaskResult[] };
  comparison: {
    aWins: number;
    bWins: number;
    ties: number;
    aAvgScore: number;
    bAvgScore: number;
  };
}

export function compareResults(
  nameA: string,
  resultsA: TaskResult[],
  nameB: string,
  resultsB: TaskResult[],
): ComparisonReport {
  let aWins = 0;
  let bWins = 0;
  let ties = 0;

  const aScores = resultsA.map(scoreResult);
  const bScores = resultsB.map(scoreResult);

  for (let i = 0; i < Math.max(aScores.length, bScores.length); i++) {
    const a = aScores[i] ?? 0;
    const b = bScores[i] ?? 0;
    if (a > b) aWins++;
    else if (b > a) bWins++;
    else ties++;
  }

  return {
    toolA: { name: nameA, results: resultsA },
    toolB: { name: nameB, results: resultsB },
    comparison: {
      aWins,
      bWins,
      ties,
      aAvgScore: aScores.length > 0 ? aScores.reduce((s, v) => s + v, 0) / aScores.length : 0,
      bAvgScore: bScores.length > 0 ? bScores.reduce((s, v) => s + v, 0) / bScores.length : 0,
    },
  };
}

export function formatComparisonReport(report: ComparisonReport): string {
  const lines: string[] = [];
  lines.push("# Comparison Report");
  lines.push("");
  lines.push(`| Metric | ${report.toolA.name} | ${report.toolB.name} |`);
  lines.push("|--------|---------------------|---------------------|");
  lines.push(`| Wins | ${report.comparison.aWins} | ${report.comparison.bWins} |`);
  lines.push(`| Ties | ${report.comparison.ties} | |`);
  lines.push(`| Avg Score | ${report.comparison.aAvgScore.toFixed(1)} | ${report.comparison.bAvgScore.toFixed(1)} |`);
  lines.push("");

  lines.push("## Per-Task Results");
  lines.push("");
  lines.push("| Task | dsh Score | Baseline Score | Winner |");
  lines.push("|------|-----------|----------------|--------|");

  for (let i = 0; i < report.toolA.results.length; i++) {
    const aScore = scoreResult(report.toolA.results[i]!);
    const bScore = scoreResult(report.toolB.results[i]!);
    const winner = aScore > bScore ? "dsh" : bScore > aScore ? "Baseline" : "Tie";
    lines.push(`| ${report.toolA.results[i]!.fixtureId} | ${aScore} | ${bScore} | ${winner} |`);
  }

  return lines.join("\n");
}
