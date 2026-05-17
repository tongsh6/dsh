export { DeepSeekClient, DeepSeekError, DeepSeekApiError } from "./client.js";
export type {
  DeepSeekMessage,
  DeepSeekRequest,
  DeepSeekResponse,
  DeepSeekChoice,
  DeepSeekUsage,
  DeepSeekStreamChunk,
  DeepSeekToolCall,
  DeepSeekToolResultMessage,
  DeepSeekClientConfig,
  DeepSeekEndpointMode,
  DeepSeekFeatureFlags,
  DeepSeekFimRequest,
  DeepSeekFimResponse,
  DeepSeekReasoningEffort,
  DeepSeekRetryOptions,
  DeepSeekTool,
} from "./client.js";

export { classify } from "./router.js";
export type { RouteTarget, ClassifyInput, CommandName, ModelRoutingConfig } from "./router.js";

export {
  DEEPSEEK_CAPABILITY_REGISTRY,
  getDeepSeekCapability,
} from "./capability-registry.js";
export type { DeepSeekModelCapability } from "./capability-registry.js";

export {
  extractTextContent,
  extractThinkingContent,
  extractToolCalls,
  normalizeMessage,
  normalizeUsage,
  normalizeResponse,
  normalizeStreamDelta,
} from "./normalizer.js";
export type {
  NormalizedMessage,
  NormalizedResponse,
  NormalizedStreamDelta,
  NormalizedUsage,
} from "./normalizer.js";
