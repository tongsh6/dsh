export { DeepSeekClient, DeepSeekError } from "./client.js";
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
} from "./client.js";

export { classify } from "./router.js";
export type { RouteTarget, ClassifyInput, CommandName } from "./router.js";

export {
  extractTextContent,
  extractThinkingContent,
  normalizeUsage,
  normalizeResponse,
} from "./normalizer.js";
export type { NormalizedResponse } from "./normalizer.js";
