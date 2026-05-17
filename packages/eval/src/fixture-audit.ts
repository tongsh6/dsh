import type { LoadedFixture, TaskFixture, VerifyAssertion } from "./task-fixtures.js";

export type FixtureAuditSeverity =
  | "strict_contamination"
  | "comparability_risk"
  | "verification_gap";

export type FixtureAuditRuleId =
  | "literal_implementation_snippet"
  | "failure_specific_workaround_phrase"
  | "dsh_protocol_coaching"
  | "scope_or_comparability_risk"
  | "expected_file_not_verified";

export interface FixtureAuditFinding {
  fixtureId: string;
  ruleId: FixtureAuditRuleId;
  severity: FixtureAuditSeverity;
  message: string;
  evidence: string;
}

export interface VerificationExtensionCandidate {
  fixtureId: string;
  command: string;
  reason: "non_runner_shell_assertion";
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

function normalizeFixturePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function commandMentionsFile(command: string, expectedFile: string): boolean {
  const normalizedCommand = command.replace(/\\/g, "/");
  const normalizedFile = normalizeFixturePath(expectedFile);
  return normalizedCommand.includes(normalizedFile);
}

function assertionMentionsFile(assertion: VerifyAssertion, expectedFile: string): boolean {
  if (assertion.type === "shell") {
    return commandMentionsFile(assertion.command, expectedFile);
  }
  if (assertion.type === "maven_test") {
    const fileName = normalizeFixturePath(expectedFile).split("/").at(-1) ?? expectedFile;
    const javaClassName = fileName.endsWith(".java") ? fileName.slice(0, -".java".length) : fileName;
    return (assertion.tests ?? "")
      .split(",")
      .map((test) => test.trim())
      .includes(javaClassName);
  }
  if (
    assertion.type === "file_exists" ||
    assertion.type === "file_not_exists" ||
    assertion.type === "file_contains" ||
    assertion.type === "file_not_contains"
  ) {
    return normalizeFixturePath(assertion.file) === normalizeFixturePath(expectedFile);
  }
  return false;
}

export function auditFixtureVerificationCoverage(
  fixture: Pick<TaskFixture, "id" | "expectedFiles" | "verificationCommands" | "verifications">,
): FixtureAuditFinding[] {
  return fixture.expectedFiles
    .filter((expectedFile) => {
      const structuredCovered = (fixture.verifications ?? []).some((assertion) =>
        assertionMentionsFile(assertion, expectedFile),
      );
      const commandCovered = fixture.verificationCommands.some((command) =>
        commandMentionsFile(command, expectedFile),
      );
      return !structuredCovered && !commandCovered;
    })
    .map((expectedFile) => ({
      fixtureId: fixture.id,
      ruleId: "expected_file_not_verified" as const,
      severity: "verification_gap" as const,
      message: "Expected file is not explicitly referenced by any verification assertion or command.",
      evidence: expectedFile,
    }));
}

export function auditFixturesForVerificationCoverage(
  fixtures: Array<Pick<LoadedFixture, "id" | "expectedFiles" | "verificationCommands" | "verifications">>,
): FixtureAuditFinding[] {
  return fixtures.flatMap((fixture) => auditFixtureVerificationCoverage(fixture));
}

const SHELL_RUNNER_PATTERNS: RegExp[] = [
  /^(?:\([^)]*&&\s*)?pnpm\b/,
  /^npx\s+(?:jest|tsc|eslint|markdownlint)\b/,
  /^python3\s+(?:-m\s+pytest|tools\/check_v2_constraints\.py)\b/,
  /^(?:\(\s*)?(?:cd\s+\S+\s+&&\s*)?mvn\s+test\b/,
];

function isRunnerShellCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  return SHELL_RUNNER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function shellCommandsForExtensionReview(
  fixture: Pick<TaskFixture, "verificationCommands" | "verifications">,
): string[] {
  return [
    ...fixture.verificationCommands,
    ...(fixture.verifications ?? [])
      .filter((assertion) => assertion.type === "shell")
      .map((assertion) => assertion.command),
  ];
}

export function collectVerificationExtensionCandidates(
  fixtures: Array<Pick<LoadedFixture, "id" | "verificationCommands" | "verifications">>,
): VerificationExtensionCandidate[] {
  return fixtures.flatMap((fixture) =>
    shellCommandsForExtensionReview(fixture)
      .filter((command) => !isRunnerShellCommand(command))
      .map((command) => ({
        fixtureId: fixture.id,
        command,
        reason: "non_runner_shell_assertion" as const,
      })),
  );
}
