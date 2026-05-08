// Project Intelligence Engine — Phase 1 (BLUEPRINT §2.6)
//
// Core idea: DSH should not pass weak inferences off as facts; it should
// convert them into candidates, probes, and suggestions.
//
// This module introduces the minimal Fact → Candidate → Decision model
// and the ProjectIntelligence aggregate. Phase 1 is deliberately small:
// collect file-system facts and produce language / build-system decisions.
// CI analysis, source-syntax version inference, and probe execution are
// Phase 2+.

import * as fs from "node:fs";
import * as path from "node:path";
import type { TechStack } from "./scanner.js";

// ---- Models ----

export interface ProjectFact {
  key: string;
  value: unknown;
  source: { type: "file" | "directory" | "file-content"; path?: string };
  confidence: "high" | "medium" | "low";
}

export interface Candidate<T> {
  value: T;
  confidence: number;        // 0..1
  evidence: string[];        // facts that support this candidate
  missingEvidence: string[]; // facts that would confirm it but are absent
}

export type DecisionMode = "auto" | "suggest" | "ask-user" | "blocked";

export interface ProjectDecision<T> {
  key: string;
  selected: T | null;
  mode: DecisionMode;
  confidence: number;
  reason: string[];
  alternatives: Candidate<T>[];
}

export type CapabilityStatus = "available" | "likely" | "unavailable";

export interface ProjectCapability {
  key: string;
  status: CapabilityStatus;
  command: string | null;
  reason: string;
}

// ---- Decision Policy ----

export interface DecisionPolicy {
  autoThreshold: number;
  suggestThreshold: number;
  minMargin: number;
}

export const DEFAULT_POLICY: DecisionPolicy = {
  autoThreshold: 0.85,
  suggestThreshold: 0.40,
  minMargin: 0.20,
};

// ---- Fact Collector ----

const BUILD_DESCRIPTORS: Record<string, string> = {
  "pom.xml": "maven",
  "build.gradle": "gradle",
  "build.gradle.kts": "gradle",
  "settings.gradle": "gradle",
  "settings.gradle.kts": "gradle",
  "build.xml": "ant",
  "BUILD.bazel": "bazel",
  "Makefile": "make",
};

const WRAPPER_SCRIPTS: Record<string, string> = {
  "mvnw": "maven",
  "gradlew": "gradle",
};

const PKG_MANAGER_DESCRIPTORS: Record<string, string> = {
  "package.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
  "pyproject.toml": "pip|poetry|pdm",
  "requirements.txt": "pip",
  "Pipfile": "pipenv",
  "go.mod": "go-modules",
  "Cargo.toml": "cargo",
};

function listTopFiles(cwd: string): Set<string> {
  const result = new Set<string>();
  try {
    for (const entry of fs.readdirSync(cwd, { withFileTypes: true })) {
      if (entry.isFile() && !entry.name.startsWith(".")) result.add(entry.name);
    }
  } catch { /* directory unreadable — return empty */ }
  return result;
}

function countSourceFiles(cwd: string, exts: string[], maxDepth = 2): number {
  const stopDirs = new Set(["node_modules", ".git", "dist", "__pycache__", "target", ".venv", "venv", ".dsh"]);
  let count = 0;
  function walk(dir: string, depth: number): void {
    if (depth > maxDepth || count > 100) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!stopDirs.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name), depth + 1);
      } else if (e.isFile()) {
        if (exts.includes(path.extname(e.name).toLowerCase())) count++;
      }
    }
  }
  walk(cwd, 0);
  return count;
}

function srcLayoutHints(cwd: string): string[] {
  const hints: string[] = [];
  const dirs = ["src/main/java", "src/test/java", "src/main/kotlin", "src", "lib", "app",
    "backend", "frontend", "packages", "tools", "tests", "test"];
  for (const d of dirs) {
    if (fs.existsSync(path.join(cwd, d)) && fs.statSync(path.join(cwd, d)).isDirectory()) {
      hints.push(d);
    }
  }
  return hints;
}

