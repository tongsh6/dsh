# Fixture Contamination Audit

Date: 2026-05-17

## Scope

Scanned all current fixture YAML files under `packages/eval/src/fixtures`.

- Total fixtures: 53
- Strict contamination risk: 2
- Scope reshaping / comparability risk: 6
- Broad keyword candidates reviewed: 9

This audit excludes the discarded local change that added `VersionUpdateAppService` constructor guidance and `@InjectMocks` rejection to `rh-test-dashboard-version`. That change was not committed because it would leak a failure-specific answer into the benchmark.

## Classification

### Strict contamination risk

These fixtures expose concrete implementation answers or failure-specific hints that should be discovered by the agent from source and verification feedback.

| Fixture | Risk | Notes |
|---|---|---|
| `pi-bugfix-count-defs` | answer leakage | Task prompt gives the target regex implementation (`re.findall(r'^\s*' + re.escape(signature), text, re.MULTILINE)`) and explains the indented class-method edge case. |
| `rh-refactor-branch-orchestrator-service-attach` | patch-protocol coaching | Task prompt bans short SEARCH anchors and constrains CREATE/PATCH usage after a known DSH patch-loop failure. This tests compliance with a coached workaround more than general patch robustness. |

### Scope reshaping / comparability risk

These fixtures are not necessarily invalid benchmark items, but their results should not be directly compared against the original monolithic task without labeling the scope change.

| Fixture | Risk | Notes |
|---|---|---|
| `rh-refactor-branch-orchestrator-create` | split-task replacement | Replaces part of the original hard-fail monolith with a smaller isolated task. |
| `rh-refactor-branch-orchestrator-tests` | split-task replacement | Same family; evaluates isolated CREATE + test behavior instead of end-to-end refactor. |
| `rh-refactor-branch-orchestrator-service-code-merge` | split-task replacement | Same family; narrows the refactor to one service. |
| `rh-refactor-branch-orchestrator-service-release-branch` | split-task replacement | Same family; narrows the refactor to one service. |
| `rh-refactor-branch-orchestrator-service-attach` | split-task replacement + protocol coaching | Same family and also has strict contamination risk above. |
| `rh-test-dashboard-version` | unresolved failure, no local hardening committed | Current tracked fixture remains at the pre-hardening state; partial replicated evidence still shows semantic NPE / no-change failure modes. Do not fix by adding answer hints to the task prompt. |

### Reviewed but not counted as contamination

| Fixture | Reason |
|---|---|
| `pi-refactor-read-text` | The import path and helper name are the requested refactor target, not a post-failure hidden answer. |
| `rh-mixed-dashboard-generated-at-backend` | `Instant.now().toString()` is a product-level implementation detail in the task, not a known failure workaround. |
| `loam-docs-readme-distill-observability` | Section-title and placement assertions are normal documentation acceptance criteria. |

## Policy conclusion

Benchmark repair should not move failure-specific answers into fixture prompts or verification shape assertions. If a fixture fails because the agent did not inspect enough code or did not recover from a stack trace, the fix belongs in general DSH behavior: source exploration, repair feedback use, prompt policy, or verifier diagnostics.

Fixture edits are acceptable when they correct an invalid task specification, remove a false positive, or split a task into explicitly labeled smaller benchmark items. Split-task results must be reported as a new benchmark scope, not as equivalent recovery of the original monolith.

## Recommended next steps

1. Revert or neutralize `pi-bugfix-count-defs` answer leakage before using it as evidence for Phase 3 exit.
2. Remove protocol-coaching language from `rh-refactor-branch-orchestrator-service-attach`, or classify it as a DSH-specific patch-protocol benchmark rather than a general coding fixture.
3. Keep `rh-test-dashboard-version` un-hardened at the fixture level; fix the failure through general repair/source-inspection behavior.
4. Add a lightweight fixture lint/audit rule that flags literal implementation snippets, failure-specific workaround phrases, and DSH protocol coaching in benchmark task prompts.
