# 工具系统实现计划

> 状态: draft | 日期: 2026-05-04 | Spec: `docs/specs/2026-05-04-tool-system.md`
>
> 将 DSH 从"单轮 patch 生成"升级为"多轮工具调用 + patch 生成"，让模型在生成变更前能主动探索代码库。

## Phase 1: 工具执行引擎（无 API 依赖）

### Step 1.1: 创建 tool-definitions.ts

**文件**: `packages/core/src/tool-definitions.ts`（新建）

- 导出 3 个工具的 JSON Schema 定义（`READ_FILE_DEF`, `GREP_FILES_DEF`, `EXEC_SHELL_DEF`）
- 导出 `ALL_TOOL_DEFINITIONS` 数组
- 导出 `ToolName` 类型（`"read_file" | "grep_files" | "exec_shell"`）
- 导出 `ExecShellAllowList` 和 `ExecShellBlockList` 常量
- 约 80 行

**文件**: `packages/core/src/tool-definitions.test.ts`（新建）

- 验证每个工具定义的 JSON Schema 格式正确
- 验证允许列表包含预期命令
- 验证拒绝列表包含预期模式
- 约 50 行

### Step 1.2: 创建 tool-executor.ts

**文件**: `packages/core/src/tool-executor.ts`（新建）

- `executeTool(name, args, cwd): Promise<ToolResult>`
- `readFileImpl(path, cwd): string` — 读文件，安全检查，50KB 上限
- `grepFilesImpl(pattern, include, cwd): string` — execSync grep，30 条上限
- `execShellImpl(command, cwd): ToolResult` — 允许列表检查 → execSync
- `isShellAllowed(command): boolean` — 静态允许列表 + 动态危险模式检测
- `formatToolResult(result): string` — 格式化为注入上下文的 Markdown
- 约 200 行

**文件**: `packages/core/src/tool-executor.test.ts`（新建）

- `read_file` 正常读取、文件不存在、路径穿越拒绝、超大文件截断
- `grep_files` 正常搜索、无匹配、超时处理
- `exec_shell` 允许命令执行、拒绝危险命令（rm/curl/sudo/命令链）、超时
- 约 150 行

### Step 1.3: 更新 core/src/index.ts 导出

**文件**: `packages/core/src/index.ts`（修改）

- 导出 `tool-executor.js` 和 `tool-definitions.js` 的公开 API

## Phase 2: API 集成

### Step 2.1: 扩展 DeepSeekClient 支持 tools 参数

**文件**: `packages/provider/src/client.ts`（修改）

- `DeepSeekRequest` 接口新增 `tools?: ToolDefinition[]`
- `chat()` 方法在请求 body 中传递 `tools` 参数
- 新增 `ToolCall` 和 `ToolResultMessage` 类型
- 约 +20 行

**文件**: `packages/provider/src/client.test.ts`（修改）

- 验证带 tools 的请求体正确序列化
- 验证 tool_calls 响应正确解析
- 约 +30 行

### Step 2.2: 修改 prompt-builder.ts

**文件**: `packages/core/src/prompt-builder.ts`（修改）

- `PATCH_PROMPT` 中添加工具使用说明（5-8 行）
- 导出 `buildSystemPromptWithTools(phase, tools)` 函数
- 工具定义通过参数注入而非硬编码
- 约 +30 行

### Step 2.3: 修改 pipeline.ts runPatch

**文件**: `packages/core/src/pipeline.ts`（修改）

核心改动：将 `runPatch` 的单轮 chat 替换为工具调用循环。

```
当前: buildMessages → client.chat → parseChanges → applyChanges

改为: buildMessages → [循环] client.chat(tools) → 
         if tool_calls: executeTool → 注入结果 → continue
         if patch blocks: parseChanges → applyChanges → done
         if max rounds: force output prompt → client.chat → parseChanges
```

需要新增/修改的函数：
- `runPatchWithTools(params)` — 工具调用循环主函数
- 保留 `runPatch` 函数签名不变，内部调用 `runPatchWithTools`
- 上下文预算告警逻辑
- 工具调用记录写入 `task-state.json`
- 约 +80 行

## Phase 3: 端到端验证

### Step 3.1: 自托管狗食任务

- 在 dsh 自身仓库执行 3 个真实任务
- 记录工具调用次数、SEARCH_REPLACE 匹配率、完成率
- 对比工具化前后的差异

### Step 3.2: 回归测试

- 确保现有 334 个测试继续通过
- `pnpm run scan` 通过

## 文件变更汇总

| 文件 | 操作 | 预计行数 |
|------|------|----------|
| `packages/core/src/tool-definitions.ts` | 新建 | ~80 |
| `packages/core/src/tool-definitions.test.ts` | 新建 | ~50 |
| `packages/core/src/tool-executor.ts` | 新建 | ~200 |
| `packages/core/src/tool-executor.test.ts` | 新建 | ~150 |
| `packages/core/src/index.ts` | 修改 | +10 |
| `packages/provider/src/client.ts` | 修改 | +20 |
| `packages/provider/src/client.test.ts` | 修改 | +30 |
| `packages/core/src/prompt-builder.ts` | 修改 | +30 |
| `packages/core/src/pipeline.ts` | 修改 | +80 |
| **总计** | | **~650 行** |

## 验证方式

```bash
# 单元测试
pnpm --filter @dsh/core test
pnpm --filter @dsh/provider test

# 全量质量门禁
pnpm run scan

# 端到端狗食验证（手动）
dsh plan "add unit test for tool-executor grep_files edge case"
dsh patch --auto
dsh verify
```

## 依赖关系

```
Step 1.1 (tool-definitions)  ──→  Step 1.2 (tool-executor)  ──→  Step 1.3 (exports)
                                                                        │
                                                                        ▼
Step 2.1 (client tools)  ──→  Step 2.2 (prompt-builder)  ──→  Step 2.3 (pipeline)
                                                                        │
                                                                        ▼
                                                              Phase 3 (E2E验证)
```

Step 1.1 和 Step 2.1 可以并行（无依赖关系）。

## 预计风险

- DeepSeek API 的 function calling 响应格式可能与 OpenAI 有差异 → Step 2.3 中增加格式兼容层
- 工具调用循环可能导致 API 延迟显著增加 → 循环上限 5 轮，预计最坏情况 ~2.5 分钟
