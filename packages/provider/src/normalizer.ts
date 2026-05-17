import type { DeepSeekResponse, DeepSeekStreamChunk, DeepSeekToolCall, DeepSeekUsage } from "./client.js";

export interface NormalizedResponse {
  message: NormalizedMessage;
  content: string;
  thinkingContent: string | null;
  toolCalls: DeepSeekToolCall[];
  usage: NormalizedUsage;
  finishReason: string | null;
}

export interface NormalizedMessage {
  content: string;
  reasoningContent: string | null;
  toolCalls: DeepSeekToolCall[];
}

export interface NormalizedStreamDelta {
  content: string;
  reasoningContent: string;
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

export function extractToolCalls(res: DeepSeekResponse): DeepSeekToolCall[] {
  return res.choices[0]?.message.tool_calls ?? [];
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
  const message = normalizeMessage(res);
  return {
    message,
    content: message.content,
    thinkingContent: message.reasoningContent,
    toolCalls: message.toolCalls,
    usage: normalizeUsage(res.usage),
    finishReason: res.choices[0]?.finish_reason ?? null,
  };
}

export function normalizeMessage(res: DeepSeekResponse): NormalizedMessage {
  return {
    content: extractTextContent(res),
    reasoningContent: extractThinkingContent(res),
    toolCalls: extractToolCalls(res),
  };
}

export function normalizeStreamDelta(chunk: DeepSeekStreamChunk): NormalizedStreamDelta {
  const choice = chunk.choices[0];
  return {
    content: choice?.delta?.content ?? "",
    reasoningContent: choice?.delta?.reasoning_content ?? "",
    finishReason: choice?.finish_reason ?? null,
  };
}
