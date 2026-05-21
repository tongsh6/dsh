// PatchCoverageValidator — deterministic coverage check for the patch state
// machine. The only inputs are a PlanFileContract and the list of files that
// were *actually applied*; the model's self-reported coverage is never trusted.
// See spec docs/specs/2026-05-19-patch-pipeline-coverage-state-machine.md §4.2.

import type { PlanFileContract } from "./plan-file-contract.js";
import { normalizePath } from "./plan-file-contract.js";

export interface PatchCoverageValidation {
  fullRequiredCoverage: boolean;
  coveredRequiredFiles: string[];
  missingRequiredFiles: string[];
  coveredOptionalFiles: string[];
  missingOptionalFiles: string[];
  touchedContextFiles: string[];
  // True only when every required entry is an explicit_v2 high-confidence
  // target. Legacy contracts are never eligible, so a strict hard gate cannot
  // fire on them (spec §4.9 / §5 D4).
  strictFailureEligible: boolean;
}

function normalizeAppliedChangedFiles(files: string[]): string[] {
  const normalized: string[] = [];
  for (const file of files) {
    const renameMatch = file.match(/^\s*(.+?)\s+->\s+(.+?)\s*$/);
    const paths = renameMatch ? [renameMatch[1], renameMatch[2]] : [file];
    for (const p of paths) {
      const path = normalizePath(p);
      if (path.length > 0) normalized.push(path);
    }
  }
  return normalized;
}

// `appliedChangedFiles` must already be the set of files an apply step changed
// for real — parsed-but-not-applied changes and no-op applies must be excluded
// by the caller before reaching this validator (spec §4.2 rules 1-3).
export function validatePatchCoverage(args: {
  contract: PlanFileContract;
  appliedChangedFiles: string[];
}): PatchCoverageValidation {
  const applied = new Set(normalizeAppliedChangedFiles(args.appliedChangedFiles));

  const required = args.contract.requiredTargetFiles.map((e) => e.path);
  const optional = args.contract.optionalTargetFiles.map((e) => e.path);
  const context = args.contract.contextFiles.map((e) => e.path);

  const coveredRequiredFiles = required.filter((p) => applied.has(p));
  const missingRequiredFiles = required.filter((p) => !applied.has(p));

  const strictFailureEligible =
    args.contract.requiredTargetFiles.length > 0 &&
    args.contract.requiredTargetFiles.every(
      (e) => e.source === "explicit_v2" && e.confidence === "high",
    );

  return {
    fullRequiredCoverage: missingRequiredFiles.length === 0,
    coveredRequiredFiles,
    missingRequiredFiles,
    coveredOptionalFiles: optional.filter((p) => applied.has(p)),
    missingOptionalFiles: optional.filter((p) => !applied.has(p)),
    touchedContextFiles: context.filter((p) => applied.has(p)),
    strictFailureEligible,
  };
}

// Coverage progress for one explore round: which required files this round's
// applied changes newly covered. A change is real progress ONLY when it covers
// a previously-missing required file — re-editing an already-covered file,
// or touching an optional / context / off-plan file, yields an empty delta.
export function computeCoverageDelta(
  appliedChangedFiles: string[],
  missingRequiredFiles: ReadonlySet<string>,
): Set<string> {
  const delta = new Set<string>();
  for (const normalized of normalizeAppliedChangedFiles(appliedChangedFiles)) {
    if (missingRequiredFiles.has(normalized)) {
      delta.add(normalized);
    }
  }
  return delta;
}
