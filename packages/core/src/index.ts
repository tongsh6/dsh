export {
  createTaskState,
  readTaskState,
  writeTaskState,
  transition,
  canTransition,
  taskStateSchema,
} from "./task-state.js";
export type {
  TaskState,
  TaskStatus,
  VerifyResult,
  PatchRecord,
  PatchRoundRecord,
  ToolCallRecord,
  ToolRoundRecord,
  StaticScanFinding,
  StaticScanRun,
  StaticRepairResult,
} from "./task-state.js";

export {
  buildBaseContext,
  buildRepoContext,
  buildTaskContext,
  buildDynamicContext,
  assembleContext,
} from "./context-builder.js";
export type { ContextLayers, ContextInput } from "./context-builder.js";

export {
  buildSystemPrompt,
  buildUserMessage,
  buildMessages,
  estimateTokens,
} from "./prompt-builder.js";
export type { PromptConfig, PromptPhase } from "./prompt-builder.js";

export {
  extractPatchBlock,
  extractCreateBlocks,
  extractDeleteBlocks,
  extractRenameBlocks,
  extractSearchReplaceBlocks,
  extractFilesBlock,
  extractVerifyBlock,
  extractPlanBlock,
  extractRisksBlock,
  validateDiff,
  validateCreatePaths,
  validateRenamePaths,
  detectCreatePatchConflicts,
  parseHunks,
  parsePatch,
  parseChanges,
  parsePatchTurn,
  applyCreates,
  applyDeletes,
  applySearchReplace,
  extractInsertBlocks,
  applyInserts,
  applyPatch,
  applyChanges,
  detectProtocolOps,
  detectProtocolOpsFromText,
  PatchParseError,
} from "./patch-parser.js";
export type {
  ProtocolOp,
  ParsedPatch,
  HunkInfo,
  CreateBlock,
  SearchReplaceBlock,
  InsertBlock,
  RenameBlock,
  ChangeBlock,
  PatchTurnAction,
  ParsedChanges,
  ApplyChangesResult,
} from "./patch-parser.js";

export {
  runCommand,
  isAllPassed,
  formatResults,
  summarizeResults,
} from "./verifier.js";
export type { VerifyRunResult } from "./verifier.js";

export { runRepairLoop } from "./repair-loop.js";
export type { RepairConfig, RepairRoundResult } from "./repair-loop.js";

export { detectFailures, buildRepairHints } from "./failure-detector.js";
export type { FailureDetection, DetectParams } from "./failure-detector.js";

export {
  parseStaticScanFindings,
  repairStaticScanTopN,
  resolveStaticScanConfig,
  runStaticScan,
} from "./static-scanner.js";
export type { StaticScanConfig, StaticScanResult } from "./static-scanner.js";

export {
  selectTopFindings,
  scoreFindings,
  resolveTopNConfig,
  buildReason,
  formatScoredFindings,
} from "./static-topn.js";
export type {
  TopNWeights,
  TopNConfig,
  DimensionScore,
  ScoredFinding,
} from "./static-topn.js";

export {
  eslintParser,
  tscParser,
  sarifParser,
  fallbackParser,
  resolveParser,
  parseFindings,
} from "./static-finding-parser.js";
export type { StaticFindingParser } from "./static-finding-parser.js";

export { writeHandoff } from "./handoff-writer.js";

export {
  runPlan,
  runPatch,
  runVerify,
  runRepair,
  runHandoff,
  runFullPipeline,
  runPreflight,
} from "./pipeline.js";
export { injectCardContext } from "./inject-card-context.js";
export type {
  PlanParams,
  PatchParams,
  VerifyParams,
  RepairParams,
  HandoffParams,
  FullPipelineParams,
  PreflightParams,
  PipelineBase,
} from "./pipeline.js";

export {
  READ_FILE_DEF,
  GREP_FILES_DEF,
  EXEC_SHELL_DEF,
  ALL_TOOL_DEFINITIONS,
  EXEC_SHELL_ALLOW_LIST,
  EXEC_SHELL_BLOCK_PATTERNS,
} from "./tool-definitions.js";
export type {
  ToolName,
  ToolCall,
  ToolResult,
  ToolDefinition,
} from "./tool-definitions.js";

export {
  executeTool,
  isShellAllowed,
  formatToolResult,
} from "./tool-executor.js";
