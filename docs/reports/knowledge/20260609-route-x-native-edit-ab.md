# Route X `apply_patch` A/B Report

- **Date**: 2026-06-09
- **Scope**: `loam-refactor*` targeted replicated benchmark
- **Baseline run**: `docs/reports/runlogs/260609121703-pie-replicated/`
- **Experiment run**: `docs/reports/runlogs/260609132227-pie-replicated/`
- **Seed**: `26060901`
- **Shape**: 3 fixtures x 3 reps x 2 configs = 18 trials per run

## Summary

This report is chronological. The latest current-code evidence is the 2026-06-10 post-compat targeted A/B in the final section.

The default-off Route X runtime slice did not regress the first targeted loam-refactor benchmark when the flag was enabled.

However, this is **not yet evidence that the native edit tool path is effective**, because the experiment run recorded **0 `apply_patch` tool calls**. The model continued to deliver edits through the existing content change protocol (`PATCH` / `SEARCH_REPLACE` / `CREATE` / `DELETE` / `RENAME`) even while the `apply_patch` tool was exposed.

## Commands

```bash
PATCH_EDITS_AS_NATIVE_TOOL=false ./packages/core/node_modules/.bin/tsx scripts/benchmark-pie-replicated.ts --filter=loam-refactor --reps=3 --seed=26060901 --lanes-per-repo=1
PATCH_EDITS_AS_NATIVE_TOOL=true ./packages/core/node_modules/.bin/tsx scripts/benchmark-pie-replicated.ts --filter=loam-refactor --reps=3 --seed=26060901 --lanes-per-repo=1
```

## Results

| Metric | Baseline flag off | Experiment flag on |
|--------|-------------------|--------------------|
| `patch.edits_as_native_tool` | `false` | `true` |
| Total pass | 16/18 | 18/18 |
| Card ON | 9/9 | 9/9 |
| Card OFF | 7/9 | 9/9 |
| Failed trials | 2 `repair_exhausted` | 0 |
| Avg duration | 215.1s | 195.4s |
| Avg repair rounds | 0.83 | 0.44 |
| Avg patch rounds | 10.06 | 9.11 |
| Native `apply_patch` tool calls | 0 | 0 |
| Content change actions | 27 | 71 |

## Fixture Breakdown

| Fixture / Config | Baseline | Experiment | Notes |
|------------------|----------|------------|-------|
| `loam-refactor-provider-dedup` / `card_off` | 1/3, avg 408.0s, repairAvg 1.67 | 3/3, avg 289.5s, repairAvg 1.00 | Main observed pass-rate improvement |
| `loam-refactor-provider-dedup` / `card_on` | 3/3, avg 298.4s, repairAvg 0.67 | 3/3, avg 413.2s, repairAvg 1.67 | No pass regression, but slower and more repair |
| `loam-refactor-rename-distill-state` / `card_off` | 3/3, avg 183.4s, repairAvg 1.00 | 3/3, avg 133.8s, repairAvg 0.00 | Cost improvement |
| `loam-refactor-rename-distill-state` / `card_on` | 3/3, avg 180.6s, repairAvg 1.00 | 3/3, avg 141.1s, repairAvg 0.00 | Cost improvement |
| `loam-refactor-reorganize-tests` / `card_off` | 3/3, avg 110.6s, repairAvg 0.33 | 3/3, avg 96.8s, repairAvg 0.00 | No regression |
| `loam-refactor-reorganize-tests` / `card_on` | 3/3, avg 109.6s, repairAvg 0.33 | 3/3, avg 97.7s, repairAvg 0.00 | No regression |

## Interpretation

The flag-on run is a useful no-regression result for exposing the tool definition:

- The benchmark completed cleanly with `patch.edits_as_native_tool=true`.
- Pass rate improved from 16/18 to 18/18.
- `repair_exhausted` dropped from 2 to 0.
- Average duration and repair rounds improved overall.

But the native edit execution path remains unvalidated:

