# Phase 3 Exit Benchmark Evidence

Date: 2026-05-18

## Conclusion

Phase 3 cannot exit from this run.

The latest N=3 replicated benchmark completed all 168 trials and Project Card on exceeded the Phase 3 absolute pass-rate target, but it did not preserve positive lift versus Project Card off:

| Config | testsPassed |
|--------|-------------|
| Project Card on | 59/84 = 70.2% |
| Project Card off | 61/84 = 72.6% |

Exit condition status:

- `testsPassed >60%`: PASS for Project Card on.
- Project Card on positive versus off: FAIL (`-2/84`, `-2.4pp`).
- hard-fail / high-variance governance labels: PASS; label-required and excluded evidence are preserved in run metadata and summary.

This run is therefore a valid closeout evidence run, but it is negative evidence for Phase 3 exit.

## Run

- Baseline: `docs/reports/runlogs/260515064739-pie-replicated/results.json`.
- Runlog: `docs/reports/runlogs/260517183641-pie-replicated/`.
- Summary: `docs/reports/runlogs/260517183641-pie-replicated/summary.md`.
- Raw results: `docs/reports/runlogs/260517183641-pie-replicated/results.json`.
- Seed: `26051801`.
- Sample: 28 fixtures x 3 reps x 2 configs = 168 trials.
- Configs: `card_on`, `card_off`.
- Randomization: benchmark runner randomized trial order from the fixed seed.
- Cleanup: each trial uses hard cleanup through the benchmark runner worktree reset/clean path; release-hub remains single-lane because Maven local repository cleanup is not concurrency-safe.
- Lanes: requested `--lanes-per-repo=2`; loamlog and pi-proof-forge used 2 lanes, release-hub used 1 lane.
- Command: `./packages/core/node_modules/.bin/tsx scripts/benchmark-pie-replicated.ts --reps=3 --lanes-per-repo=2 --seed=26051801 --estimate-results=docs/reports/runlogs/260515064739-pie-replicated/results.json`.
- DSH commit recorded by metadata: `13d8c0b`.
- Caveat: the workspace was dirty when this benchmark ran because the local deterministic SEARCH/REPLACE changes were present. Treat this as full local evidence, not clean-commit release evidence.
- External instability: several late DeepSeek calls retried or failed with network errors; the run completed, but 30 failed trials ended at `init`/`preflighted` without verification results.

## Aggregate Breakdown

| Repo | Project Card on | Project Card off | Delta |
|------|-----------------|------------------|-------|
| pi-proof-forge | 20/21 = 95.2% | 19/21 = 90.5% | +4.8pp |
| loamlog | 15/24 = 62.5% | 18/24 = 75.0% | -12.5pp |
| release-hub | 24/39 = 61.5% | 24/39 = 61.5% | 0.0pp |

The negative aggregate lift comes primarily from loamlog. Project Card remained positive on pi-proof-forge and neutral on release-hub, but loamlog lost three passes versus off, enough to flip the total comparison negative.

## Fixture Attribution

Largest negative deltas:

| Fixture | Category | Project Card on | Project Card off | Delta | Main status |
|---------|----------|-----------------|------------------|-------|-------------|
| `loam-refactor-rename-distill-state` | refactor | 1/3 | 3/3 | -66.7pp | `repair_exhausted` |
| `pi-docs-check-tools` | docs | 2/3 | 3/3 | -33.3pp | `repair_exhausted` |
| `loam-test-distill-state` | test | 2/3 | 3/3 | -33.3pp | `init` |
| `rh-refactor-branch-orchestrator-create` | refactor | 2/3 | 3/3 | -33.3pp | `init` |
| `rh-refactor-branch-orchestrator-tests` | test | 2/3 | 3/3 | -33.3pp | `init` |
| `rh-mixed-dashboard-generated-at-backend` | feature | 2/3 | 3/3 | -33.3pp | `init` |
| `rh-mixed-remove-starter-ping-demo-backend` | refactor | 2/3 | 3/3 | -33.3pp | `repair_exhausted` |

Largest positive deltas:

