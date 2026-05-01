export {
  createTaskState,
  readTaskState,
  writeTaskState,
  transition,
  canTransition,
  taskStateSchema,
} from "./task-state.js";
export type { TaskState, TaskStatus, VerifyResult, PatchRecord } from "./task-state.js";

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
  applyCreates,
  applyDeletes,
  applySearchReplace,
  applyPatch,
  applyChanges,
  PatchParseError,
} from "./patch-parser.js";
export type {
  ParsedPatch,
  HunkInfo,
  CreateBlock,
  SearchReplaceBlock,
  RenameBlock,
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

export { writeHandoff } from "./handoff-writer.js";

export {
  runPlan,
  runPatch,
  runVerify,
  runRepair,
  runHandoff,
  runFullPipeline,
} from "./pipeline.js";
export type {
  PlanParams,
  PatchParams,
  VerifyParams,
  RepairParams,
  HandoffParams,
  FullPipelineParams,
  PipelineBase,
} from "./pipeline.js";
