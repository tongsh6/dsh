---
id: "task-lifecycle-fix"
status: done
priority: p2
type: docs
spec_ref: "docs/specs/2026-05-02-benchmark-operability-fix.md"
plan_ref: "docs/plans/2026-05-02-benchmark-operability-fix.md"
dependencies: ["fixture-protocol-metadata", "phase2-exit-criteria-refinement", "benchmark-ci-workflow"]
created: "2026-05-02"
updated: "2026-05-17"
assignee: "ai"
---

# Task 生命周期修复

## Objective
关闭已产出成果但卡在 `in_review` 的旧 task，更新 TASK-SPEC.md §6 索引表，确保 task 追踪与实际进度一致。

## Context
`baseline-benchmark` task 已产出 DSH vs OpenCode 对比报告，但状态一直是 `in_review`，从未被推进到 `done`。新的 benchmark 相关 task 已创建但索引表未更新。

## Acceptance Criteria
- [x] `2026-05-02-baseline-benchmark.md` 状态 `in_review` → `done`
- [x] 旧 task 补充 notes：说明哪些 AC 完成、哪些移交新 task
- [x] `TASK-SPEC.md` §6 索引表更新：新增 benchmark 后续 task，并保留历史 done task 作为当前索引的一部分
- [x] 索引表反映最新的 status 和 priority

## Notes
- 在前三个 task 全部 done 后执行
- 这是纯文档维护操作，无代码变更
- 完成证据：`docs/tasks/2026-05-02-baseline-benchmark.md`、`docs/TASK-SPEC.md` §6。
- 2026-05-17 追账：本文件此前仍为 ready 且 AC 未勾选，但索引和实际文件已显示该任务完成；本次同步 frontmatter 与 AC 状态。
