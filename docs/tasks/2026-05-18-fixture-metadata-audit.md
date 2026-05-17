---
id: "fixture-metadata-audit"
status: in_review
priority: p0
type: test
spec_ref: "docs/specs/benchmark-fixture-standard.md"
dependencies: []
created: "2026-05-18"
updated: "2026-05-18"
assignee: "ai"
---

# 机器化受控 benchmark fixture 元数据审计

## Objective
将受控 benchmark fixture 的隔离与目标元数据要求纳入自动审计，防止新增或修改真实 fixture 时遗漏 `benchmarkRef`、`preflightFiles`、`designGoal`、`verificationGoal`。

## Context
`benchmark-fixture-contamination-audit` 仍是 Phase 3 收口期 P0 治理事项。现有审计已覆盖 prompt contamination、comparability risk 和 expectedFiles 验证覆盖，但 `docs/specs/benchmark-fixture-standard.md` 中的受控 fixture 元数据要求还没有机器化。

## Acceptance Criteria
- [x] 新增受控 benchmark fixture 元数据审计函数，且不误伤早期 toy fixture。
- [x] 当前真实受控 fixture 元数据缺口基线为 0。
- [x] 标准文档说明新增审计入口和强制字段。
- [x] `pnpm --dir packages/eval run test` 通过。
