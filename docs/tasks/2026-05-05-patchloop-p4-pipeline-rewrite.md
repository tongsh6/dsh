---
id: "patchloop-p4-pipeline-rewrite"
status: backlog
priority: p1
type: feature
spec_ref: "docs/specs/2026-05-05-patch-loop-architecture.md"
plan_ref: "docs/plans/2026-05-05-patch-loop-architecture.md"
dependencies: ["patchloop-p1-state-schema", "patchloop-p2-turn-parser", "patchloop-p3-prompt-v04"]
created: "2026-05-05"
updated: "2026-05-05"
assignee: "ai"
---

# P4：runPatch 循环重写（核心 pipeline 改动）

## Objective
重写 `packages/core/src/pipeline.ts` 的 `runPatch` 函数：从"一次响应输出全部变更"切换到"每轮 0/1 change + 可选 tools + 可选 DONE"的 patch loop。增量 apply 单 change，把结果反馈给下一轮模型。最多 30 轮，超限或 3 轮连续 invalid 进入 patch_failed 状态。删 v0.3 batch 路径与 retry hint 逻辑。

## Context
- Spec: `docs/specs/2026-05-05-patch-loop-architecture.md` §3.2 / §3.6 / §3.8
- Plan: `docs/plans/2026-05-05-patch-loop-architecture.md` Phase P4
- 依赖 P1（schema）+ P2（parser）+ P3（prompt）
- 是 P5 / P6 的前置条件

## Acceptance Criteria
- [ ] runPatch 用 while 循环 + parsePatchTurn，按 spec §3.2 流程实现
- [ ] `MAX_PATCH_ROUNDS = 30`，`CONTEXT_BUDGET_CHARS = 800_000`
- [ ] 每轮 action 处理：
  - `tools`: 执行工具调用、注入结果（与现有 tool-executor 集成）
  - `change`: 调用新 helper `applySingleChange(cwd, change)`，把 ✓/✗ feedback message 推给 messages
  - `done`: break loop，进入 verify 阶段
  - `invalid`: 推 correction message；连续 3 轮 invalid → break + status=patch_failed
- [ ] 每轮在 state.patch_rounds push 一条记录，writeTaskState 持久化
- [ ] 循环结束后聚合 PatchRecord：apply_status 为 ok / partial_ok / failed 之一；files_changed 去重合并
- [ ] 状态机：≥1 change ok → "patched"；0 change ok → "patch_failed"
- [ ] 删除 v0.3 的 `parseChanges` 调用 + retry hint 路径 + force-output 注入
- [ ] runPlan / runVerify / runRepair / runHandoff 接口签名不变
- [ ] `pipeline.test.ts` 加 ≥6 测试用例（plan §P4.7 列举）
- [ ] 全部测试通过（pnpm run scan）
- [ ] task-state.json 实际写盘后能被 readTaskState 解析（schema 兼容）

## Steps

### Step 1: applySingleChange helper（plan P4.2）
新增辅助函数，封装单 change 应用。复用 `applyChanges` 但只接受单 change。返回 `{ ok, error?, files_changed: string[] }`。

### Step 2: runPatch 主循环（plan P4.1）
按 spec §3.2 写新主循环。状态机转换（spec §3.8）。

### Step 3: After-apply feedback（plan P4.3）
每轮 apply 后向 messages push `role: "user"` 的 feedback message。这是 P3 PATCH_PROMPT_V4 的契约对端。

### Step 4: PatchRecord 聚合（plan P4.4）
循环结束后写一条聚合 PatchRecord 到 state.patches，与现有 handoff / benchmark-runner 兼容。

### Step 5: 状态机（plan P4.5）
≥1 ok → patched；0 ok → patch_failed。后续 verify 直接 throw "需要 patched 或 repairing" 时让 patch_failed 也通过 → 调整 verify 入口或在 P5 step 处理。

### Step 6: 删旧路径（plan P4.6）
删 MAX_TOOL_ROUNDS 工具循环、parseChanges 主调用、retry hint 大段逻辑（约 -180 行）。

### Step 7: 测试（plan P4.7）
6 个 mock-driven 测试用例。

### Step 8: 自检
```bash
pnpm run scan
./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts
```

## Notes
- runVerify 当前要求 status ∈ {patched, repairing}。要么扩为 {patched, patch_failed, repairing}，要么在 P5 scope-completeness 之前由 pipeline 自动 transition。建议本 task 内统一处理，避免 P5 task 跨包依赖
- repair-loop **不动**，仍调用旧 parseChanges（spec §2.2 第 3 项）
- 若 parsePatchTurn 返回 invalid 但同时有 tool_calls，应优先把 tool_calls 当 tools action 处理（避免无谓的 invalid 计数）
- 单元测试用 mock client：`fakeClient.responses[i]` 模拟模型每轮响应序列
