---
id: "tool-adoption-fix"
status: ready
priority: p1
type: bugfix
spec_ref: "docs/specs/2026-05-04-tool-adoption-fix.md"
plan_ref: "docs/plans/2026-05-04-tool-adoption-fix.md"
dependencies: []
created: "2026-05-04"
updated: "2026-05-04"
assignee: "ai"
---

# 修复工具采纳率为零的问题

## Objective
修复 PATCH_PROMPT 规则 10 阻断工具调用、REPAIR_PROMPT 缺少工具引导、重试路径不带 tools 三个根因，让模型在生成 patch 前真正使用 read_file/grep_files/exec_shell。

## Context
- Spec: `docs/specs/2026-05-04-tool-adoption-fix.md` — 完整根因分析与设计
- Plan: `docs/plans/2026-05-04-tool-adoption-fix.md` — 分 Phase 实现计划
- 当前状态: Benchmark 数据显示工具调用次数为零，模型跳过探索直接输出 XML
- 根因: PATCH_PROMPT 规则 10 的「Output ONLY XML blocks」阻断了工具调用；REPAIR_PROMPT 完全没有工具引导

## Acceptance Criteria
- [ ] PATCH_PROMPT 包含多轮协议说明，第 10 条规则已改为「FINAL turn」版本
- [ ] REPAIR_PROMPT 包含多轮协议说明 + 工具使用引导
- [ ] pipeline.ts 重试路径传 tools 参数
- [ ] repair-loop.ts MAX_REPAIR_TOOL_ROUNDS 从 2 改为 3
- [ ] `pnpm run scan` 全部通过
- [ ] docs/project-ledger.md 已创建
- [ ] TASK-SPEC.md §6 索引已更新

## Steps

### Step 1: 修改 PATCH_PROMPT（prompt-builder.ts）
- 插入多轮协议说明块（`## Available Tools` 之前）
- 修改第 10 条规则文案
- 添加「至少 1-2 次探索性工具调用」引导

### Step 2: 修改 REPAIR_PROMPT（prompt-builder.ts）
- 添加多轮协议说明
- 添加 `## Available Tools` + `### Repair Tool Rules`

### Step 3: 修改 pipeline.ts 重试路径
- 重试 `client.chat()` 加 `tools: ALL_TOOL_DEFINITIONS`
- 处理可能的 tool_calls 响应

### Step 4: 修改 repair-loop.ts
- MAX_REPAIR_TOOL_ROUNDS: 2 → 3

### Step 5: 创建项目事实台账 + 更新索引
- 新建 docs/project-ledger.md
- 更新 TASK-SPEC.md §6

### Step 6: 质量门禁
- 运行 pnpm run scan

## Notes
- 工具执行引擎（tool-executor.ts/tool-definitions.ts）不需要修改
- 系统提示词保持英文（DeepSeek 对英文指令响应更稳定）
- 工具结果保持中文（与中文项目环境一致）
- 实际效果只能通过 benchmark 验证，单元测试无法覆盖模型行为变化
