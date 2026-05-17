import type { DeepSeekReasoningEffort } from "./client.js";

export interface DeepSeekModelCapability {
  model: string;
  thinking: boolean;
  reasoningEffort: DeepSeekReasoningEffort[];
  toolCalls: boolean;
  jsonOutput: boolean;
  strictToolCalls: "experimental";
  chatPrefix: "experimental";
  fim: boolean | "experimental";
  contextCache: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
  deprecated?: boolean;
  notes: string[];
}

export const DEEPSEEK_CAPABILITY_REGISTRY: Record<string, DeepSeekModelCapability> = {
  "deepseek-v4-pro": {
    model: "deepseek-v4-pro",
    thinking: true,
    reasoningEffort: ["high", "max"],
    toolCalls: true,
    jsonOutput: true,
    strictToolCalls: "experimental",
    chatPrefix: "experimental",
    fim: "experimental",
    contextCache: true,
    maxContextTokens: 1_048_576,
    maxOutputTokens: 393_216,
    notes: [
      "Default high-reasoning model for planning, repair, and larger patches.",
      "Beta features require explicit feature flags and beta base URL.",
    ],
  },
  "deepseek-v4-flash": {
    model: "deepseek-v4-flash",
    thinking: true,
    reasoningEffort: ["high", "max"],
    toolCalls: true,
    jsonOutput: true,
    strictToolCalls: "experimental",
    chatPrefix: "experimental",
    fim: false,
    contextCache: true,
    maxContextTokens: 1_048_576,
    maxOutputTokens: 393_216,
    notes: [
      "Default low-latency model for smaller patches, verify-adjacent reporting, and handoff.",
      "FIM is kept disabled until validated against the beta endpoint for this model.",
    ],
  },
  "deepseek-chat": {
    model: "deepseek-chat",
    thinking: false,
    reasoningEffort: [],
    toolCalls: true,
    jsonOutput: true,
    strictToolCalls: "experimental",
    chatPrefix: "experimental",
    fim: false,
    contextCache: true,
    maxContextTokens: 1_048_576,
    maxOutputTokens: 393_216,
    deprecated: true,
    notes: ["Legacy alias scheduled for deprecation by DeepSeek; prefer deepseek-v4-flash."],
  },
  "deepseek-reasoner": {
    model: "deepseek-reasoner",
    thinking: true,
    reasoningEffort: ["high", "max"],
    toolCalls: true,
    jsonOutput: true,
    strictToolCalls: "experimental",
    chatPrefix: "experimental",
    fim: false,
    contextCache: true,
    maxContextTokens: 1_048_576,
    maxOutputTokens: 393_216,
    deprecated: true,
    notes: ["Legacy alias scheduled for deprecation by DeepSeek; prefer deepseek-v4-pro."],
  },
};

export function getDeepSeekCapability(model: string): DeepSeekModelCapability | null {
  return DEEPSEEK_CAPABILITY_REGISTRY[model] ?? null;
}