- `results.json` recorded 0 `apply_patch` tool calls in both runs.
- Patch round actions show content change operations, not native edit tool execution.
- Therefore the improvement cannot be attributed to the `apply_patch` tool-call apply path.

## Decision

Keep `patch.edits_as_native_tool` default `false`.

Do not resolve `phase4-edits-as-native-tool` yet. The next P0 is native tool adoption: adjust prompt/tool contract and telemetry so a targeted benchmark can prove that models actually call `apply_patch`, then rerun N>=3 A/B with both native-call adoption and no-regression criteria.

## Follow-up Implementation

After this report, the native edit prompt contract was wired into `packages/core/src/prompt-builder.ts` and `packages/core/src/pipeline.ts`: when `patch.edits_as_native_tool` is enabled, patch turns now instruct the model to use exactly one `apply_patch` tool call for edits and to stop emitting XML change blocks in assistant content.

The analysis-paralysis guard was also adjusted for native edit mode: after too many exploration-only rounds, `read_file` / `grep_files` are paused but `apply_patch` remains available, so the runtime does not block the only valid edit channel.

This follow-up does not change the report result above. It creates the next testable state. A new targeted A/B run is still required before claiming native edit path adoption.

## Post-Prompt A/B (Current Code)

After wiring the native edit prompt contract, the same targeted shape was rerun with the same seed:

```bash
PATCH_EDITS_AS_NATIVE_TOOL=false ./packages/core/node_modules/.bin/tsx scripts/benchmark-pie-replicated.ts --filter=loam-refactor --reps=3 --seed=26060901 --lanes-per-repo=1
PATCH_EDITS_AS_NATIVE_TOOL=true ./packages/core/node_modules/.bin/tsx scripts/benchmark-pie-replicated.ts --filter=loam-refactor --reps=3 --seed=26060901 --lanes-per-repo=1
```

Artifacts:

- Baseline: `docs/reports/runlogs/260609145253-pie-replicated/`
- Experiment: `docs/reports/runlogs/260609155633-pie-replicated/`

| Metric | Baseline flag off | Experiment flag on |
|--------|-------------------|--------------------|
| `patch.edits_as_native_tool` | `false` | `true` |
| Total pass | 18/18 | 17/18 |
| Card ON | 9/9 | 9/9 |
| Card OFF | 9/9 | 8/9 |
| Failed trials | 0 | 1 `model_protocol_plan_invalid` |
| Avg duration | 211.3s | 161.8s |
| Avg repair rounds | 0.83 | 0.06 |
| Successful native `apply_patch` applications | 0 | 0 |
| Invalid native `apply_patch` rounds | 0 | 9 |
| Trials with invalid native attempts | 0 | 6 |

Interpretation:

- The flag-on run is faster and much cleaner in patch observability, but it is not a no-regression result because total pass dropped from 18/18 to 17/18.
- The sole failure happened before patching: `loam-refactor-reorganize-tests` / `card_off` / `rep=0` failed plan contract validation with `invalid_files_entry`.
- Native adoption improved from "no observed calls" to "observed attempts", but all observed native `apply_patch` attempts were invalid. Common invalid reasons were missing/incorrect `protocol_op`, INSERT anchor rejected by XML attribute constraints, and malformed PATCH payloads.
- Therefore Route X still must remain default off.

Follow-up implementation after this A/B:

- `apply_patch` arguments now build `ChangeBlock` directly instead of rendering XML and reparsing it, so structured INSERT anchors may contain quotes/newlines.
- The parser now accepts common operation aliases (`op`, `operation`, `action`, `type`, kebab-case) and infers unambiguous ops from structured fields.
- Benchmark result collection now preserves change source and `apply_patch` tool records in `patchRoundActions` / native edit observability, so the next A/B can audit successful native applications directly.

This follow-up is locally tested but not yet externally benchmarked. The next evidence step is another targeted A/B after explicit approval for external DeepSeek data export.

## Post-Compatibility A/B (Current Evidence)