export function collectFacts(cwd: string): ProjectFact[] {
  const topFiles = listTopFiles(cwd);
  const facts: ProjectFact[] = [];
  const no = (key: string) => facts.push({ key, value: false, source: { type: "file" }, confidence: "high" });
  const yes = (key: string, type: "file" | "directory" = "file", p?: string) =>
    facts.push({ key, value: true, source: { type, path: p }, confidence: "high" });

  // Source files (threshold ≥3, same as current scanner)
  const javaCount = countSourceFiles(cwd, [".java"]);
  const pyCount = countSourceFiles(cwd, [".py"]);
  const tsCount = countSourceFiles(cwd, [".ts", ".tsx"]);
  const jsCount = countSourceFiles(cwd, [".js", ".jsx"]);
  const goCount = countSourceFiles(cwd, [".go"]);
  const rsCount = countSourceFiles(cwd, [".rs"]);

  if (javaCount >= 3) yes("source.java.exists", "directory");
  if (pyCount >= 3) yes("source.python.exists", "directory");
  if (tsCount >= 3) yes("source.typescript.exists", "directory");
  if (jsCount >= 3) yes("source.javascript.exists", "directory");
  if (goCount >= 3) yes("source.go.exists", "directory");
  if (rsCount >= 3) yes("source.rust.exists", "directory");

  // Build descriptors
  for (const [name, system] of Object.entries(BUILD_DESCRIPTORS)) {
    if (topFiles.has(name)) yes(`build.descriptor.${system}`, "file", name);
    else no(`build.descriptor.${system}`);
  }

  // Wrapper scripts
  for (const [name, system] of Object.entries(WRAPPER_SCRIPTS)) {
    if (topFiles.has(name)) yes(`build.wrapper.${system}`, "file", name);
    else no(`build.wrapper.${system}`);
  }

  // Package manager descriptors
  for (const [name, pm] of Object.entries(PKG_MANAGER_DESCRIPTORS)) {
    if (topFiles.has(name)) yes(`pkg.descriptor.${pm}`, "file", name);
  }

  // Source layout
  const layout = srcLayoutHints(cwd);
  for (const d of layout) {
    yes(`layout.${d}`, "directory", d);
  }

  // Node details
  if (topFiles.has("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"));
      if (pkg?.name) facts.push({ key: "pkg.name", value: pkg.name, source: { type: "file-content", path: "package.json" }, confidence: "high" });
      if (pkg?.engines?.node) facts.push({ key: "runtime.node.declared", value: pkg.engines.node, source: { type: "file-content", path: "package.json" }, confidence: "high" });
      if (pkg?.scripts) {
        const names = Object.keys(pkg.scripts);
        facts.push({ key: "pkg.scripts", value: names, source: { type: "file-content", path: "package.json" }, confidence: "high" });
      }
    } catch { /* unparseable JSON */ }
  }

  return facts;
}

// ---- Candidate Generation ----

function candidate<T>(
  value: T, confidence: number, evidence: string[], missing: string[],
): Candidate<T> {
  return { value, confidence, evidence, missingEvidence: missing };
}

const LANG_SIGNALS: Record<string, { prio: number; deps: string[] }> = {
  "source.java.exists": { prio: 5, deps: [] },
  "source.typescript.exists": { prio: 6, deps: [] },
  "source.python.exists": { prio: 6, deps: [] },
  "source.go.exists": { prio: 5, deps: [] },
  "source.rust.exists": { prio: 5, deps: [] },
  "source.javascript.exists": { prio: 3, deps: ["source.typescript.exists"] },
  "pkg.descriptor.pip|poetry|pdm": { prio: 5, deps: [] },
  "pkg.descriptor.npm": { prio: 5, deps: [] },
  "pkg.descriptor.cargo": { prio: 5, deps: [] },
  "pkg.descriptor.go-modules": { prio: 5, deps: [] },
};

