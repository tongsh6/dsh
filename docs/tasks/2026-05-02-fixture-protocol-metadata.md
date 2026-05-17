---
id: "fixture-protocol-metadata"
status: done
priority: p0
type: feature
spec_ref: "docs/specs/2026-05-02-benchmark-operability-fix.md"
plan_ref: "docs/plans/2026-05-02-benchmark-operability-fix.md"
dependencies: []
created: "2026-05-02"
updated: "2026-05-17"
assignee: "ai"
---

# 补齐 Fixture 协议操作覆盖元数据

## Objective
让每个 fixture 标注 `expectedProtocolOperations`，使 benchmark 能按协议操作类型（CREATE/PATCH/SEARCH_REPLACE/INSERT/DELETE/RENAME）统计成功率。

## Context
当前 `TaskFixture` 接口只有 `category`（任务类型维度），缺少协议操作覆盖维度。这是 Phase 2 退出条件中"v0.3 全部操作在 benchmark 上有量化数据"无法满足的根因。

## Acceptance Criteria
- [x] `ProtocolOp` 类型和 `ProtocolOpSchema`（Zod enum）已定义
- [x] `TaskFixture` 接口新增 `expectedProtocolOperations: ProtocolOp[]` 字段
- [x] `loadFixtures()` / `loadAllFixtures()` 中每个 fixture 通过 `TaskFixtureSchema` 校验
- [x] Zod 校验拒绝：缺字段、空数组、无效值
- [x] 全部 fixture YAML 文件已添加 `expectedProtocolOperations`（原 AC 为 41 个；当前为 53 个 current fixtures）
- [x] `loadAllFixtures` 加载全部 fixture 不报错
- [x] `TaskResult` 新增 `actualProtocolOps` 字段
- [x] `runTask` 从 patch/state 结果提取实际操作类型
- [x] `formatEvaluationReport` 含按协议操作分类的统计表
- [x] `pnpm -r run typecheck` 通过
- [x] `pnpm -r run test` 通过

## Notes
- 应包含 3 个子步骤：代码接口变更 → fixture 批量标注 → benchmark runner 增强
- 标注 fixture 时基于 taskPrompt 推断预期操作，标注的是"设计预期"而非"运行时实际"
- 完成证据：`packages/eval/src/task-fixtures.ts`、`packages/eval/src/benchmark-runner.ts`、`packages/eval/src/fixtures/*.yaml`、`packages/eval/src/task-fixtures.test.ts`、`packages/eval/src/benchmark-runner.test.ts`。
- 2026-05-17 追账：`docs/TASK-SPEC.md` §6 已将本任务标为 done，本文件同步 frontmatter 与 AC 状态。
