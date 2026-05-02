---
id: "phase2-exit-criteria-refinement"
status: ready
priority: p1
type: docs
spec_ref: "docs/specs/2026-05-02-benchmark-operability-fix.md"
plan_ref: "docs/plans/2026-05-02-benchmark-operability-fix.md"
dependencies: []
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# 细化 BLUEPRINT Phase 2 退出条件

## Objective
将 BLUEPRINT.md §3 Phase 2 退出条件从定性描述改为 7 个可逐项验证的条件，每个条件含阈值和数据来源。

## Context
当前退出条件如"Patch 协议 v0.3 全部操作在 benchmark 上有量化数据"不可操作——什么算"全部操作"、什么算"量化数据"、在哪个文件中体现，都没有定义。

## Acceptance Criteria
- [ ] BLUEPRINT.md §3 退出条件替换为 7 个可验证条件
- [ ] 每个条件含：阈值（如"≥3 个 fixture"）、数据来源（如"benchmark 报告"）
- [ ] 退出条件格式统一为 `- [ ] 条件描述 | 阈值 | 数据来源`
- [ ] 不删除或改变 BLUEPRINT.md 其他章节内容

## Notes
- 仅修改 BLUEPRINT.md §3 "当前阶段（Phase 2）的退出条件" 一节
- 7 个条件覆盖：6 种操作覆盖率、多语言、多仓库、完成率、静态扫描、跨工具对比、对比报告
