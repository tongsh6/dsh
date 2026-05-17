export {
  loadFixture,
  loadAllFixtures,
  PROTOCOL_OP_SCHEMA,
} from "./task-fixtures.js";
export type { TaskFixture, LoadedFixture, ProtocolOp } from "./task-fixtures.js";

export {
  auditFixtureContamination,
  auditFixtureMetadata,
  auditFixtureVerificationCoverage,
  auditFixturesForContamination,
  auditFixturesForMetadata,
  auditFixturesForVerificationCoverage,
} from "./fixture-audit.js";
export type {
  FixtureAuditFinding,
  FixtureAuditRuleId,
  FixtureAuditSeverity,
} from "./fixture-audit.js";

export {
  createEmptyResult,
  scoreResult,
  compareResults,
  formatComparisonReport,
  runTask,
  runAll,
  formatEvaluationReport,
} from "./benchmark-runner.js";
export type { TaskResult, ComparisonReport } from "./benchmark-runner.js";

export {
  EVIDENCE_POLICIES,
  FAILURE_TYPES,
  FAILURE_STATUSES,
  FailureMatrixEntrySchema,
  FailureMatrixSchema,
  defaultFailureMatrixPath,
  loadFailureMatrix,
  selectFailureMatrixFixtureGovernance,
  summarizeFailureMatrix,
} from "./failure-matrix.js";
export type {
  FailureType,
  FailureStatus,
  EvidencePolicy,
  FailureMatrixEntry,
  FailureMatrix,
  FailureMatrixSummary,
  FailureMatrixFixtureGovernance,
} from "./failure-matrix.js";
