# DeepSeek Provider Hardening Plan

## Current Delta Confirmed

- The provider used `/v1/chat/completions` by default.
- Thinking mode used `chat_completion_reasoning_effort` instead of `thinking.type` plus `reasoning_effort`.
- Usage normalization missed cache hit/miss tokens and nested reasoning tokens.
- HTTP API errors were not classified into retryable and non-retryable statuses.
- Tool execution was duplicated in patch, repair, and preflight paths, with JSON argument parse failures falling back to empty arguments.
- Advanced DeepSeek features had no explicit feature-flagged extension points.
- Context Cache effects were not visible in handoff output.

## Implemented Direction

1. Provider compatibility:
   - Official endpoint is default.
   - Legacy `/v1` endpoint is opt-in.
   - Thinking mode uses `thinking.type`.
   - `reasoning_effort` supports `high` and `max`.

2. Reliability:
   - `DeepSeekApiError` preserves status/body/retryability.
   - 429, 500, and 503 retry with exponential backoff and jitter.
   - 400, 401, 402, and 422 fail fast.

3. Tool loop:
   - `runAgentTurnLoop` provides reusable staged tool-call handling.
   - Tool policies restrict shell access by phase.
   - Invalid JSON arguments and missing required parameters are returned to the model as tool errors.

4. Observability:
   - Model calls record phase/model/thinking/duration/token/cache usage.
   - Handoff reports include DeepSeek cache-aware usage tables.

## Guardrails

- Do not dump the whole repository into context to chase cache hits.
- Do not enable beta APIs by default.
- Do not let patch/plan phases run shell tools.
- Do not replace the XML/search-replace patch protocol with JSON output.

## Follow-Up

- Add end-to-end tests against a real DeepSeek beta endpoint before enabling strict tool calls or chat prefix in production workflows.
- Evaluate FIM on small local code-completion tasks before connecting it to patch fallback.
- Add cost summaries once pricing configuration is available.
