import type { VerifyAssertion, VerifyRunResult } from "../verifier.js";

export interface DeterministicRepair {
  content: string;
  files: string[];
  hints: string[];
}

interface BuildDeterministicAssertionRepairArgs {
  cwd: string;
  assertions: VerifyAssertion[];
  results: VerifyRunResult[];
}

type DeterministicAssertionRepairRule = (
  args: BuildDeterministicAssertionRepairArgs,
) => DeterministicRepair | null;

// Code-result repair rules are intentionally not registered by default.
// They let the system synthesize source-code changes after verification
// failures, which is outside DSH's orchestration boundary.
const DETERMINISTIC_ASSERTION_REPAIR_RULES: DeterministicAssertionRepairRule[] = [];

export function buildDeterministicAssertionRepair(
  args: BuildDeterministicAssertionRepairArgs,
): DeterministicRepair | null {
  for (const rule of DETERMINISTIC_ASSERTION_REPAIR_RULES) {
    const repair = rule(args);
    if (repair) return repair;
  }
  return null;
}
