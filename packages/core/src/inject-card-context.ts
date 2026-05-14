import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-async-context override for Project Card injection. When set via
 * `injectCardContext.run(value, fn)`, every `buildRepoContext` call inside
 * fn (and its async descendants) sees `value` regardless of concurrent
 * mutations in other async contexts.
 *
 * Use case: replicated benchmark runs 3 trial workers in parallel, each
 * with different card_on/card_off configuration. Using process.env to flag
 * injection state caused race conditions where worker A's env mutation
 * was observed by worker B's runTask (data contamination).
 *
 * AsyncLocalStorage provides per-async-chain isolation — each runTask
 * invocation gets its own context, regardless of which other workers
 * are concurrently mutating their own.
 *
 * When unset (undefined), `buildRepoContext` falls back to the legacy
 * `DSH_INJECT_PROJECT_CARD` env var path (CLI user-facing escape hatch).
 */
export const injectCardContext = new AsyncLocalStorage<boolean>();
