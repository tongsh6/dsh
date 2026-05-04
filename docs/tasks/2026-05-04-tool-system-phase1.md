---
id: "tool-system-phase1"
status: ready
priority: p1
type: feature
spec_ref: "docs/specs/2026-05-04-tool-system.md"
plan_ref: "docs/plans/2026-05-04-tool-system.md"
dependencies: []
created: "2026-05-04"
updated: "2026-05-04"
assignee: "ai"
---

# 实现工具系统 Phase 1：工具执行引擎

## Objective
创建 `tool-definitions.ts` 和 `tool-executor.ts`，实现 3 个基础工具的纯逻辑（不依赖 DeepSeek API），让模型在生成 patch 前能探索代码库。

## Context
- Spec: `docs/specs/2026-05-04-tool-system.md` — 工具系统的完整设计
- Plan: `docs/plans/2026-05-04-tool-system.md` — 分 Phase 实现计划
- 当前状态: `pipeline.ts` 的 `runPatch` 只做单轮 `client.chat()`，模型无法主动探索代码库
- Phase 1 只做工具执行逻辑，不涉及 API 集成

## Acceptance Criteria
- [ ] `tool-definitions.ts` 导出 3 个工具的 JSON Schema 定义
- [ ] `tool-executor.ts` 实现 `executeTool()` 支持 read_file/grep_files/exec_shell
- [ ] `read_file` 拒绝绝对路径和 ../ 路径，对大文件截断至 50KB
- [ ] `grep_files` 跳过 node_modules/.git/dist/.dsh 等目录，最多返回 30 条
- [ ] `exec_shell` 通过静态允许列表 + 动态危险模式检测，拒绝 rm/curl/sudo 等
- [ ] 工具执行错误不抛异常，统一返回 `{ status: "error", error: "..." }`
- [ ] 所有 3 个工具的单元测试通过

## Steps

### Step 1: tool-definitions.ts
- 创建 `packages/core/src/tool-definitions.ts`
- 导出 `READ_FILE_DEF`, `GREP_FILES_DEF`, `EXEC_SHELL_DEF`（JSON Schema 格式）
- 导出 `ALL_TOOL_DEFINITIONS` 数组
- 导出 `ExecShellAllowList`, `ExecShellBlockList` 常量
- 导出 `ToolName`, `ToolCall`, `ToolResult` 类型

### Step 2: tool-definitions.test.ts
- 创建 `packages/core/src/tool-definitions.test.ts`
- 验证每个工具定义包含 name/description/parameters
- 验证允许列表和拒绝列表非空

### Step 3: tool-executor.ts
- 创建 `packages/core/src/tool-executor.ts`
- 实现 `executeTool()`, `readFileImpl()`, `grepFilesImpl()`, `execShellImpl()`, `isShellAllowed()`, `formatToolResult()`

### Step 4: tool-executor.test.ts
- 创建 `packages/core/src/tool-executor.test.ts`
- 覆盖正常路径和错误路径

### Step 5: 更新 index.ts 导出
- 修改 `packages/core/src/index.ts`，导出新模块的公开 API

## Notes
- exec_shell 的允许列表覆盖了 pnpm/npm/go test/pytest 等常见验证命令
- 安全模型以"默认拒绝"为原则——不在允许列表中的命令一律拒绝
- Phase 2 中 exec_shell 允许列表可通过 `.dsh/config.yml` 扩展
