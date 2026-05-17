# DeepSeek Provider Hardening Plan

## Actual Starting State

The current repository already had a DeepSeek-specific provider, router, patch loop, repair loop, task state, handoff writer, and benchmark suite. The remaining work is hardening, not a ground-up rewrite.

## P0: API Semantics

Status: implemented.

- Default endpoint is official `/chat/completions`; `/v1` is opt-in.
- Thinking mode uses `thinking.type`.
- `reasoning_effort` supports `high` and `max`.
- Usage parsing includes prompt, completion, total, cache hit, cache miss, hit ratio, and reasoning tokens.
- 429/500/503 are retryable; 400/401/402/422 fail fast.
- API errors expose status, body, retryable, attempt, and duration.

## P1: Harness Contract

Status: implemented with remaining polish.

- Plan requires goal, affected files, risks, and verification commands.
- Patch loop applies one change at a time and rejects early fake done.
- Verify runs real shell/assertion checks from config.
- Repair receives failure evidence, must diagnose first, and is bounded by max rounds.
- Handoff records status, files, verification, repair, risk, and usage evidence.
- Evidence sidecars are emitted from `.dsh/task-state.json`.

Remaining polish:

- Add a first-class CLI command to print the evidence sidecars.
- Make failure-evidence excerpts configurable for very large logs.
- Add a state migration version when task-state schema next changes.

## P2: DeepSeek-Native Extensions

Status: partial.

- JSON output is supported for structured callers but patch protocol remains XML/search-replace.
- Strict tool calls, chat prefix, and FIM are explicit beta feature flags.
- Capability registry tracks V4 Pro, V4 Flash, and legacy alias drift.
- Eval design now includes model/effort comparison.

Remaining work:

- Validate strict tools and prefix against the beta endpoint with real API tests before using them by default.
- Prototype FIM only as a localized patch fallback, not as full-file rewriting.
- Add cost estimates once pricing is represented as config.
- Add nightly or manual API drift checks that compare registry assumptions with live docs/API behavior.

## Guardrails

- Do not introduce a generic third-party agent framework.
- Do not bind provider internals to the OpenAI SDK.
- Do not enable beta features by default.
- Do not use the 1M context window to dump the whole repository.
- Do not let model text replace real verification.
- Do not expand shell permissions outside staged tool policies.
