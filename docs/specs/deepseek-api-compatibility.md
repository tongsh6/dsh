# DeepSeek API Compatibility

DSH uses a DeepSeek-oriented HTTP provider instead of assuming OpenAI SDK URL semantics.

## Compatibility Matrix

| API Feature | Status | Notes |
|---|---|---|
| Chat Completion | supported | Uses official `/chat/completions` by default. Legacy `/v1/chat/completions` is opt-in via `endpointMode: "openai-compatible-v1"`. |
| Streaming | supported | Parses SSE chunks, including `delta.content` and `delta.reasoning_content`. |
| Thinking Mode | supported | Sends `thinking.type` plus `reasoning_effort` (`high` or `max`). |
| Tool Calls | supported | Uses staged tool policy: plan/patch read-only, repair/preflight may use `exec_shell`, verify/handoff no model tools. |
| Thinking + Tool Calls | supported | Assistant tool-call messages retain `reasoning_content`; tool results are appended with matching `tool_call_id`. |
| JSON Output | supported | `responseFormat: { type: "json_object" }` maps to `response_format`. Patch protocol remains XML/search-replace oriented. |
| Strict Tool Calls | experimental | Disabled by default; requires `featureFlags.strictToolCalls=true`, `betaBaseUrl`, and strict-compatible schemas. |
| Chat Prefix | experimental | Disabled by default; requires `featureFlags.chatPrefix=true` and `betaBaseUrl`. |
| FIM | experimental | Separate `fim()` client method using `/completions`; disabled unless `featureFlags.fim=true`. |
| `user_id` | supported behind flag | Disabled by default; requires `featureFlags.userId=true` and an explicit safe identifier. |
| Context Cache | observed | Records prompt/cache hit/cache miss/hit ratio/completion/reasoning/total per model call. |
| Anthropic-compatible API | not planned | Not needed for the current DeepSeek-native harness. |

## Request Semantics

Default base URL:

```ts
const DEFAULT_BASE_URL = "https://api.deepseek.com";
```

Default chat endpoint:

```text
https://api.deepseek.com/chat/completions
```

Thinking request body:

```json
{
  "thinking": { "type": "enabled" },
  "reasoning_effort": "high"
}
```

When thinking is enabled, the provider removes sampling fields that can interfere with reasoning:

```text
temperature, top_p, presence_penalty, frequency_penalty, logprobs, top_logprobs
```

## Usage Normalization

DSH normalizes DeepSeek usage into:

```ts
{
  prompt,
  completion,
  total,
  reasoning,
  cacheHit,
  cacheMiss,
  cacheHitRatio
}
```

`reasoning` is read from `completion_tokens_details.reasoning_tokens`. Cache hit ratio is computed from `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`.
