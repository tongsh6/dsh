# 工具采纳率修复计划

> 状态: draft | 日期: 2026-05-04 | Spec: `docs/specs/2026-05-04-tool-adoption-fix.md`
>
> 修复 PATCH_PROMPT 规则 10 阻断工具调用、REPAIR_PROMPT 缺工具引导、重试路径缺 tools 三个根因。

## Phase 1: PATCH_PROMPT 修复（最关键）

### Step 1.1: 修改 prompt-builder.ts 的 PATCH_PROMPT

**文件**: `packages/core/src/prompt-builder.ts`（修改）

- 在 `## Available Tools` 之前插入多轮协议说明块
- 将第 10 条规则从「Output ONLY the XML blocks. Do not add conversational text」改为「On your FINAL turn (after exploration), output ONLY the XML blocks」
- 补充「Make at least 1-2 exploration tool calls before outputting patches.」
- 约 +15 行

### Step 1.2: 验证 PATCH_PROMPT 改动

```bash
grep -c "Multi-Turn" packages/core/src/prompt-builder.ts  # 应输出 1
grep "FINAL turn" packages/core/src/prompt-builder.ts      # 应有输出
pnpm run scan                                              # 全部通过
```

## Phase 2: REPAIR_PROMPT 修复

### Step 2.1: 修改 prompt-builder.ts 的 REPAIR_PROMPT

**文件**: `packages/core/src/prompt-builder.ts`（修改）

- 添加多轮协议说明（复用 Phase 1 的结构）
- 在 `## Repair-Specific Rules` 之前添加 `## Available Tools` 区域
- 约 +20 行

### Step 2.2: 验证 REPAIR_PROMPT 改动

```bash
grep -c "Multi-Turn" packages/core/src/prompt-builder.ts  # 应输出 2
pnpm run scan                                              # 全部通过
```

## Phase 3: 重试路径工具支持

### Step 3.1: 修改 pipeline.ts 重试路径

**文件**: `packages/core/src/pipeline.ts`（修改）

- 第 471-475 行的 `client.chat()` 加上 `tools: ALL_TOOL_DEFINITIONS`
- 在重试响应后处理可能的 tool_calls（如 model 在重试时也调用了工具）
- 约 +10 行

### Step 3.2: 修改 repair-loop.ts 工具轮数

**文件**: `packages/core/src/repair-loop.ts`（修改）

- `MAX_REPAIR_TOOL_ROUNDS`: 2 → 3
- 1 行

## Phase 4: 项目事实台账

### Step 4.1: 创建 docs/project-ledger.md

**文件**: `docs/project-ledger.md`（新建）

- 7 个部分的标准结构
- 约 60 行

### Step 4.2: 更新 TASK-SPEC.md §6 索引

**文件**: `docs/TASK-SPEC.md`（修改）

- tool-system-phase1 → done
- 新增 tool-adoption-fix → in_progress

## 文件变更汇总

| 文件 | 操作 | 预计行数 |
|------|------|----------|
| `packages/core/src/prompt-builder.ts` | 修改 | ~35 |
| `packages/core/src/pipeline.ts` | 修改 | ~10 |
| `packages/core/src/repair-loop.ts` | 修改 | 1 |
| `docs/project-ledger.md` | 新建 | ~60 |
| `docs/TASK-SPEC.md` | 修改 | ~5 |
| **总计** | | **~110 行** |

## 验证方式

```bash
# 单元测试 + 类型检查 + lint
pnpm run scan

# 提示词验证
grep -c "Multi-Turn" packages/core/src/prompt-builder.ts
grep "FINAL turn" packages/core/src/prompt-builder.ts

# 单 fixture benchmark（手动）
pnpm -r run build
pnpm exec tsx run-benchmark.ts --filter=loam-bugfix
# 检查 .dsh/task-state.json 中 tool_rounds 是否非空
```

## 依赖关系

```
Phase 1 (PATCH_PROMPT)  ──→  Phase 2 (REPAIR_PROMPT)
                                      │
Phase 3 (pipeline + repair-loop)  ←──┘
                                      │
Phase 4 (台账 + 索引)             ←──┘  (可并行)
```

Phase 1 和 Phase 2 可以一起写（同一文件 prompt-builder.ts）。
Phase 3 独立于 Phase 1/2（不同文件）。
Phase 4 与其他 Phase 无依赖。

## 预计风险

- PATCH_PROMPT 的多轮协议说明起作用的前提是 DeepSeek 的 function calling 行为与预期一致 —— 如果仍然零调用，需要检查 API 响应中 tool_calls 字段是否被正确传递
- REPAIR_PROMPT 添加工具引导后，修复循环的 token 消耗会略有增加（~400 tokens/轮）
