# Fixture Contamination Audit

Date: 2026-05-17

## Scope

Scanned all current fixture YAML files under `packages/eval/src/fixtures`.

- Total fixtures: 53
- Strict contamination risk: 0 remaining; 2 neutralized after audit
- Scope reshaping / comparability risk: 6
- Broad keyword candidates reviewed: 9

Automation added after this manual audit:

- `docs/specs/benchmark-fixture-standard.md` is now the canonical standard for adding or modifying benchmark fixtures.
- `packages/eval/src/fixture-audit.ts` exposes `auditFixtureContamination()` and `auditFixturesForContamination()`.
- `packages/eval/src/fixture-audit.test.ts` locks the current strict-contamination and comparability-risk baseline so future fixture edits cannot silently move failure-specific answers into prompts.
- `packages/eval/src/failure-matrix.json` now carries machine-readable `governance.comparabilityRisk` and `governance.evidencePolicy` fields so benchmark metadata can label or exclude risky evidence without reparsing this report.
- `packages/eval/src/fixture-audit.ts` also exposes `auditFixtureVerificationCoverage()` and `auditFixturesForVerificationCoverage()` to flag expectedFiles that are not explicitly referenced by structured file assertions or shell verification commands.
- First verification-coverage cleanup batch migrated `pi-docs-check-tools`, `pi-bugfix-count-defs`, `loam-test-distill-engine`, and `loam-test-distill-state` from broad shell-only checks to structured assertions plus shell verification.
- Second verification-coverage cleanup batch migrated `loam-refactor-provider-dedup`, `loam-refactor-rename-distill-state`, and `rh-mixed-dashboard-generated-at-backend` to structured assertions.

This audit excludes the discarded local change that added `VersionUpdateAppService` constructor guidance and `@InjectMocks` rejection to `rh-test-dashboard-version`. That change was not committed because it would leak a failure-specific answer into the benchmark.

## Classification

### Strict contamination risk

These fixtures expose concrete implementation answers or failure-specific hints that should be discovered by the agent from source and verification feedback.

No current fixture remains in this category after the follow-up cleanup below.

### Neutralized after audit

| Fixture | Prior Risk | Resolution |
|---|---|---|
| `pi-bugfix-count-defs` | answer leakage | Removed the literal target regex and import instruction from the task prompt. The fixture still states the behavioral requirement: only real function or method declaration lines count, including indented methods. |
| `rh-refactor-branch-orchestrator-service-attach` | patch-protocol coaching | Removed task-prompt instructions that constrained CREATE/PATCH usage and banned short SEARCH anchors. The fixture still has scope-reshaping risk as a split-task replacement. |

### Scope reshaping / comparability risk

These fixtures are not necessarily invalid benchmark items, but their results should not be directly compared against the original monolithic task without labeling the scope change.

| Fixture | Risk | Notes |
|---|---|---|
| `rh-refactor-branch-orchestrator-create` | split-task replacement | Replaces part of the original hard-fail monolith with a smaller isolated task. |
| `rh-refactor-branch-orchestrator-tests` | split-task replacement | Same family; evaluates isolated CREATE + test behavior instead of end-to-end refactor. |
| `rh-refactor-branch-orchestrator-service-code-merge` | split-task replacement | Same family; narrows the refactor to one service. |
| `rh-refactor-branch-orchestrator-service-release-branch` | split-task replacement | Same family; narrows the refactor to one service. |
| `rh-refactor-branch-orchestrator-service-attach` | split-task replacement | Same family; narrows the refactor to one service. |
| `rh-test-dashboard-version` | unresolved failure, no local hardening committed | Current tracked fixture remains at the pre-hardening state; partial replicated evidence still shows semantic NPE / no-change failure modes. Do not fix by adding answer hints to the task prompt. |

### Reviewed but not counted as contamination

| Fixture | Reason |
|---|---|
| `pi-refactor-read-text` | The import path and helper name are the requested refactor target, not a post-failure hidden answer. |
| `rh-mixed-dashboard-generated-at-backend` | `Instant.now().toString()` is a product-level implementation detail in the task, not a known failure workaround. |
| `loam-docs-readme-distill-observability` | Section-title and placement assertions are normal documentation acceptance criteria. |

### Expected-file verification coverage

Follow-up automation now checks whether each `expectedFiles` path is explicitly referenced by a structured file assertion or legacy shell verification command. Targeted `maven_test.tests` entries count as coverage for matching Java test files.

Current machine-readable baseline:

- Total fixtures: 53
- Affected fixtures: 18
- Candidate gaps: 36
- `rh-test-dashboard-version` is no longer in this gap set because both expected test files have explicit `file_exists` assertions.
- `pi-docs-check-tools`, `pi-bugfix-count-defs`, `loam-test-distill-engine`, `loam-test-distill-state`, `loam-refactor-provider-dedup`, `loam-refactor-rename-distill-state`, and `rh-mixed-dashboard-generated-at-backend` are no longer in this gap set after the first two cleanup batches.

Representative remaining candidates:

| Fixture | Gap |
|---|---|
| `loam-bugfix-cli-error-handling` | Broad CLI/package tests do not explicitly assert the three expected source files. |
| `bugfix-token-expiry` | Broad test verification does not explicitly assert the two expected auth files. |
| `feature-pagination` | Broad test verification does not explicitly assert the expected controller/service files. |

## Policy conclusion

Benchmark repair should not move failure-specific answers into fixture prompts or verification shape assertions. If a fixture fails because the agent did not inspect enough code or did not recover from a stack trace, the fix belongs in general DSH behavior: source exploration, repair feedback use, prompt policy, or verifier diagnostics.

Fixture edits are acceptable when they correct an invalid task specification, remove a false positive, or split a task into explicitly labeled smaller benchmark items. Split-task results must be reported as a new benchmark scope, not as equivalent recovery of the original monolith.

The machine-readable policy source is `packages/eval/src/failure-matrix.json`:

- Split-task replacement fixtures use `governance.comparabilityRisk=true` and `governance.evidencePolicy="label_required"`.
- The original `rh-refactor-branch-orchestrator` monolith and historical answer-leaking `pi-bugfix-count-defs` runs use `governance.evidencePolicy="exclude_from_phase3_exit"`.

## Recommended next steps

1. Done: neutralize `pi-bugfix-count-defs` answer leakage before using it as evidence for Phase 3 exit.
2. Done: remove protocol-coaching language from `rh-refactor-branch-orchestrator-service-attach`.
3. Keep `rh-test-dashboard-version` un-hardened at the fixture level; fix the failure through general repair/source-inspection behavior.
4. Done: add a lightweight fixture lint/audit rule that flags literal implementation snippets, failure-specific workaround phrases, and DSH protocol coaching in benchmark task prompts.
5. Done: add machine-readable comparability / evidence-policy metadata to the failure matrix.
6. In progress: migrate high-value false-positive candidates to structured file assertions in small batches, using the verification coverage audit as the candidate source. The first two batches reduced the baseline from 25 affected fixtures / 47 gaps to 18 affected fixtures / 36 gaps.
