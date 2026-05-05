---
id: "patchloop-p1-state-schema"
status: ready
priority: p1
type: feature
spec_ref: "docs/specs/2026-05-05-patch-loop-architecture.md"
plan_ref: "docs/plans/2026-05-05-patch-loop-architecture.md"
dependencies: []
created: "2026-05-05"
updated: "2026-05-05"
assignee: "ai"
---

# P1：task-state schema 扩展（patch_rounds + partial_ok + patch_failed）

## Objective
在 `packages/core/src/task-state.ts` 新增 `patchRoundSchema` 与 `taskStateSchema.patch_rounds` 字段；扩展 status 枚举加 `patch_failed`、apply_status 加 `partial_ok`；保证旧 task-state.json 向后兼容。是 P2 / P4 / P5 的共用类型基础。

## Context
- Spec: `docs/specs/2026-05-05-patch-loop-architecture.md` §3.3 数据模型
- Plan: `docs/plans/2026-05-05-patch-loop-architecture.md` Phase P1
- 与 P3（prompt）独立可并行；P2 / P4 / P5 都依赖本 task

## Acceptance Criteria
- [ ] `patchRoundSchema` 在 task-state.ts 中定义，含 round / action / tool_calls / change / invalid_reason / reasoning_excerpt / duration_ms 字段
- [ ] action 枚举 = `["tools", "change", "done", "invalid"]`
- [ ] change 子对象 op 枚举 = 6 操作；apply_status 枚举 = `["ok", "failed"]`
- [ ] `taskStateSchema.patch_rounds` 默认 `[]`（向后兼容）
- [ ] `taskStateSchema.status` 加 `"patch_failed"` 值
- [ ] `patchRecordSchema.apply_status` 加 `"partial_ok"` 值
- [ ] 状态机表 `VALID_TRANSITIONS` 新增：
  - `"planned" → ["patched", "patch_failed"]`
  - `"patch_failed" → ["repairing", "repair_exhausted"]`
- [ ] `index.ts` 导出 `PatchRoundRecord` / `PatchTurnAction` 类型
- [ ] `task-state.test.ts` 新增 ≥3 测试：旧 JSON（无 patch_rounds）能解析、新 JSON 含 patch_rounds 能解析、planned → patch_failed 转换合法
- [ ] 现有 271 core 测试不退化
- [ ] `pnpm --filter @dsh/core run typecheck` + `test` 通过

## Steps

### Step 1: schema 定义（plan P1.1 + P1.2）
按 plan §P1.1 `patchRoundSchema` 写入 task-state.ts；扩展 status / apply_status 枚举。

### Step 2: 状态机扩展（plan P1.2）
在 `VALID_TRANSITIONS` 加新转换；保证 patch_failed 进入 repair 通道。

### Step 3: 类型导出（plan P1.3）
顶部 export `PatchRoundRecord`；`packages/core/src/index.ts` 同步加 export。

### Step 4: 测试（plan P1.4）
新增 ≥3 测试覆盖向后兼容、新字段、状态机。

### Step 5: 自检
```bash
pnpm --filter @dsh/core run typecheck
pnpm --filter @dsh/core run test
./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts
```

## Notes
- 本 task 仅扩 schema、不动 pipeline / parser / prompt
- 旧字段 `patches` 保留作为聚合视图（P4 阶段在 patch loop 结束后写入聚合）
- 提交 PR 时附带 task-state.json 变化示例（注释或测试 fixture）便于 review 看清结构
