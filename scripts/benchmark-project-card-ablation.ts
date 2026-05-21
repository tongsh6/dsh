/**
 * Targeted Project Card section ablation.
 *
 * Runs one fixture with different Project Card injections:
 *   - off: no Project Card
 *   - full: normal generated Project Card
 *   - section variants: inject only one generated Project Card section
 *   - combination variants: remove or combine specific generated sections
 *
 * Output: docs/reports/runlogs/<runId>-project-card-ablation/
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DeepSeekClient } from "../packages/provider/dist/client.js";
import { injectCardContext, type ProjectCardInjection } from "../packages/core/dist/inject-card-context.js";
import { readApiKey, assembleIntelligence, toProjectCard } from "../packages/repo/dist/index.js";
import { loadAllFixtures, type LoadedFixture } from "../packages/eval/dist/task-fixtures.js";
import {
  classifyTaskFailure,
  cleanBenchmarkWorktreeHard,
  runTask,
  type TaskResult,
} from "../packages/eval/dist/benchmark-runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const FIXTURES_DIR = path.join(PROJECT_ROOT, "packages/eval/src/fixtures");
const BENCH_ROOT = path.join(os.homedir(), "dsh-bench");
const REPOS_DIR = path.join(BENCH_ROOT, "repos");
const REPORTS_ROOT = path.join(PROJECT_ROOT, "docs", "reports", "runlogs");

const DEFAULT_FIXTURE = "loam-refactor-rename-distill-state";
const DEFAULT_VARIANTS = [
  "off",
  "full",
  "known_facts",
  "unknowns",
  "full_minus_unknowns",
  "known_plus_unknowns",
  "full_minus_known",
  "capabilities",
  "forbidden_assumptions",
] as const;

type CardVariant =
  | "off"
  | "full"
  | "known_facts"
  | "inferred_candidates"
  | "unknowns"
  | "capabilities"
  | "forbidden_assumptions"
  | "suggested_probes"
  | "full_minus_unknowns"
  | "known_plus_unknowns"
  | "full_minus_known";

type SectionVariant = Exclude<
  CardVariant,
  "off" | "full" | "full_minus_unknowns" | "known_plus_unknowns" | "full_minus_known"
>;

const SECTION_TITLES: Record<SectionVariant, string> = {
  known_facts: "Known Facts",
  inferred_candidates: "Inferred Candidates",
  unknowns: "Verification Unknowns",
  capabilities: "Capabilities",
  forbidden_assumptions: "Forbidden Assumptions",
  suggested_probes: "Suggested Probes",
};

const UNKNOWN_SECTION_TITLES = new Set(["Unknowns", "Verification Unknowns"]);

interface TrialResult extends Record<string, unknown> {
  fixtureId: string;
  variant: CardVariant;
  trialIndex: number;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
  injectedCardPreview: string | null;
  completed?: boolean;
  testsPassed?: boolean;
  failureClass?: string;
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function gitShortHash(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf-8",
      cwd: PROJECT_ROOT,
      timeout: 3000,
    }).trim();
  } catch {
    return "unknown";
  }
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function parseVariants(raw: string | undefined): CardVariant[] {
  const variants = raw ? raw.split(",").map((v) => v.trim()).filter(Boolean) : [...DEFAULT_VARIANTS];
  const allowed = new Set<CardVariant>([
    "off",
    "full",
    "known_facts",
    "inferred_candidates",
    "unknowns",
    "capabilities",
    "forbidden_assumptions",
    "suggested_probes",
    "full_minus_unknowns",
    "known_plus_unknowns",
    "full_minus_known",
  ]);
  for (const variant of variants) {
    if (!allowed.has(variant as CardVariant)) {
      throw new Error(`unknown --variants entry '${variant}'`);
    }
  }
  return variants as CardVariant[];
}

function extractProjectCardSections(card: string): Map<string, string> {
  const lines = card.split("\n");
  const sections = new Map<string, string>();
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  function flush(): void {
    if (currentTitle) {
      sections.set(currentTitle, currentLines.join("\n").trimEnd());
    }
  }

  for (const line of lines) {
    const match = /^\*\*(.+)\*\*$/.exec(line.trim());
    if (match) {
      flush();
      currentTitle = match[1]!;
      currentLines = [line];
    } else if (currentTitle) {
      currentLines.push(line);
    }
  }
  flush();
  return sections;
}

function renderCardFromSections(sections: readonly string[]): string {
  return ["## Project Card", "", ...sections.map((section) => section.trimEnd())].join("\n\n");
}

function buildSectionCard(fullCard: string, variant: SectionVariant): string {
  const title = SECTION_TITLES[variant];
  const sections = extractProjectCardSections(fullCard);
  const section = variant === "unknowns"
    ? findUnknownSection(sections)
    : sections.get(title);
  if (!section) {
    throw new Error(`generated Project Card does not contain section '${title}'`);
  }
  return renderCardFromSections([section]);
}

function buildCombinationCard(fullCard: string, variant: "full_minus_unknowns" | "known_plus_unknowns" | "full_minus_known"): string {
  const sections = extractProjectCardSections(fullCard);

  function requireSection(title: string): string {
    const section = sections.get(title);
    if (!section) throw new Error(`generated Project Card does not contain section '${title}'`);
    return section;
  }

  if (variant === "known_plus_unknowns") {
    const unknownSection = findUnknownSection(sections);
    if (!unknownSection) throw new Error("generated Project Card does not contain an unknowns section");
    return renderCardFromSections([
      requireSection("Known Facts"),
      unknownSection,
    ]);
  }

  const dropped = variant === "full_minus_unknowns" ? UNKNOWN_SECTION_TITLES : new Set(["Known Facts"]);
  const retained: string[] = [];
  for (const [title, section] of sections.entries()) {
    if (!dropped.has(title)) retained.push(section);
  }
  return renderCardFromSections(retained);
}

function findUnknownSection(sections: ReadonlyMap<string, string>): string | undefined {
  for (const title of UNKNOWN_SECTION_TITLES) {
    const section = sections.get(title);
    if (section) return section;
  }
  return undefined;
}

function buildInjection(repoPath: string, variant: CardVariant): {
  injection: ProjectCardInjection;
  preview: string | null;
  fullCard: string;
} {
  const fullCard = toProjectCard(assembleIntelligence(repoPath));
  if (variant === "off") return { injection: false, preview: null, fullCard };
  if (variant === "full") return { injection: true, preview: fullCard, fullCard };
  const card = variant === "full_minus_unknowns" || variant === "known_plus_unknowns" || variant === "full_minus_known"
    ? buildCombinationCard(fullCard, variant)
    : buildSectionCard(fullCard, variant);
  return { injection: card, preview: card, fullCard };
}

function classifyTrialFailure(result: TrialResult): string | undefined {
  const diagnostics = result.diagnostics && typeof result.diagnostics === "object"
    ? result.diagnostics as Parameters<typeof classifyTaskFailure>[0]["diagnostics"]
    : undefined;
  const planDiagnostics = result.planDiagnostics && typeof result.planDiagnostics === "object"
    ? result.planDiagnostics as Parameters<typeof classifyTaskFailure>[0]["planDiagnostics"]
    : undefined;
  return classifyTaskFailure({
    testsPassed: result.testsPassed === true,
    completed: result.completed === true,
    error: typeof result.error === "string" ? result.error : undefined,
    diagnostics,
    planDiagnostics,
  });
}

function initialPatch(result: TrialResult): Record<string, unknown> | undefined {
  const diagnostics = result.diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return undefined;
  const patches = (diagnostics as { patches?: unknown }).patches;
  if (!Array.isArray(patches)) return undefined;
  return patches.find((patch) =>
    patch && typeof patch === "object" && (patch as { phase?: string }).phase === "patch"
  ) as Record<string, unknown> | undefined;
}

function firstFailedAssertions(result: TrialResult): string[] {
  const diagnostics = result.diagnostics;
  if (!diagnostics || typeof diagnostics !== "object") return [];
  const verifyResults = (diagnostics as { verifyResults?: unknown }).verifyResults;
  if (!Array.isArray(verifyResults)) return [];
  const failures: string[] = [];
  for (const round of verifyResults) {
    const results = round && typeof round === "object"
      ? (round as { results?: unknown }).results
      : undefined;
    if (!Array.isArray(results)) continue;
    for (const item of results) {
      if (!item || typeof item !== "object") continue;
      const record = item as { command?: unknown; status?: unknown };
      if (record.status === "failed" && typeof record.command === "string") {
        failures.push(record.command);
      }
    }
    if (failures.length > 0) return failures;
  }
  return failures;
}

function formatSummary(results: readonly TrialResult[], metadata: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push("# Project Card Section Ablation");
  lines.push("");
  lines.push(`- Run: ${metadata.runId}`);
  lines.push(`- Fixture: ${metadata.fixtureId}`);
  lines.push(`- Seed: ${metadata.seed}`);
  lines.push(`- DSH commit: ${metadata.dshCommit}`);
  lines.push("");
  lines.push("| Variant | Result | Failure | Initial coverage | Initial changed files | First failed assertions |");
  lines.push("|---|---:|---|---|---|---|");
  for (const result of results) {
    const patch = initialPatch(result);
    const coverage = typeof patch?.coverage === "string" ? patch.coverage : "";
    const changed = Array.isArray(patch?.files_changed) ? patch.files_changed.join("<br>") : "";
    const failures = firstFailedAssertions(result).slice(0, 5).join("<br>");
    lines.push([
      result.variant,
      result.testsPassed ? "PASS" : "FAIL",
      result.failureClass ?? "",
      coverage,
      changed,
      failures,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("");
  lines.push("## Injected Cards");
  for (const result of results) {
    lines.push("");
    lines.push(`### ${result.variant}`);
    lines.push("```md");
    lines.push(result.injectedCardPreview ?? "(Project Card disabled)");
    lines.push("```");
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const fixtureId = argValue("fixture") ?? DEFAULT_FIXTURE;
  const variants = parseVariants(argValue("variants"));
  const seed = argValue("seed") ? parseInt(argValue("seed")!, 10) : Date.now();
  const orderedVariants = argValue("no-shuffle") === "true" ? variants : shuffle(variants, mulberry32(seed));
  const startedAt = new Date().toISOString();
  const runId = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..*/, "")
    .slice(2);
  const runDir = path.join(REPORTS_ROOT, `${runId}-project-card-ablation`);
  fs.mkdirSync(runDir, { recursive: true });

  const fixture = loadAllFixtures(FIXTURES_DIR).find((candidate) => candidate.id === fixtureId);
  if (!fixture) throw new Error(`fixture '${fixtureId}' not found`);
  const repo = fixture.benchmarkRef?.repo;
  if (!repo) throw new Error(`fixture '${fixtureId}' has no benchmarkRef.repo`);
  const repoPath = path.join(REPOS_DIR, repo);
  if (!fs.existsSync(repoPath)) throw new Error(`repo not found: ${repoPath}`);

  const apiKey = readApiKey(PROJECT_ROOT);
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not found; cannot run ablation");
  const client = new DeepSeekClient({ apiKey });

  const metadata: Record<string, unknown> = {
    runId,
    fixtureId,
    repo,
    repoPath,
    seed,
    requestedVariants: variants,
    orderedVariants,
    dshCommit: gitShortHash(),
    startedAt,
  };
  fs.writeFileSync(path.join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));

  const resultsPath = path.join(runDir, "results.json");
  const results: TrialResult[] = [];
  const baselineRef = fixture.benchmarkRef?.commit ?? fixture.benchmarkRef?.branch ?? "HEAD";

  console.log(`Project Card ablation: ${fixture.id}`);
  console.log(`Variants: ${orderedVariants.join(", ")}`);
  console.log(`Artifacts: ${runDir}`);

  for (const [idx, variant] of orderedVariants.entries()) {
    const startedAtTrial = new Date().toISOString();
    const tStart = Date.now();
    console.log(`\n[${idx + 1}/${orderedVariants.length}] ${variant}`);

    try {
      cleanBenchmarkWorktreeHard(repoPath, baselineRef, null);
      const { injection, preview, fullCard } = buildInjection(repoPath, variant);
      fs.writeFileSync(path.join(runDir, `card-${variant}.md`), preview ?? "(Project Card disabled)\n");
      if (!fs.existsSync(path.join(runDir, "card-full-generated.md"))) {
        fs.writeFileSync(path.join(runDir, "card-full-generated.md"), `${fullCard}\n`);
      }

      const result: TaskResult = await injectCardContext.run(injection, () =>
        runTask(fixture as LoadedFixture, repoPath, client, { skipBranchSetup: true })
      );
      const trial: TrialResult = {
        fixtureId: fixture.id,
        variant,
        trialIndex: idx + 1,
        startedAt: startedAtTrial,
        completedAt: new Date().toISOString(),
        elapsedMs: Date.now() - tStart,
        injectedCardPreview: preview,
        ...(result as unknown as Record<string, unknown>),
      };
      trial.failureClass = classifyTrialFailure(trial);
      results.push(trial);
      console.log(`  -> ${trial.testsPassed ? "PASS" : "FAIL"} (${(trial.elapsedMs / 1000).toFixed(0)}s, failure=${trial.failureClass ?? "none"})`);
    } catch (error) {
      const trial: TrialResult = {
        fixtureId: fixture.id,
        variant,
        trialIndex: idx + 1,
        startedAt: startedAtTrial,
        completedAt: new Date().toISOString(),
        elapsedMs: Date.now() - tStart,
        injectedCardPreview: null,
        error: error instanceof Error ? error.message : String(error),
        completed: false,
        testsPassed: false,
      };
      trial.failureClass = classifyTrialFailure(trial);
      results.push(trial);
      console.error(`  -> ERROR ${trial.error}`);
    }

    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(runDir, "summary.md"), formatSummary(results, metadata));
  }

  metadata.completedAt = new Date().toISOString();
  metadata.summary = Object.fromEntries(
    variants.map((variant) => {
      const result = results.find((candidate) => candidate.variant === variant);
      return [variant, result ? { testsPassed: result.testsPassed, failureClass: result.failureClass } : null];
    }),
  );
  fs.writeFileSync(path.join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  fs.writeFileSync(path.join(runDir, "summary.md"), formatSummary(results, metadata));
  console.log(`\nDone: ${runDir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
