import type { DeepSeekResponse, DeepSeekUsage } from "./client.js";

export interface NormalizedResponse {
  content: string;
  thinkingContent: string | null;
  usage: NormalizedUsage;
  finishReason: string | null;
}

export interface NormalizedUsage {
  prompt: number;
  completion: number;
  total: number;
  cacheHit: number;
  cacheMiss: number;
  reasoning: number;
  cacheHitRatio: number;
}

export function extractTextContent(res: DeepSeekResponse): string {
  return res.choices[0]?.message.content ?? "";
}

export function extractThinkingContent(res: DeepSeekResponse): string | null {
  return res.choices[0]?.message.reasoning_content ?? null;
}

export function normalizeUsage(usage?: DeepSeekUsage): NormalizedUsage {
  const cacheHit = usage?.prompt_cache_hit_tokens ?? 0;
  const cacheMiss = usage?.prompt_cache_miss_tokens ?? 0;
  const cacheTotal = cacheHit + cacheMiss;

  return {
    prompt: usage?.prompt_tokens ?? 0,
    completion: usage?.completion_tokens ?? 0,
    total: usage?.total_tokens ?? 0,
    cacheHit,
    cacheMiss,
    reasoning: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    cacheHitRatio: cacheTotal > 0 ? cacheHit / cacheTotal : 0,
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
