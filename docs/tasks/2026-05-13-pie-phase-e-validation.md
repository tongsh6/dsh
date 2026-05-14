---
id: pie-phase-e-validation
status: in_review
priority: p1
type: test
spec_ref: docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md
plan_ref: docs/plans/2026-05-13-pie-phase2-3-scanner-retirement.md
dependencies: ["pie-phase-d-new-capabilities"]
created: 2026-05-13
updated: 2026-05-13
assignee: ai
---

# PIE Phase E：24 fixture benchmark + A/B + 报告归档

## Objective

完成 spec §5.2 行为验收：24 fixture 全量 benchmark 对比基线无退化、字符级 diff 验证、Project Card 注入 A/B 实证，并归档报告以解 unblock ledger §8 中 `pie-phase2-3-baseline-comparison` 条目。

## Context

- Spec §5.2 行为验收 + §6 风险表中"Project Card 注入引起 benchmark 退化"
- Plan §Phase E，覆盖 Step 12
- 前置：Phase D 完成（所有代码改造已落地）

## Acceptance Criteria

- [ ] `pnpm -F @dsh/eval run benchmark` 在 24 fixture 上跑通；产出 runlog 归档到 `docs/reports/runlogs/<timestamp>/`
- [ ] 对比基线 `260508-003359` / `260513-013656`：`completed` 不退化（≥ baseline），`testsPassed` 浮动 ≤ ±2
- [ ] 3 个代表性 fixture（loamlog / pi-proof-forge / release-hub）的 `buildRepoContext` 字符级 diff vs Phase C 完成时的版本：仅含新增的 `## Project Card` 章节
- [ ] A/B 实验：`DSH_INJECT_PROJECT_CARD=false` 重跑同一 24 fixture 集，记录 `completed` / `testsPassed` 差异；写入报告
- [ ] 报告 `docs/reports/knowledge/<YYYYMMDD>-pie-phase2-3-baseline.md` 新建，含：
  - benchmark 数据对比表（vs 两条基线）
  - 字符级 diff sample（3 fixture）
  - A/B 实验结果与 Project Card 注入的边际影响结论
  - 22 个原 fixture 行为不变性结论 + 2 个偏差点（如有）的根因
- [ ] ledger §8 中 `pie-phase2-3-baseline-comparison` 条目 status 转 `resolved`，source 字段补 report 路径
- [ ] ledger §8 中 `project-intelligence-phase2` 条目 status 转 `resolved`
- [ ] `scripts/check-tracked-items.ts` 通过
- [ ] spec §5.1 / §5.2 / §5.3 全部硬验收 checkbox 已勾选
- [ ] spec 状态从 `in_review` 转 `done`（需人类 reviewer 确认 — 本 task 自身置 `in_review`，不自行置 done）

## Steps

参 plan §Step 12。

## Notes

- 本 task 是 spec 收尾，承担"实证驱动"（CONSTITUTION 原则 5）的硬关
- 若 benchmark 退化超过容忍带：先按 spec §7.2 回退策略调阈值 / 反推映射；3 次未收敛则全 spec 转 blocked，本 task 停在 in_progress
- A/B 实验关键：如果 Project Card 注入造成显著退化，临时将默认值改 `DSH_INJECT_PROJECT_CARD=false`，注入功能保留但默认关，作为 debt 进 ledger
