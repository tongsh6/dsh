# DeepSeek API Compatibility

This document records what DSH actually implements against the DeepSeek API as of 2026-05-17. It is not a claim of complete API coverage.

Official references checked:

- DeepSeek Chat Completion API: `/chat/completions`, V4 Pro/Flash, thinking, JSON output, streaming, tools, cache usage.
- DeepSeek Thinking Mode guide: `thinking.type`, `reasoning_effort`, `reasoning_content`, and thinking plus tool-call carry-forward rules.
- DeepSeek Tool Calls guide: function calling and beta strict tool calls.
- DeepSeek FIM Completion API: beta `/completions`.
- DeepSeek Error Codes: 400/401/402/422 client errors; 429/500/503 retryable server or load errors.
- DeepSeek Change Log: V4 Pro/Flash and legacy alias deprecation timeline.

## L1-L7 Adaptation Matrix

| Layer | Status | Score | Notes |
|---|---:|---:|---|
| L1 API Capability | supported | 8 | Official chat endpoint, thinking, high/max effort, tools, streaming, JSON output, cache/reasoning usage, retry classes, and beta-gated strict/prefix/FIM extension points exist. Anthropic-compatible API is out of scope. |
| L2 Provider Semantics | supported | 8 | Normalizer preserves `content`, `reasoning_content`, `tool_calls`, stream content/reasoning deltas, usage, and API error metadata. Tool arguments are validated instead of silently coerced. |
| L3 Model Behavior | partial | 7 | Patch loop, SEARCH/REPLACE validator, staged tools, stall guards, root-cause repair prompts, rollback, and context partitioning exist. Prefix-based format repair and FIM-backed patch fallback are still experimental. |
| L4 Execution Contract | supported | 8 | Plan/Patch/Verify/Repair/Handoff are state-gated. `<DONE/>` before changes is rejected; verify is command/assertion based; repair references failure evidence and max rounds end in handoff. |
| L5 Evidence & State | supported | 8 | `.dsh/task-state.json` remains canonical and now emits sidecar evidence files: current goal, plan, changed files, tool calls, verify result, failure evidence, repair history, and handoff. |
| L6 Evaluation | partial | 7 | Existing benchmark fixtures cover patch drift, overconfidence, hallucinated APIs, rule blindness, and verification loops. DeepSeek V4 Pro/Flash high/max comparison needs a dedicated matrix run. |
| L7 Cost / Version Governance | partial | 7 | Usage records include latency, prompt/completion/total/reasoning/cache hit/miss/hit ratio. Capability registry tracks model features and deprecated aliases. Pricing-based dollar estimates are not implemented. |

## API Feature Matrix

| API Feature | Status | Notes |
|---|---|---|
| Chat Completion | supported | `DeepSeekClient` defaults to `https://api.deepseek.com/chat/completions`. `/v1/chat/completions` is opt-in with `endpointMode: "openai-compatible-v1"`. |
| Thinking Mode | supported | Sends `thinking: { type: "enabled" }` or `{ type: "disabled" }`. Thinking requests send `reasoning_effort` as `high` or `max`. |
| Tool Calls | supported | Function tools are passed through; response `tool_calls` are preserved. Tool JSON is parsed and schema-required arguments are validated before execution. |
| Streaming | supported | SSE parser yields chunks and normalizer separates `delta.content` from `delta.reasoning_content`. |
| JSON Output | supported | `responseFormat: { type: "json_object" }` maps to `response_format`; caller must still prompt for JSON. Patch protocol remains XML/search-replace. |
| Context Cache | supported | Parses `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`; handoff and state usage records include hit ratio. |
| FIM | experimental | `fim()` is feature-flagged and disabled by default. It is not connected to patch fallback yet. |
| Chat Prefix | experimental | `prefix: true` assistant messages route to beta base URL only when `featureFlags.chatPrefix=true`. |
| Strict Tool Calls | experimental | `function.strict=true` requires `featureFlags.strictToolCalls=true`, beta base URL, and strict-compatible schemas. |
| Usage / Billing | partial | Token and cache metrics are recorded. Dollar cost estimates are pending pricing configuration. |
| Error Semantics | supported | 400/401/402/422 fail fast. 429/500/503 retry. `DeepSeekApiError` includes status, body, retryable, attempt, and duration. |

## Capability Registry

`packages/provider/src/capability-registry.ts` defines the current model registry:

| Model | Thinking | Reasoning Effort | Tool Calls | JSON | FIM | Context |
|---|---:|---|---:|---:|---:|---:|
| `deepseek-v4-pro` | yes | high/max | yes | yes | experimental | 1M |
| `deepseek-v4-flash` | yes | high/max | yes | yes | no | 1M |
| `deepseek-chat` | legacy | n/a | yes | yes | no | 1M |
| `deepseek-reasoner` | legacy | high/max | yes | yes | no | 1M |

Do not use the 1M context window as permission to dump a full repository. DSH's supported layout is stable base context, dynamic relevant context, structured task state, cache-aware prompt ordering, and usage feedback.

## Current Gaps

- No Anthropic-compatible DeepSeek API path.
- No production use of beta strict tools, chat prefix, or FIM in the main patch loop.
- No dollar-denominated cost reporting.
- No automatic API drift probe against the live beta endpoint in CI.
