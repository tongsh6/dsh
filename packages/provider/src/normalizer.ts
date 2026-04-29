import type { DeepSeekResponse, DeepSeekUsage } from "./client.js";

export interface NormalizedResponse {
  content: string;
  thinkingContent: string | null;
  usage: {
    prompt: number;
    completion: number;
    total: number;
    reasoning: number;
  };
  finishReason: string | null;
}

export function extractTextContent(res: DeepSeekResponse): string {
  return res.choices[0]?.message.content ?? "";
}

export function extractThinkingContent(res: DeepSeekResponse): string | null {
  return res.choices[0]?.message.reasoning_content ?? null;
}

export function normalizeUsage(usage: DeepSeekUsage): NormalizedResponse["usage"] {
  return {
    prompt: usage.prompt_tokens,
    completion: usage.completion_tokens,
    total: usage.total_tokens,
    reasoning: usage.reasoning_tokens ?? 0,
  };
}

export function normalizeResponse(res: DeepSeekResponse): NormalizedResponse {
  return {
    content: extractTextContent(res),
    thinkingContent: extractThinkingContent(res),
    usage: normalizeUsage(res.usage),
    finishReason: res.choices[0]?.finish_reason ?? null,
  };
}
