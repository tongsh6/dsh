// PlanFileContract v2 — internal model for the patch coverage state machine.
//
// Turns the patch stage's target into an explicit, role-aware contract so the
// patch loop's exit logic can be bound to *required target file coverage*
// rather than to model-behaviour signals (done / invalid / tools-only / rounds).
// See spec docs/specs/2026-05-19-patch-pipeline-coverage-state-machine.md §4.1.

export type PlanFileRole = "required_target" | "optional_target" | "context";
export type PlanFileConfidence = "high" | "medium" | "low";
export type PlanFileContractSource = "explicit_v2" | "legacy_files" | "derived";

export interface PlanFileContractEntry {
  path: string;
  role: PlanFileRole;
  confidence: PlanFileConfidence;
  source: PlanFileContractSource;
}

export interface PlanFileContract {
  requiredTargetFiles: PlanFileContractEntry[];
  optionalTargetFiles: PlanFileContractEntry[];
  contextFiles: PlanFileContractEntry[];
  version: "legacy" | "v2";
}

// Minimal shape buildPlanFileContract needs. `file_contract` is a
// forward-compatibility hook: no producer emits it yet — the external plan
// schema is unchanged (spec §2.2 / §5 D4) — but the explicit-v2 path is kept
// so a future plan-schema v2 activates without editing this function.
export interface PlanContractInput {
  files?: string[];
  file_contract?: unknown;
}

// Normalize a repo-relative path for coverage comparison: posix separators,
// strip leading "./", drop empty and "." segments. Deliberately does NOT
// case-fold — case-sensitive filesystems would mis-match distinct files, so
// folding case here would be a correctness bug (spec §4.1).
export function normalizePath(p: string): string {
  const slashed = p.trim().replace(/\\/g, "/");
  const segments = slashed
    .split("/")
    .filter((seg) => seg.length > 0 && seg !== ".");
  return segments.join("/");
}

export function buildPlanFileContract(
  plan: PlanContractInput | undefined,
): PlanFileContract {
  const explicit = parseExplicitContract(plan?.file_contract);
  if (explicit) return explicit;

  // Legacy path: plan.files -> medium-confidence required_target. Legacy
  // entries are never high confidence, so they never become strict-failure
  // eligible (spec §4.2 / §5 D4).
  const requiredTargetFiles = dedupeEntries(
    (plan?.files ?? []).map((raw) => ({
      path: normalizePath(raw),
      role: "required_target" as const,
      confidence: "medium" as const,
      source: "legacy_files" as const,
    })),
  );

  return {
    requiredTargetFiles,
    optionalTargetFiles: [],
    contextFiles: [],
    version: "legacy",
  };
}

function dedupeEntries(entries: PlanFileContractEntry[]): PlanFileContractEntry[] {
  const seen = new Set<string>();
  const out: PlanFileContractEntry[] = [];
  for (const entry of entries) {
    if (entry.path.length === 0 || seen.has(entry.path)) continue;
    seen.add(entry.path);
    out.push(entry);
  }
  return out;
}

// Parse an explicit v2 contract object. Returns null when the input is absent
// or malformed, so the caller falls back to the legacy adapter.
function parseExplicitContract(raw: unknown): PlanFileContract | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const required = parseEntryList(obj["requiredTargetFiles"], "required_target");
  const optional = parseEntryList(obj["optionalTargetFiles"], "optional_target");
  const context = parseEntryList(obj["contextFiles"], "context");
  if (required.length === 0 && optional.length === 0 && context.length === 0) {
    return null;
  }

  // Duplicate paths resolve by role precedence: required > optional > context.
  const claimed = new Set<string>();
  const take = (entries: PlanFileContractEntry[]): PlanFileContractEntry[] => {
    const out: PlanFileContractEntry[] = [];
    for (const entry of entries) {
      if (entry.path.length === 0 || claimed.has(entry.path)) continue;
      claimed.add(entry.path);
      out.push(entry);
    }
    return out;
  };

  return {
    requiredTargetFiles: take(required),
    optionalTargetFiles: take(optional),
    contextFiles: take(context),
    version: "v2",
  };
}

function parseEntryList(raw: unknown, role: PlanFileRole): PlanFileContractEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanFileContractEntry[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      out.push({ path: normalizePath(item), role, confidence: "medium", source: "explicit_v2" });
      continue;
    }
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const rawPath = rec["path"];
      if (typeof rawPath !== "string") continue;
      const confidence = rec["confidence"];
      out.push({
        path: normalizePath(rawPath),
        role,
        confidence:
          confidence === "high" || confidence === "low" ? confidence : "medium",
        source: "explicit_v2",
      });
    }
  }
  return out;
}
