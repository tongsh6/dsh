export {
  loadFixture,
  loadAllFixtures,
  PROTOCOL_OP_SCHEMA,
} from "./task-fixtures.js";
export type { TaskFixture, LoadedFixture, ProtocolOp } from "./task-fixtures.js";

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
  FAILURE_TYPES,
  FAILURE_STATUSES,
  FailureMatrixEntrySchema,
  FailureMatrixSchema,
  defaultFailureMatrixPath,
  loadFailureMatrix,
  summarizeFailureMatrix,
} from "./failure-matrix.js";
export type {
  FailureType,
  FailureStatus,
  FailureMatrixEntry,
  FailureMatrix,
  FailureMatrixSummary,
} from "./failure-matrix.js";
