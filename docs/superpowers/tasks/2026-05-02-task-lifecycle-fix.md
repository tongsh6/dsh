---
id: "task-lifecycle-fix"
status: ready
priority: p2
type: docs
spec_ref: "docs/superpowers/specs/2026-05-02-benchmark-operability-fix.md"
plan_ref: "docs/superpowers/plans/2026-05-02-benchmark-operability-fix.md"
dependencies: ["fixture-protocol-metadata", "phase2-exit-criteria-refinement", "benchmark-ci-workflow"]
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# Task 生命周期修复

## Objective
关闭已产出成果但卡在 `in_review` 的旧 task，更新 TASK-SPEC.md §6 索引表，确保 task 追踪与实际进度一致。

## Context
`baseline-benchmark` task 已产出 DSH vs OpenCode 对比报告，但状态一直是 `in_review`，从未被推进到 `done`。新的 benchmark 相关 task 已创建但索引表未更新。

## Acceptance Criteria
- [ ] `2026-05-02-baseline-benchmark.md` 状态 `in_review` → `done`
- [ ] 旧 task 补充 notes：说明哪些 AC 完成、哪些移交新 task
- [ ] `TASK-SPEC.md` §6 索引表更新：移除旧 task，新增 4 个新 task
- [ ] 索引表反映最新的 status 和 priority

## Notes
- 在前三个 task 全部 done 后执行
- 这是纯文档维护操作，无代码变更
