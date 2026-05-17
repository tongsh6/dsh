import type { LoadedFixture, TaskFixture } from "./task-fixtures.js";

export type FixtureAuditSeverity = "strict_contamination" | "comparability_risk";

export type FixtureAuditRuleId =
  | "literal_implementation_snippet"
  | "failure_specific_workaround_phrase"
  | "dsh_protocol_coaching"
  | "scope_or_comparability_risk";

export interface FixtureAuditFinding {
  fixtureId: string;
  ruleId: FixtureAuditRuleId;
  severity: FixtureAuditSeverity;
  message: string;
  evidence: string;
}

const COMPARABILITY_RISK_FIXTURES = new Set([
  "rh-refactor-branch-orchestrator-create",
  "rh-refactor-branch-orchestrator-tests",
  "rh-refactor-branch-orchestrator-service-code-merge",
  "rh-refactor-branch-orchestrator-service-release-branch",
  "rh-refactor-branch-orchestrator-service-attach",
  "rh-test-dashboard-version",
]);

const IMPLEMENTATION_SNIPPET_PATTERNS: RegExp[] = [
  /re\.findall\(\s*r['"]\^\\s\*/i,
  /\bimport\s+re\b/i,
];

const FAILURE_WORKAROUND_PATTERNS: RegExp[] = [
  /不要(?:使用|用)\s+@InjectMocks/i,
  /避免\s+(?:NPE|NullPointerException)/i,
  /NoSuchMethodError/i,
  /known\s+failure/i,
  /已知[\s\S]{0,40}失败/,
];

const PROTOCOL_COACHING_PATTERNS: RegExp[] = [
  /只能对[\s\S]{0,140}\bCREATE\b/i,
  /必须用[\s\S]{0,80}\b(?:PATCH|SEARCH\/REPLACE)\b/i,
  /禁止用[\s\S]{0,80}(?:短锚点|很短锚点|import 行)[\s\S]{0,80}整份/i,
];

function findEvidence(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[0]) continue;
    return match[0].replace(/\s+/g, " ").trim();
  }
  return null;
}

export function auditFixtureContamination(
  fixture: Pick<TaskFixture, "id" | "taskPrompt">,
): FixtureAuditFinding[] {
  const findings: FixtureAuditFinding[] = [];

  const implementationEvidence = findEvidence(
    fixture.taskPrompt,
    IMPLEMENTATION_SNIPPET_PATTERNS,
  );
  if (implementationEvidence) {
    findings.push({
      fixtureId: fixture.id,
      ruleId: "literal_implementation_snippet",
      severity: "strict_contamination",
      message: "Task prompt appears to include a concrete implementation answer.",
      evidence: implementationEvidence,
    });
  }

  const workaroundEvidence = findEvidence(
    fixture.taskPrompt,
    FAILURE_WORKAROUND_PATTERNS,
  );
  if (workaroundEvidence) {
    findings.push({
      fixtureId: fixture.id,
      ruleId: "failure_specific_workaround_phrase",
      severity: "strict_contamination",
      message: "Task prompt appears to include a failure-specific workaround.",
      evidence: workaroundEvidence,
    });
  }

  const protocolEvidence = findEvidence(
    fixture.taskPrompt,
    PROTOCOL_COACHING_PATTERNS,
  );
  if (protocolEvidence) {
    findings.push({
      fixtureId: fixture.id,
      ruleId: "dsh_protocol_coaching",
      severity: "strict_contamination",
      message: "Task prompt appears to coach DSH patch protocol behavior.",
      evidence: protocolEvidence,
    });
  }

  if (COMPARABILITY_RISK_FIXTURES.has(fixture.id)) {
    findings.push({
      fixtureId: fixture.id,
      ruleId: "scope_or_comparability_risk",
      severity: "comparability_risk",
      message: "Fixture requires explicit reporting labels before Phase 3 exit evidence use.",
      evidence: fixture.id,
    });
  }

  return findings;
}

export function auditFixturesForContamination(
  fixtures: Array<Pick<LoadedFixture, "id" | "taskPrompt">>,
): FixtureAuditFinding[] {
  return fixtures.flatMap((fixture) => auditFixtureContamination(fixture));
}
