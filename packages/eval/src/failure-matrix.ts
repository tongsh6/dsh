import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const FAILURE_TYPES = [
  "plan_overlisting",
  "missing_file_modification",
  "wrong_verification_command",
  "tool_overuse",
  "done_too_early",
  "patch_apply_failure",
  "compile_error",
  "semantic_incorrect",
  "environment_setup",
  "fixture_false_positive",
  "context_missing",
  "project_detection_error",
  "repair_loop_drift",
  "high_variance",
  "unknown",
] as const;

export const FAILURE_STATUSES = [
  "known_hard_fail",
  "single_smoke_passed",
  "pending_replication",
  "confirmed_stable",
  "regressed",
  "fixed",
  "ignored",
  "unknown",
] as const;

export const EVIDENCE_POLICIES = [
  "standard",
  "label_required",
  "exclude_from_phase3_exit",
] as const;

export const FailureMatrixEntrySchema = z.object({
  fixture: z.string().min(1),
  repo: z.string().min(1),
  failureType: z.enum(FAILURE_TYPES),
  status: z.enum(FAILURE_STATUSES),
  requiresReplicatedConfirmation: z.boolean(),
  lastEvidence: z.string().min(1),
  notes: z.string().min(1),
  governance: z.object({
    comparabilityRisk: z.boolean().optional(),
    evidencePolicy: z.enum(EVIDENCE_POLICIES).optional(),
    contamination: z.enum([
      "neutralized_prompt_contamination",
      "historical_evidence_contaminated",
    ]).optional(),
    notes: z.string().min(1).optional(),
  }).optional(),
}).superRefine((entry, ctx) => {
  if (
    entry.governance?.comparabilityRisk === true &&
    entry.governance.evidencePolicy !== "label_required"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["governance", "evidencePolicy"],
      message:
        "comparability risk entries must use evidencePolicy=\"label_required\"",
    });
  }

  if (
    entry.governance?.contamination &&
    entry.governance.evidencePolicy !== "exclude_from_phase3_exit"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["governance", "evidencePolicy"],
      message:
        "contaminated historical evidence must use evidencePolicy=\"exclude_from_phase3_exit\"",
    });
  }
});

export const FailureMatrixSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(FailureMatrixEntrySchema).min(1),
});

export type FailureType = (typeof FAILURE_TYPES)[number];
export type FailureStatus = (typeof FAILURE_STATUSES)[number];
export type EvidencePolicy = (typeof EVIDENCE_POLICIES)[number];
export type FailureMatrixEntry = z.infer<typeof FailureMatrixEntrySchema>;
export type FailureMatrix = z.infer<typeof FailureMatrixSchema>;

export interface FailureMatrixSummary {
  total: number;
  knownHardFail: number;
  fixedPendingReplication: number;
  highVariance: number;
  confirmedStable: number;
  regressed: number;
  comparabilityRisk: number;
  labelRequired: number;
  phase3ExitExcluded: number;
}

export interface FailureMatrixFixtureGovernance {
  fixture: string;
  repo: string;
  failureType: FailureType;
  status: FailureStatus;
  requiresReplicatedConfirmation: boolean;
  evidencePolicy: EvidencePolicy;
  comparabilityRisk: boolean;
  contamination?: "neutralized_prompt_contamination" | "historical_evidence_contaminated";
  lastEvidence: string;
  notes: string;
  governanceNotes?: string;
}

export function defaultFailureMatrixPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/failure-matrix.json");
}

export function loadFailureMatrix(filePath = defaultFailureMatrixPath()): FailureMatrix {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  return FailureMatrixSchema.parse(raw);
}

export function summarizeFailureMatrix(matrix: FailureMatrix): FailureMatrixSummary {
  return {
    total: matrix.entries.length,
    knownHardFail: matrix.entries.filter((e) => e.status === "known_hard_fail").length,
    fixedPendingReplication: matrix.entries.filter((e) =>
      e.requiresReplicatedConfirmation &&
      (e.status === "single_smoke_passed" || e.status === "fixed" || e.status === "pending_replication")
    ).length,
    highVariance: matrix.entries.filter((e) => e.failureType === "high_variance" || e.status === "pending_replication").length,
    confirmedStable: matrix.entries.filter((e) => e.status === "confirmed_stable").length,
    regressed: matrix.entries.filter((e) => e.status === "regressed").length,
    comparabilityRisk: matrix.entries.filter((e) => e.governance?.comparabilityRisk === true).length,
    labelRequired: matrix.entries.filter((e) => e.governance?.evidencePolicy === "label_required").length,
    phase3ExitExcluded: matrix.entries.filter((e) => e.governance?.evidencePolicy === "exclude_from_phase3_exit").length,
  };
}

export function selectFailureMatrixFixtureGovernance(
  matrix: FailureMatrix,
  fixtureIds: readonly string[],
): FailureMatrixFixtureGovernance[] {
  const entriesByFixture = new Map(matrix.entries.map((entry) => [entry.fixture, entry]));
  const seen = new Set<string>();
  const selected: FailureMatrixFixtureGovernance[] = [];

  for (const fixtureId of fixtureIds) {
    if (seen.has(fixtureId)) continue;
    seen.add(fixtureId);

    const entry = entriesByFixture.get(fixtureId);
    if (!entry) continue;

    selected.push({
      fixture: entry.fixture,
      repo: entry.repo,
      failureType: entry.failureType,
      status: entry.status,
      requiresReplicatedConfirmation: entry.requiresReplicatedConfirmation,
      evidencePolicy: entry.governance?.evidencePolicy ?? "standard",
      comparabilityRisk: entry.governance?.comparabilityRisk === true,
      contamination: entry.governance?.contamination,
      lastEvidence: entry.lastEvidence,
      notes: entry.notes,
      governanceNotes: entry.governance?.notes,
    });
  }

  return selected;
}
