---
id: "benchmark-failure-classification"
status: in_review
priority: p0
type: test
spec_ref: "BLUEPRINT.md"
dependencies: ["phase3-exit-benchmark-evidence"]
created: "2026-05-18"
updated: "2026-05-18"
assignee: "ai"
---

# Benchmark 失败分类与报告字段

## Objective
把 benchmark trial 失败拆成稳定的机器可读分类，避免把 provider/network、PLAN 协议失败、patch/verify/repair 失败混成同一种 `testsPassed=false`。

## Context
`260517183641-pie-replicated` 显示 Project Card on 虽超过 60%，但相对 off 为负。进一步归因时发现大量失败停在 `init` / `preflighted`，其中既有 `<FILES>` 协议失败，也有 provider network 失败；这些需要在报告层显式分类，但不能改变 Phase 3 退出门槛。

## Acceptance Criteria
- [x] `TaskResult` 写入可审计 `failureClass` 字段。
- [x] 分类至少覆盖 provider network、PLAN 协议、cleanup、patch apply、verification、repair exhausted、handoff 和 unknown。
- [x] replicated benchmark `metadata.summary` 和 `summary.md` 输出 Card on/off 的 failure class 对照表。
- [x] 单 run evaluation report 在逐任务详情和失败分析中显示 failure class。
- [x] 不改变 `testsPassed`、Phase 3 benchmark 退出门槛或任何执行流程。
- [x] 新增测试覆盖分类器和 replicated summary 渲染。
- [x] `pnpm --dir packages/eval run test` 通过。
- [x] `pnpm run typecheck` 通过。
- [x] `pnpm run scan` 通过。

## Notes
- 当前 `260517183641-pie-replicated` 按新分类器回填：Card ON 为 `model_protocol_plan_invalid=16`、`repair_exhausted=7`、`provider_network_error=2`；Card OFF 为 `model_protocol_plan_invalid=11`、`repair_exhausted=11`、`provider_network_error=1`。
- 本任务只做观测与报告，不做 PLAN 自动纠错；下一步如继续推进，应另行处理通用 PLAN 协议恢复。
