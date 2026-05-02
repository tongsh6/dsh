---
id: "fixture-protocol-metadata"
status: in_progress
priority: p0
type: feature
spec_ref: "docs/superpowers/specs/2026-05-02-benchmark-operability-fix.md"
plan_ref: "docs/superpowers/plans/2026-05-02-benchmark-operability-fix.md"
dependencies: []
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# 补齐 Fixture 协议操作覆盖元数据

## Objective
让每个 fixture 标注 `expectedProtocolOperations`，使 benchmark 能按协议操作类型（CREATE/PATCH/SEARCH_REPLACE/INSERT/DELETE/RENAME）统计成功率。

## Context
当前 `TaskFixture` 接口只有 `category`（任务类型维度），缺少协议操作覆盖维度。这是 Phase 2 退出条件中"v0.3 全部操作在 benchmark 上有量化数据"无法满足的根因。

## Acceptance Criteria
- [ ] `ProtocolOp` 类型和 `ProtocolOpSchema`（Zod enum）已定义
- [ ] `TaskFixture` 接口新增 `expectedProtocolOperations: ProtocolOp[]` 字段
- [ ] `loadFixtures()` / `loadAllFixtures()` 中每个 fixture 通过 `TaskFixtureSchema` 校验
- [ ] Zod 校验拒绝：缺字段、空数组、无效值
- [ ] 全部 41 个 fixture YAML 文件已添加 `expectedProtocolOperations`
- [ ] `loadAllFixtures` 加载全部 fixture 不报错
- [ ] `TaskResult` 新增 `actualProtocolOps` 字段
- [ ] `runTask` 从 `parseChanges()` 结果提取实际操作类型
- [ ] `formatEvaluationReport` 含按协议操作分类的统计表
- [ ] `pnpm -r run typecheck` 通过
- [ ] `pnpm -r run test` 通过

## Notes
- 应包含 3 个子步骤：代码接口变更 → fixture 批量标注 → benchmark runner 增强
- 标注 fixture 时基于 taskPrompt 推断预期操作，标注的是"设计预期"而非"运行时实际"
