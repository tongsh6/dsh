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
