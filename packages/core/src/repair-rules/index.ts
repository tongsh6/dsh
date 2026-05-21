import type { VerifyAssertion, VerifyRunResult } from "../verifier.js";
import {
  buildTypescriptNamedImportRepair,
  type DeterministicRepair,
} from "./typescript-named-import.js";

interface BuildDeterministicAssertionRepairArgs {
  cwd: string;
  assertions: VerifyAssertion[];
  results: VerifyRunResult[];
}

const DETERMINISTIC_ASSERTION_REPAIR_RULES = [
  buildTypescriptNamedImportRepair,
];

export function buildDeterministicAssertionRepair(
  args: BuildDeterministicAssertionRepairArgs,
): DeterministicRepair | null {
  for (const rule of DETERMINISTIC_ASSERTION_REPAIR_RULES) {
    const repair = rule(args);
    if (repair) return repair;
  }
  return null;
}
