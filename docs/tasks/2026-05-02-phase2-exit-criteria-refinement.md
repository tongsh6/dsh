---
id: "phase2-exit-criteria-refinement"
status: done
priority: p1
type: docs
spec_ref: "docs/specs/2026-05-02-benchmark-operability-fix.md"
plan_ref: "docs/plans/2026-05-02-benchmark-operability-fix.md"
dependencies: []
created: "2026-05-02"
updated: "2026-05-17"
assignee: "ai"
---

# 细化 BLUEPRINT Phase 2 退出条件

## Objective
将 BLUEPRINT.md §3 Phase 2 退出条件从定性描述改为 7 个可逐项验证的条件，每个条件含阈值和数据来源。

## Context
当前退出条件如"Patch 协议 v0.3 全部操作在 benchmark 上有量化数据"不可操作——什么算"全部操作"、什么算"量化数据"、在哪个文件中体现，都没有定义。

## Acceptance Criteria
- [x] BLUEPRINT.md §3 退出条件替换为可验证条件
- [x] 每个条件含：阈值（如"≥3 个 fixture"）、数据来源（如"benchmark 报告"）
- [x] 退出条件格式统一为 checkbox 条目并包含条件、阈值、数据来源（原计划的 pipe 分隔格式已被后续 Phase 退出文档格式取代）
- [x] 不删除或改变 BLUEPRINT.md 其他章节内容

## Notes
- 仅修改 BLUEPRINT.md §3 "当前阶段（Phase 2）的退出条件" 一节
- 7 个条件覆盖：6 种操作覆盖率、多语言、多仓库、完成率、静态扫描、跨工具对比、对比报告
- 完成证据：`BLUEPRINT.md` §3 "Phase 2 退出条件（已全部勾选 — 2026-05-08）"。
- 2026-05-17 追账：`docs/TASK-SPEC.md` §6 已将本任务标为 done，本文件同步 frontmatter 与 AC 状态。
