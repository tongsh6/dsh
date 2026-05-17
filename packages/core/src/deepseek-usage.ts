import type { DeepSeekResponse } from "@dsh/provider";
import type { TaskState } from "./task-state.js";

export function recordDeepSeekUsage(
  state: TaskState,
  params: {
    phase: string;
    model: string;
    thinking: boolean;
    durationMs: number;
    response: DeepSeekResponse;
  },
): void {
  const rawUsage = (params.response.usage ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
  const cacheHit = rawUsage.prompt_cache_hit_tokens ?? 0;
  const cacheMiss = rawUsage.prompt_cache_miss_tokens ?? 0;
  const cacheTotal = cacheHit + cacheMiss;
  state.deepseek_usage.push({
    phase: params.phase,
    model: params.model,
    thinking: params.thinking,
    duration_ms: params.durationMs,
    prompt: rawUsage.prompt_tokens ?? 0,
    completion: rawUsage.completion_tokens ?? 0,
    total: rawUsage.total_tokens ?? 0,
    reasoning: rawUsage.completion_tokens_details?.reasoning_tokens ?? 0,
    cache_hit: cacheHit,
    cache_miss: cacheMiss,
    cache_hit_ratio: cacheTotal > 0 ? cacheHit / cacheTotal : 0,
  });
}