export function generateLanguageCandidates(facts: ProjectFact[]): Candidate<string>[] {
  const factSet = new Set(facts.filter((f) => f.value).map((f) => f.key));
  const candidates: Candidate<string>[] = [];

  for (const [signal, { prio, deps }] of Object.entries(LANG_SIGNALS)) {
    if (!factSet.has(signal)) continue;
    // Skip JavaScript if TypeScript also present (lower prio)
    const blocked = deps.some((d) => factSet.has(d));
    if (blocked) continue;
    const lang = signal.replace("source.", "").replace(".exists", "").replace(/^pkg\.descriptor\./, "").split("|")[0] === "pip" ? "python"
      : signal.replace("pkg.descriptor.", "").split("|")[0] === "npm" ? "typescript"
      : signal.replace("source.", "").replace(".exists", "");
    candidates.push(candidate(lang, 0.4 + prio * 0.1, [signal], []));
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

const BUILD_SIGNALS: Record<string, { prio: number; evidence: string; missing: string[] }> = {
  "build.descriptor.maven": { prio: 8, evidence: "pom.xml exists", missing: [] },
  "build.descriptor.gradle": { prio: 8, evidence: "build.gradle exists", missing: [] },
  "build.descriptor.ant": { prio: 5, evidence: "build.xml exists", missing: [] },
  "build.descriptor.bazel": { prio: 5, evidence: "BUILD.bazel exists", missing: [] },
  "build.descriptor.make": { prio: 3, evidence: "Makefile exists", missing: [] },
  "build.wrapper.maven": { prio: 6, evidence: "mvnw exists", missing: ["pom.xml"] },
  "build.wrapper.gradle": { prio: 6, evidence: "gradlew exists", missing: ["build.gradle"] },
};

export function generateBuildSystemCandidates(facts: ProjectFact[]): Candidate<string>[] {
  const factSet = new Set(facts.filter((f) => f.value).map((f) => f.key));
  const candidates: Candidate<string>[] = [];

  for (const [signal, { prio, evidence, missing }] of Object.entries(BUILD_SIGNALS)) {
    if (!factSet.has(signal)) continue;
    candidates.push(candidate(
      signal.replace("build.descriptor.", "").replace("build.wrapper.", ""),
      0.3 + prio * 0.07,
      [evidence],
      missing.filter((m) => !factSet.has(m)),
    ));
  }

  // If no build descriptors at all but Java source exists, add weak suggestions
  if (candidates.length === 0 && factSet.has("source.java.exists")) {
    candidates.push(candidate("maven", 0.25, ["Java source files exist"], ["pom.xml", "build.gradle"]));
    candidates.push(candidate("gradle", 0.20, ["Java source files exist"], ["build.gradle", "pom.xml"]));
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

// ---- Decision ----

export function decide<T>(
  candidates: Candidate<T>[],
  policy: DecisionPolicy,
  key: string,
): ProjectDecision<T> {
  if (candidates.length === 0) {
    return { key, selected: null, mode: "blocked", confidence: 0, reason: ["no candidates"], alternatives: [] };
  }

  const top = candidates[0]!;
  const second = candidates[1];

  // auto: top ≥ autoThreshold AND margin ≥ minMargin
  if (top.confidence >= policy.autoThreshold) {
    const margin = second ? top.confidence - second.confidence : 1;
    if (margin >= policy.minMargin) {
      return {
        key, selected: top.value, mode: "auto", confidence: top.confidence,
        reason: top.evidence, alternatives: candidates.slice(1),
      };
    }
  }

  // suggest: top ≥ suggestThreshold
  if (top.confidence >= policy.suggestThreshold) {
    const reason = [...top.evidence];
    if (top.missingEvidence.length > 0) reason.push(`missing: ${top.missingEvidence.join(", ")}`);
    return {
      key, selected: top.value, mode: "suggest", confidence: top.confidence,
      reason, alternatives: candidates.slice(1),
    };
  }

  // blocked
  return { key, selected: null, mode: "blocked", confidence: 0, reason: ["all candidates below threshold"], alternatives: candidates };
}

// ---- Capability Derivation ----

export function deriveCapabilities(
  language: ProjectDecision<string>,
  buildSystem: ProjectDecision<string>,
): ProjectCapability[] {
  const caps: ProjectCapability[] = [];
  const lang = language.mode === "auto" ? language.selected : null;
  const bld = buildSystem.mode === "auto" ? buildSystem.selected : null;

  // source-level operations always available when language is known
  const canSourceEdit = lang !== null;
  caps.push({
    key: "patch", status: canSourceEdit ? (bld ? "available" : "likely") : "unavailable",
    command: null,
    reason: canSourceEdit ? `language=${lang}, build=${bld ?? "unknown"}` : "language unknown",
  });

  // build
  if (bld === "maven") {
    caps.push({ key: "build", status: "available", command: "mvn package -DskipTests -q", reason: "pom.xml + maven" });
    caps.push({ key: "test", status: "available", command: "mvn test -q", reason: "pom.xml + maven" });
    caps.push({ key: "typecheck", status: "available", command: "mvn compile -q", reason: "pom.xml + maven" });
  } else if (bld === "gradle") {
    caps.push({ key: "build", status: "available", command: "gradle build", reason: "build.gradle" });
    caps.push({ key: "test", status: "available", command: "gradle test", reason: "build.gradle" });
    caps.push({ key: "typecheck", status: "available", command: "gradle compileJava", reason: "build.gradle" });
  } else if (lang === "go") {
    caps.push({ key: "build", status: "available", command: "go build ./...", reason: "go.mod" });
    caps.push({ key: "test", status: "available", command: "go test ./...", reason: "go.mod" });
    caps.push({ key: "typecheck", status: "available", command: "go vet ./...", reason: "go.mod" });
  } else if (lang === "rust") {
    caps.push({ key: "build", status: "available", command: "cargo build", reason: "Cargo.toml" });
    caps.push({ key: "test", status: "available", command: "cargo test", reason: "Cargo.toml" });
    caps.push({ key: "typecheck", status: "available", command: "cargo check", reason: "Cargo.toml" });
  } else if (lang === "python" || lang === "typescript" || lang === "javascript") {
    // For interpreted / script-based languages, capabilities depend on package manager
    // Phase 1: report "likely" but don't assume commands; Phase 2 adds package-manager resolution
    caps.push({ key: "build", status: "likely", command: null, reason: `${lang} project — build command varies by package manager` });
    caps.push({ key: "test", status: "likely", command: null, reason: `${lang} project — test command varies by package manager` });
  } else {
    caps.push({ key: "build", status: "unavailable", command: null, reason: "build system unknown" });
    caps.push({ key: "test", status: "unavailable", command: null, reason: "build system unknown" });
    caps.push({ key: "typecheck", status: "unavailable", command: null, reason: "build system unknown" });
  }

  return caps;
}

// ---- Project Intelligence Assembly ----

export interface ProjectIntelligence {
  language: ProjectDecision<string>;
  buildSystem: ProjectDecision<string>;
  capabilities: ProjectCapability[];
  facts: ProjectFact[];
}

export function assembleIntelligence(cwd: string, policy: DecisionPolicy = DEFAULT_POLICY): ProjectIntelligence {
  const facts = collectFacts(cwd);
  const langCandidates = generateLanguageCandidates(facts);
  const buildCandidates = generateBuildSystemCandidates(facts);
  const language = decide(langCandidates, policy, "language.primary");
  const buildSystem = decide(buildCandidates, policy, "build.system");
  const capabilities = deriveCapabilities(language, buildSystem);
  return { language, buildSystem, capabilities, facts };
}

// ---- Views ----

export function toProjectCard(pi: ProjectIntelligence): string {
  const lines: string[] = ["## Project Card", ""];

  // Known
  const known = [
    pi.language.mode === "auto" ? `Primary language: ${pi.language.selected}` : null,
    ...pi.facts.filter((f) => f.value === true && f.confidence === "high").slice(0, 8).map((f) => {
      const label = f.key.replace(/^(source\.|build\.|pkg\.|layout\.)/, "");
      return `- ${label}: ${f.source.path ?? "detected"}`;
    }),
  ].filter(Boolean);
  if (known.length > 0) {
    lines.push("**Known**");
    for (const k of known) lines.push(k as string);
    lines.push("");
  }

  // Inferred
  if (pi.language.mode === "suggest" || pi.buildSystem.mode === "suggest") {
    lines.push("**Inferred (unconfirmed)**");
    if (pi.language.mode === "suggest") lines.push(`- Language: likely ${pi.language.selected} (${(pi.language.confidence * 100).toFixed(0)}%)`);
    if (pi.buildSystem.mode === "suggest") {
      lines.push(`- Build system: likely ${pi.buildSystem.selected} (${(pi.buildSystem.confidence * 100).toFixed(0)}%)`);
      if (pi.buildSystem.alternatives.length > 0) {
        lines.push(`  Alternatives: ${pi.buildSystem.alternatives.map((a) => `${a.value} (${(a.confidence * 100).toFixed(0)}%)`).join(", ")}`);
      }
    }
    lines.push("");
  }

  // Unknown
  const unknown = [
    pi.buildSystem.mode === "blocked" ? "Build system" : null,
    pi.language.mode === "blocked" ? "Primary language" : null,
  ].filter(Boolean);
  if (unknown.length > 0) {
    lines.push("**Unknown**");
    for (const u of unknown) lines.push(`- ${u}`);
    lines.push("");
  }

  // Capabilities
  lines.push("**Capabilities**");
  for (const c of pi.capabilities) {
    const icon = c.status === "available" ? "✓" : c.status === "likely" ? "~" : "✗";
    lines.push(`${icon} ${c.key}: ${c.status}${c.command ? ` (${c.command})` : ""} — ${c.reason}`);
  }

  return lines.join("\n");
}

// ---- Legacy Bridge (Phase 1 compatibility) ----

export function toLegacyTechStack(pi: ProjectIntelligence): TechStack {
  const lang = pi.language.selected ?? "unknown";
  const isAuto = pi.language.mode === "auto" || pi.language.mode === "suggest";
  const bld = pi.buildSystem.mode === "auto" ? pi.buildSystem.selected : null;

  return {
    language: isAuto ? lang : "unknown",
    packageManager: bld === "maven" ? "maven" : bld === "gradle" ? "gradle" : null,
    framework: null,
    details: {},
  };
}