| Fixture | Category | Project Card on | Project Card off | Delta | Main status |
|---------|----------|-----------------|------------------|-------|-------------|
| `rh-test-dashboard-version` | test | 1/3 | 0/3 | +33.3pp | high variance; `init` / `repair_exhausted` |
| `rh-bugfix-csv-export` | bugfix | 1/3 | 0/3 | +33.3pp | `init` / `repair_exhausted` |
| `rh-refactor-branch-orchestrator-service-attach` | refactor | 2/3 | 1/3 | +33.3pp | label-required split fixture |
| `rh-mixed-rename-entity-dialog-frontend` | refactor | 2/3 | 1/3 | +33.3pp | `repair_exhausted` |
| `pi-clean-duplicate-matching-report` | bugfix | 3/3 | 2/3 | +33.3pp | `init` |
| `pi-docs-prune-stale-report-reference` | refactor | 3/3 | 2/3 | +33.3pp | `init` |

Failure status distribution among failed trials:

| Final status | Failed trials |
|--------------|---------------|
| `init` | 29 |
| `repair_exhausted` | 18 |
| `preflighted` | 1 |

The high `init` / `preflighted` count means the run includes a substantial amount of model/API non-production evidence. This does not invalidate the benchmark, but it explains why the result should drive capability and reliability work rather than fixture-specific patching.

Failure class backfill after `benchmark-failure-classification`:

| Failure Class | Project Card on | Project Card off |
|---------------|-----------------|------------------|
| `model_protocol_plan_invalid` | 16 | 11 |
| `provider_network_error` | 2 | 1 |
| `repair_exhausted` | 7 | 11 |

These classes do not change `testsPassed`; they make the negative lift easier to interpret. Project Card on had more early protocol/provider failures, while Project Card off had more repair exhaustion.

## Governance

The run metadata includes `failureMatrixSummary`:

| Field | Value |
|-------|-------|
| total | 14 |
| knownHardFail | 0 |
| fixedPendingReplication | 9 |
| highVariance | 3 |
| confirmedStable | 4 |
| regressed | 0 |
| comparabilityRisk | 6 |
| labelRequired | 6 |
| phase3ExitExcluded | 2 |

`failureMatrixFixtures` were preserved in `metadata.json` and rendered in `summary.md`. The important policies are:

- `pi-bugfix-count-defs` remains `exclude_from_phase3_exit` because historical evidence before prompt cleanup was contaminated. This run produced card_on 3/3 and card_off 3/3, but it should be treated as fresh neutralized evidence, not as reuse of old contaminated history.
- `rh-refactor-branch-orchestrator-*` are `label_required` with comparability risk. Their split-fixture results must not be reported as equivalent recovery of the deleted monolith.
- `rh-test-dashboard-version` is `label_required` / high variance. This run produced card_on 1/3 and card_off 0/3, so it remains a hard high-variance Java CREATE task, not a single-fixture hard gate.

## Branch Orchestrator Split Results

| Split fixture | Project Card on | Project Card off | Delta |
|---------------|-----------------|------------------|-------|
| `rh-refactor-branch-orchestrator-create` | 2/3 | 3/3 | -33.3pp |
| `rh-refactor-branch-orchestrator-tests` | 2/3 | 3/3 | -33.3pp |
| `rh-refactor-branch-orchestrator-service-release-branch` | 2/3 | 2/3 | 0.0pp |
| `rh-refactor-branch-orchestrator-service-code-merge` | 1/3 | 1/3 | 0.0pp |
| `rh-refactor-branch-orchestrator-service-attach` | 2/3 | 1/3 | +33.3pp |

These results show the split scope is no longer an all-fail hard blocker, but it is still not stable enough to claim monolith-equivalent recovery.

## Next Work

Do not tune any single fixture prompt to recover this run. The next engineering work should target category-level causes:

- model/API reliability around `init` and `preflighted` failures, including explicit classification so external failures do not masquerade as solution quality;
- loamlog Project Card regression analysis, especially `loam-refactor-rename-distill-state`;
- repair exhaustion on multi-file partials, especially Java/Vue tasks where one expected file is missed;
- a clean-commit rerun after review if Phase 3 exit evidence is needed for release-quality signoff.
