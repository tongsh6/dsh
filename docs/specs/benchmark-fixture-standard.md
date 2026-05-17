# Benchmark Fixture Standard

> Status: active v1.0 | Date: 2026-05-17
>
> Canonical source for creating and modifying benchmark fixtures under
> `packages/eval/src/fixtures`.

## 1. Required Schema

Every benchmark fixture must pass `TASK_FIXTURE_SCHEMA` in
`packages/eval/src/task-fixtures.ts`.

Required or defaulted fields:

| Field | Rule |
|---|---|
| `id` | Stable, unique, kebab-case identifier. |
| `description` | Short human-readable task summary. |
| `category` | One of `bugfix`, `feature`, `refactor`, `test`, `docs`, `failure_mode`. |
| `taskPrompt` | Task given to the agent. Must describe the product behavior, not DSH-specific tactics. |
| `expectedFiles` | Files expected to change or be created/deleted. Used for scope checks and scoring. |
| `expectedProtocolOperations` | Non-empty list of expected protocol ops. This is a design expectation, not a post-hoc run result. |
| `benchmarkRef` | Use fixed benchmark branch/commit for controlled suites. |
| `preflightFiles` | Tracked files required by the fixture before the agent runs. |
| `designGoal` | What capability or scenario the fixture measures. |
| `verificationGoal` | What physical evidence proves success. |

Verification must use exactly one style:

- Prefer `verifications[]` structured assertions.
- Use legacy `verificationCommands[]` only when structured assertions cannot express the check.
- Do not declare both.

## 2. Prompt Standard

`taskPrompt` must describe the real task and acceptance constraints. It must not
coach the harness.

Allowed:

- Product behavior, public API behavior, file names, package names, and domain constraints.
- Architecture constraints that a human engineer would receive, such as "do not change public method signatures".
- Verification-relevant behavior, such as "the deleted file should no longer exist".

Forbidden:

- Literal implementation answers, such as exact regex/code snippets that should be discovered.
- Failure-specific workaround phrases copied from a previous failed run.
- DSH patch-protocol coaching, such as forcing CREATE/PATCH/SEARCH_REPLACE in the prompt.
- Hints that target a known stack trace or known benchmark failure rather than the underlying task.

The automated guards are `auditFixturesForContamination()` and
`auditFixturesForMetadata()` in `packages/eval/src/fixture-audit.ts`, covered
by `packages/eval/src/fixture-audit.test.ts`.

## 3. Verification Standard

Verification should prove the fixture's user-visible or architecture-level
success, not merely the presence of a convenient implementation detail.

Rules:

- Prefer structured `file_exists`, `file_contains`, `file_not_contains`, `shell`, or `maven_test`.
- For Java/Maven fixtures, prefer `maven_test` over shell strings.
- Verification commands must be deterministic and runnable from the benchmark repo root or declared `project_dir`.
- If a fixture expects deletion, assert physical absence with `file_not_exists` or equivalent shell.
- If a fixture expects creation, assert the file exists and at least one meaningful behavior/content check.

## 4. Protocol Operation Standard

`expectedProtocolOperations` is a design contract.

The field should reflect why the task naturally exercises an operation:

- `CREATE`: new file/component is part of the product task.
- `PATCH`: existing file behavior must change.
- `SEARCH_REPLACE`: local replacement in existing code is the economical path.
- `INSERT`: stable anchor insertion in an existing file is the natural edit.
- `DELETE`: file must physically disappear.
- `RENAME`: task semantics and file size make rename cheaper than create/delete.

Do not add an operation only because a historical run happened to use it.

## 5. Benchmark Isolation

Fixtures must not depend on untracked files or prior benchmark runs.

Required practices:

- `benchmarkRef.commit` should pin the baseline whenever the fixture belongs to a controlled suite.
- `preflightFiles` must list tracked baseline files that the fixture depends on.
- Generated artifacts or `.dsh` state from previous fixtures must not be part of success.
- If a fixture relies on a target file not existing, verify that through the benchmark base or an explicit preflight/design note.

For controlled benchmark fixtures (`pi-*`, `loam-*`, `rh-*`, or any fixture
with `benchmarkRef`), `auditFixturesForMetadata()` enforces:

- `benchmarkRef.branch` and `benchmarkRef.commit`
- non-empty `preflightFiles`
- non-empty `designGoal`
- non-empty `verificationGoal`

## 6. Contamination And Comparability

Prompt contamination and scope reshaping are separate concerns.

Prompt contamination:

- Strict prompt contamination must be cleaned before using the fixture as general capability evidence.
- Historical runs with contaminated prompts must not be used as Phase 3 exit evidence.
- Record exclusion in `packages/eval/src/failure-matrix.json` with
  `governance.evidencePolicy="exclude_from_phase3_exit"`.

Comparability risk:

- Split-task replacements and unresolved special-case fixtures may be valid benchmark items.
- They must not be reported as equivalent recovery of the original larger fixture.
- Mark them in `failure-matrix.json` with:
  - `governance.comparabilityRisk=true`
  - `governance.evidencePolicy="label_required"`
  - a short `governance.notes` explanation

## 7. Review Checklist

Before merging a new or modified fixture:

- [ ] `pnpm --dir packages/eval run test` passes.
- [ ] `pnpm --dir packages/eval run typecheck` passes.
- [ ] The fixture loads through `loadAllFixtures`.
- [ ] `expectedProtocolOperations` is non-empty and justified by task design.
- [ ] `designGoal` and `verificationGoal` are present for controlled benchmark fixtures.
- [ ] `benchmarkRef` and `preflightFiles` are set for controlled benchmark fixtures.
- [ ] `taskPrompt` has no literal answer leakage, failure-specific workaround, or DSH protocol coaching.
- [ ] Any split-task or non-comparable result is recorded in `failure-matrix.json` governance metadata.

## 8. Canonical Files

| Purpose | File |
|---|---|
| Fixture schema | `packages/eval/src/task-fixtures.ts` |
| Fixture contamination audit | `packages/eval/src/fixture-audit.ts` |
| Failure/evidence governance | `packages/eval/src/failure-matrix.json` |
| Failure matrix schema | `packages/eval/src/failure-matrix.ts` |
| Current contamination report | `docs/reports/knowledge/20260517-fixture-contamination-audit.md` |
| Historical Phase 2 fixture design | `docs/specs/2026-05-06-phase2-exit-fixtures.md` |
