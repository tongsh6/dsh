---
id: "patchloop-p2-turn-parser"
status: backlog
priority: p1
type: feature
spec_ref: "docs/specs/2026-05-05-patch-loop-architecture.md"
plan_ref: "docs/plans/2026-05-05-patch-loop-architecture.md"
dependencies: ["patchloop-p1-state-schema"]
created: "2026-05-05"
updated: "2026-05-05"
assignee: "ai"
---

# P2：parsePatchTurn —— 新一轮响应解析器

## Objective
在 `packages/core/src/patch-parser.ts` 新增 `parsePatchTurn(content, hasToolCalls)` 函数：把 v0.4 协议下模型一轮响应解析为 `tools` / `change` / `done` / `invalid` 四种 action 之一。配套 ≥15 个测试覆盖 happy 与 invalid 路径。旧 `parseChanges` 保留供 repair-loop 使用。

## Context
- Spec: `docs/specs/2026-05-05-patch-loop-architecture.md` §3.5
- Plan: `docs/plans/2026-05-05-patch-loop-architecture.md` Phase P2
- 依赖 P1（共用 PatchRoundRecord 类型 + change 字段定义）

## Acceptance Criteria
- [ ] 导出 `PatchTurnAction` discriminated union 类型与 `ChangeBlock` 子类型
- [ ] 函数签名：`parsePatchTurn(content: string, hasToolCalls: boolean): PatchTurnAction`
- [ ] 旧 `parseChanges` 保留并仍可用（repair-loop 不修改）
- [ ] `<DONE/>` 和 `<DONE>...</DONE>` 都识别为 `done`
- [ ] 同轮 DONE + change 块 → `done`，但 `invalid_reason` 字段记录"DONE present, change ignored"用于审计
- [ ] 0 块 + hasToolCalls=true → `kind=tools`
- [ ] 0 块 + hasToolCalls=false → `kind=invalid, reason="no action"`
- [ ] ≥2 个 change 块 → `kind=invalid, reason="multiple change blocks"`
- [ ] 1 个 PATCH 块跨多文件（多个 `--- a/...`）→ `kind=invalid, reason="change block must target single file"`
- [ ] `<NOTE>...</NOTE>` 注释正确忽略
- [ ] malformed unified diff → `invalid("unified diff parse failed")`
- [ ] 测试 ≥15 个用例，全部通过
- [ ] 现有 patch-parser 测试不退化（`parseChanges` 行为不变）
- [ ] index.ts 导出新 API
- [ ] `pnpm --filter @dsh/core run typecheck` + `test` 通过

## Steps

### Step 1: 类型与函数（plan P2.1）
按 plan §P2.1 实现 `parsePatchTurn` 与 `PatchTurnAction` / `ChangeBlock`。

### Step 2: 复用旧解析逻辑
调用现有 `extractCreateBlocks` / `parsePatch` / `extractInsertBlocks` 等小函数提取候选块，然后做 v0.4 校验（数量、单文件等）。**避免重写**已存在的解析单元。

### Step 3: 单元测试（plan P2.3）
覆盖 plan 列出的 ≥15 个用例。

### Step 4: 导出
`patch-parser.ts` + `index.ts` 加 export。

### Step 5: 自检
```bash
pnpm --filter @dsh/core run test    # ≥ 286 tests
pnpm --filter @dsh/core run typecheck
```

## Notes
- `parseChanges` vs `parsePatchTurn` 的边界：
  - `parseChanges`（旧）= "一次响应含全部变更"，repair-loop 用
  - `parsePatchTurn`（新）= "一次响应含 0 或 1 个变更"，patch loop 用
- 不要在 `parsePatchTurn` 内调用 chat schema（避免 core 包依赖 provider）；hasToolCalls 由调用方传入
- `<NOTE>` 块仅审计用，pipeline 不读取，但不要因为出现 NOTE 就报 invalid
