# RH Smoke Systemic Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make rh smoke failures actionable by enforcing the plan file contract and replacing fragile Maven shell verification with a reusable structured assertion.

**Architecture:** The patch loop must rely on a non-empty `plan.files` contract; accepting a plan with no structured files breaks completeness tracking and repair. Benchmark verification should express domain intent as structured assertions, so Maven multi-module targeted tests do not fail in unrelated upstream modules before the target test can run.

**Tech Stack:** TypeScript, Node test runner, Zod fixture schema, Maven/Surefire verification.

---

### Task 1: Enforce Plan File Contract

**Files:**
- Modify: `packages/core/src/pipeline.ts`
- Test: `packages/core/src/pipeline.test.ts`

- [x] Add a failing test where the first model response has `<PLAN>` but no `<FILES>`, and the second response includes `<FILES>`.
- [x] Verify the test fails because `runPlan` accepts the first response with `plan.files=[]`.
- [x] Update `runPlan` to reject missing/empty `<FILES>` and retry with an explicit protocol correction.
- [x] Add a failing test where both attempts omit `<FILES>` and verify `runPlan` throws a clear error.
- [x] Run `pnpm --filter @dsh/core test`.

### Task 2: Add Maven Structured Verification

**Files:**
- Modify: `packages/core/src/verifier.ts`
- Modify: `packages/eval/src/task-fixtures.ts`
- Test: `packages/core/src/verifier.test.ts`
- Test: `packages/eval/src/task-fixtures.test.ts`

- [x] Add a failing verifier test for a Maven targeted test assertion that composes `mvn test -pl <module> -am -Dtest=<tests> -Dsurefire.failIfNoSpecifiedTests=false`.
- [x] Implement a `maven_test` assertion type with `project_dir`, `module`, `tests`, `also_make`, `quiet`, `timeout_ms`, and optional `name`.
- [x] Extend fixture schema parsing so YAML fixtures can declare `type: maven_test`.
- [x] Run core/eval tests.

### Task 3: Migrate RH CSV Fixture To Structured Acceptance

**Files:**
- Modify: `packages/eval/src/fixtures/rh-bugfix-csv-export.yaml`
- Test: `packages/eval/src/task-fixtures.test.ts`

- [x] Replace legacy `verificationCommands` with `verifications`.
- [x] Include file existence/coverage assertions for the new test file.
- [x] Use `maven_test` for `releasehub-application` and `ExportAppServiceTest`.
- [x] Run fixture schema validation.

### Task 4: Verify Smoke Evidence

**Files:**
- Modify: `docs/project-ledger.md`
- Modify: `docs/tasks/2026-05-10-patch-loop-rollback-p1.md`

- [x] Run `pnpm run test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`.
- [x] Run `node run-benchmark.ts --filter=rh-bugfix-csv-export --parallel=1`.
- [x] Record PASS/PARTIAL evidence and next blocker in the ledger.

Result: `docs/reports/runlogs/260513-013656/` PASS for `rh-bugfix-csv-export` with testsPassed 1/1 and repairSuccess 1/1. Next blocker moved to 24 fixture full benchmark validation.