After direct `ChangeBlock` conversion, operation alias/inference, and native observability were added, the targeted shape was rerun with the same seed:

```bash
PATCH_EDITS_AS_NATIVE_TOOL=false ./packages/core/node_modules/.bin/tsx scripts/benchmark-pie-replicated.ts --filter=loam-refactor --reps=3 --seed=26060901 --lanes-per-repo=1
PATCH_EDITS_AS_NATIVE_TOOL=true ./packages/core/node_modules/.bin/tsx scripts/benchmark-pie-replicated.ts --filter=loam-refactor --reps=3 --seed=26060901 --lanes-per-repo=1
```

Artifacts:

- Baseline: `docs/reports/runlogs/260609173815-pie-replicated/`
- Experiment: `docs/reports/runlogs/260610024705-pie-replicated/`

| Metric | Baseline flag off | Experiment flag on |
|--------|-------------------|--------------------|
| `patch.edits_as_native_tool` | `false` | `true` |
| Total pass | 17/18 | 17/18 |
| Card ON | 8/9 | 9/9 |
| Card OFF | 9/9 | 8/9 |
| Failed trials | 1 `model_protocol_plan_invalid` | 1 `model_protocol_plan_invalid` |
| Avg duration | 482.7s | 180.1s |
| Avg repair rounds | 0.78 | 0.28 |
| `apply_patch` tool calls | 0 | 72 |
| Successful native `apply_patch` applications | 0 | 68 |
| Native `apply_patch` apply errors | 0 | 4 |
| Invalid native `apply_patch` rounds | 0 | 7 |
| Content XML change records | 28 | 0 |

Fixture breakdown:

| Fixture | Baseline | Experiment |
|---------|----------|------------|
| `loam-refactor-provider-dedup` | 5/6 | 6/6 |
| `loam-refactor-rename-distill-state` | 6/6 | 5/6 |
| `loam-refactor-reorganize-tests` | 6/6 | 6/6 |

Interpretation:

- Targeted native edit adoption is now proven: the flag-on run used native `apply_patch` for edits and recorded 0 content-XML change records.
- Aggregate pass rate did not regress: both runs were 17/18. The failure shifted from baseline `provider-dedup` / `card_on` / `missing_files` to flag-on `rename-distill-state` / `card_off` / `truncated_or_empty`.
- The flag-on run still has protocol debt: 7 invalid native rounds and 4 apply error records. All invalid reasons in the complete flag-on run were missing or unrecognized `protocol_op`.
- The baseline run had visible network timeout noise in the console during `reorganize-tests`, so duration/cost should be treated as secondary evidence for this pair. Pass rate and native observability are the primary evidence.

Decision:

Keep `patch.edits_as_native_tool` default `false`. The targeted adoption criterion is met, but default-on needs broader/stability evidence, invalid/error reduction, and ledger review.

## Residual Audit Follow-up

The `260610024705` flag-on run is sufficient adoption evidence, but it was not sufficient for root-cause repair of the 7 invalid native rounds. The persisted invalid records kept the high-level reason (`apply_patch.protocol_op must be one of CREATE/PATCH/SEARCH_REPLACE/INSERT/DELETE/RENAME`) but did not retain the submitted argument shape.

Follow-up implementation now records redacted tool-call arguments on invalid native edit rounds and preserves those arguments in benchmark `patchRoundActions`. Large edit payload fields such as `content`, `patch`, `search`, `replace`, and `body` are stored as length metadata rather than raw file content.

This does not change the A/B conclusion above. It makes the next targeted or broader run auditable enough to distinguish model argument-shape drift from parser/schema gaps before changing the default.

Excluded partial runs:

- `docs/reports/runlogs/260609165914-pie-replicated/`: interrupted baseline partial, 8/18.
- `docs/reports/runlogs/260609200316-pie-replicated/`: interrupted flag-on partial, 9/18; useful as early adoption signal but not A/B conclusion.
- `docs/reports/runlogs/260610024543-pie-replicated/`: accidental full-shape partial from a `--help` probe; excluded entirely.
