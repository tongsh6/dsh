export {
  detectTechStack,
  detectVerifyCommands,
  generateRepoContext,
} from "./scanner.js";
export type { TechStack, SubModule, VerifyCommands, RepoContext } from "./scanner.js";

export {
  findRuleFiles,
  loadRuleFiles,
  loadRuleContents,
} from "./rule-loader.js";
export type { RuleFile } from "./rule-loader.js";

export {
  rankFiles,
  loadTopFiles,
  scanProjectFiles,
} from "./file-ranker.js";
export type { RankedFile } from "./file-ranker.js";

export {
  getRecentLog,
  getRecentCommits,
  getChangedFiles,
  getCurrentBranch,
  getLastCommitHash,
  getBaseBranch,
  getGitInfo,
} from "./git.js";
export type { GitInfo } from "./git.js";

export {
  findDshRoot,
  loadDshConfig,
  writeDshConfig,
  readApiKey,
  mergeConfig,
} from "./config-loader.js";
export type { DshConfig } from "./config-loader.js";

// Project Intelligence Engine (BLUEPRINT §2.6 Phase 1)
export {
  collectFacts,
  generateLanguageCandidates,
  generateBuildSystemCandidates,
  decide,
  deriveCapabilities,
  assembleIntelligence,
  toProjectCard,
  toLegacyTechStack,
  DEFAULT_POLICY,
} from "./intelligence.js";
export type {
  ProjectFact,
  Candidate,
  DecisionMode,
  ProjectDecision,
  CapabilityStatus,
  ProjectCapability,
  DecisionPolicy,
  ProjectIntelligence,
} from "./intelligence.js";
