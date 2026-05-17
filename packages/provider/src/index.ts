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
  extractTextContent,
  extractThinkingContent,
  normalizeUsage,
  normalizeResponse,
} from "./normalizer.js";
export type { NormalizedResponse, NormalizedUsage } from "./normalizer.js";
