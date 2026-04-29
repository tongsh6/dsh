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
export type { PromptConfig } from "./prompt-builder.js";

export {
  extractPatchBlock,
  extractFilesBlock,
  extractVerifyBlock,
  extractPlanBlock,
  extractRisksBlock,
  validateDiff,
  parseHunks,
  parsePatch,
  applyPatch,
  PatchParseError,
} from "./patch-parser.js";
export type { ParsedPatch, HunkInfo } from "./patch-parser.js";

export {
  runCommand,
  isAllPassed,
  formatResults,
  summarizeResults,
} from "./verifier.js";
export type { VerifyRunResult } from "./verifier.js";

export { runRepairLoop } from "./repair-loop.js";
export type { RepairConfig, RepairRoundResult } from "./repair-loop.js";

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
