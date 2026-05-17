---
id: "failure-matrix-governance-invariants"
status: in_review
priority: p0
type: test
spec_ref: "docs/specs/benchmark-fixture-standard.md"
dependencies: []
created: "2026-05-18"
updated: "2026-05-18"
assignee: "ai"
---

# 锁定 failure matrix 证据治理不变量

## Objective
把 failure matrix 中 comparability risk 和 contamination 的 evidence policy 约束纳入自动测试，防止 Phase 3 退出证据被错误纳入或无标签报告。

## Context
`docs/specs/benchmark-fixture-standard.md` 要求 split-task / non-comparable fixture 使用 `label_required`，历史污染证据使用 `exclude_from_phase3_exit`。现有测试只校验 comparability risk 存在某个 evidence policy，约束过宽。

## Acceptance Criteria
- [x] comparability risk 条目必须使用 `governance.evidencePolicy="label_required"`。
- [x] contamination 条目必须使用 `governance.evidencePolicy="exclude_from_phase3_exit"`。
- [x] `pnpm --dir packages/eval run test` 通过。
