---
id: "patchloop-p3-prompt-v04"
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

# P3：PATCH_PROMPT v0.4 + buildSystemPrompt 路由切换

## Objective
在 `packages/core/src/prompt-builder.ts` 用 v0.4 patch loop 协议的新 PATCH_PROMPT 字符串硬替换旧 v0.3 PATCH_PROMPT。`buildSystemPrompt("patch")` 返回新版；plan / repair 不变。配 token 估算与单元测试。

## Context
- Spec: `docs/specs/2026-05-05-patch-loop-architecture.md` §3.4 prompt 骨架
- Plan: `docs/plans/2026-05-05-patch-loop-architecture.md` Phase P3
- 与 P1 独立可并行；P4 依赖本 task

## Acceptance Criteria
- [ ] 旧 `PATCH_PROMPT`（v0.3 batch）从代码中**删除**（不保留两版本，与 spec §2.2 第 4 项一致）
- [ ] 新 `PATCH_PROMPT_V4` 含 spec §3.4 列出的 5 个核心 section：
  - Loop Protocol（每轮三选一描述）
  - Termination（何时输出 DONE）
  - Change Block Rules（保留 v0.3 的 6 操作格式描述）
  - Tool Rules（保留 v0.3）
  - After-Apply Feedback（系统反馈格式）
- [ ] prompt 主体英文（与 v0.3 保持一致，DeepSeek 偏好）
- [ ] `buildSystemPrompt("patch")` 返回 v0.4 字符串
- [ ] plan / repair phase 不受影响
- [ ] 创建 `prompt-builder.test.ts`（如不存在）含 ≥3 测试：
  - patch phase 返回字符串含 "DONE" 且含 "Loop Protocol"
  - plan / repair phase 返回字符串不含 "Loop Protocol"
- [ ] grep 自检：
  - `grep -c "DONE" packages/core/src/prompt-builder.ts` ≥ 2
  - `grep -c "Loop Protocol" packages/core/src/prompt-builder.ts` = 1
- [ ] token 估算与 v0.3 比对记录到 task notes（实际差值，期望接近或略短）
- [ ] `pnpm --filter @dsh/core run typecheck` + `test` 通过

## Steps

### Step 1: 写 PATCH_PROMPT_V4（plan P3.1）
按 spec §3.4 骨架写出。Loop Protocol 部分必须明确"每轮 EXACTLY ONE of: tool calls / one change block / `<DONE/>`"。

### Step 2: 路由切换（plan P3.2）
`buildSystemPrompt("patch")` 改为返回 `PATCH_PROMPT_V4`；删除旧 `PATCH_PROMPT`。

### Step 3: token 估算（plan P3.3）
跑 `estimateTokens(PATCH_PROMPT_V4)` 与 v0.3 git history 中的旧版本对比。在 task Notes 区记录数值。

### Step 4: 测试（plan P3.4）
新建 `prompt-builder.test.ts`（或扩现有）加 ≥3 测试。

### Step 5: 自检
```bash
pnpm --filter @dsh/core run typecheck
pnpm --filter @dsh/core run test
grep -c "DONE" packages/core/src/prompt-builder.ts
grep -c "Loop Protocol" packages/core/src/prompt-builder.ts
```

## Notes
- 不要保留 v0.3 prompt 作为 fallback；按 spec §7.2 回退策略，回退方式是 git revert + env flag（在 P6 失败时启用），不是双 prompt 共存
- prompt 中提及的 `<DONE/>` 标签，必须与 P2 解析器识别格式一致
- After-Apply Feedback section 描述系统会在每个 change apply 后回复 `✓ change applied` / `✗ change failed` 风格 message——这是 P4 pipeline 实施的契约
- token 估算结果写到这里：（待 task 实施时填）

  | 版本 | 字符数 | est tokens |
  |------|-------|-----------|
  | v0.3 | ~6294 | ~1798 |
  | v0.4 | 5469 | 1563 |
