# 工具采纳率修复 SPEC

> 状态: draft | 日期: 2026-05-04 | 作者: loong
>
> 目标: 修复 PATCH/REPAIR 阶段工具采纳率为零的问题——让模型在生成 patch 前真正使用 read_file/grep_files/exec_shell。

## 1. 问题定义

### 1.1 当前状态

工具系统已实现（`tool-definitions.ts` + `tool-executor.ts` + pipeline.ts 多轮调用循环 + repair-loop.ts 工具循环），但 Benchmark（260504-140432）数据显示：

- **工具调用次数：零** — read_file=0, grep_files=0, exec_shell=0
- task-state.json 中没有 `tool_rounds` 字段
- 模型直接输出 XML 块，跳过了探索步骤

### 1.2 根因分析

经代码审查，发现三层根因：

1. **PATCH_PROMPT 第 10 条规则阻断了工具调用**：「Output ONLY the XML blocks. Do not add conversational text before or after」——工具调用不是 XML 块，严格遵循这条规则的模型永远不会发出工具调用。

2. **REPAIR_PROMPT 完全没有工具引导**：PATCH_PROMPT 有 ~18 行工具使用说明（`## Available Tools` 区域 + 7 条规则），但 REPAIR_PROMPT 零提及。虽然 repair-loop.ts 里有 2 轮工具调用循环，并传了 `ALL_TOOL_DEFINITIONS`，但模型从系统提示词中不知道工具有效。

3. **patch 重试路径不带 tools**：pipeline.ts 第 471-475 行，格式修复重试时 `client.chat()` 没传 `tools` 参数——当 SEARCH 块匹配失败进入重试时，模型无法用 grep/read_file 找到正确的文件内容。

### 1.3 目标

经过本轮修复后：

- 模型在 PATCH 阶段至少进行 1-2 次工具调用
- 模型在 REPAIR 阶段能使用工具诊断失败原因
- 重试路径也支持工具调用
- Benchmark 中 tool_rounds 不为空

## 2. 非目标

明确不做：

1. 不修改工具执行引擎（tool-executor.ts/tool-definitions.ts）
2. 不增加新工具类型
3. 不修改工具定义的数据模型
4. 不改变安全模型
5. 不修改 provider 层的 tools 参数传递

## 3. 设计

### 3.1 PATCH_PROMPT：从「单轮 XML」到「多轮协议」

**当前：**
```
10. Output ONLY the XML blocks. Do not add conversational text before or after
```

**改为：**
```
10. On your FINAL turn (after exploration), output ONLY the XML blocks — no conversational text before or after the blocks.
```

**新增：** 在 `## Available Tools` 之前插入多轮协议说明：

```
## Multi-Turn Protocol

This is a MULTI-TURN conversation. You have multiple turns to interact.

**Turn 1-N (Exploration):** Call tools (read_file, grep_files, exec_shell) to explore the codebase.
  The system will execute your tool calls and return results.
  Continue exploring until you have the information you need.

**Final Turn (Action):** Output your changes using the XML protocol blocks.
  On this turn only, keep output to the XML blocks.

Make at least 1-2 exploration tool calls before outputting patches.
```

### 3.2 REPAIR_PROMPT：添加工具引导

在 REPAIR_PROMPT 中添加两段内容：

**多轮协议说明**（与 PATCH_PROMPT 相同结构）

**工具使用规则**（适配修复场景）：

```
## Available Tools

You can use tools to diagnose and fix verification failures.

### Tools

- **read_file(path)** — Read the full content of any file. Use this to verify content before writing SEARCH blocks.
- **grep_files(pattern, include?)** — Search the codebase for a regex pattern. Use this to find call sites, definitions, and related code.
- **exec_shell(command)** — Run a read-only shell command. Use this to re-run failing tests and see the exact error output.

### Repair Tool Rules

1. DIAGNOSE: Use exec_shell to re-run the failing tests and capture the exact error output.
2. FIND CALLERS: If you changed a function signature, use grep_files to find ALL call sites.
3. VERIFY CONTENT: Use read_file to confirm file content before writing SEARCH blocks.
4. COMPARE: Use read_file to compare the current file state against what your patch should produce.
5. Make at least 1 tool call to diagnose before attempting a fix.
```

### 3.3 pipeline.ts 重试路径：加 tools

当前第 471-475 行：
```ts
const retryResponse = await client.chat({
  model: "deepseek-v4-pro",
  messages: retryMessages,
  thinking: true,
});
```

改为：
```ts
const retryResponse = await client.chat({
  model: "deepseek-v4-pro",
  messages: retryMessages,
  thinking: true,
  tools: ALL_TOOL_DEFINITIONS as unknown as Record<string, unknown>[],
});
```

并在解析变更之前处理可能的 tool_calls（与主循环相同的模式）。

### 3.4 repair-loop.ts：增加工具轮数

```ts
const MAX_REPAIR_TOOL_ROUNDS = 3;  // was 2
```

### 3.5 为何不改 language consistency

当前系统提示词（英文）+ API 工具定义（中文）+ 工具结果（中文）的混用状态保持不变。原因是：
- 项目宪法和所有设计文档都是中文
- 系统提示词用英文是因为 DeepSeek 对英文指令的响应质量更稳定
- 工具结果用中文是为了与中文项目环境一致
- 这个混用状态在工具零调用时就存在，不是根因

## 4. 成功标准

1. **功能验收**：
   - [ ] PATCH_PROMPT 包含多轮协议说明，不再有单轮 XML 约束
   - [ ] REPAIR_PROMPT 包含工具使用引导
   - [ ] 重试路径传 tools 参数
   - [ ] 现有 386 个测试全部通过

2. **行为验收**（需跑 benchmark）：
   - [ ] Benchmark 中 tool_rounds 不为空（至少 1 个 fixture 有工具调用记录）
   - [ ] 协议操作覆盖率有改善（CREATE/PATCH 至少有一种被触发）

## 5. 风险与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| 多轮协议说明本身不触发工具调用——DeepSeek 的 function calling 行为与预期不同 | 中 | 观察 benchmark 中 tool_rounds 数据，如果仍为零，说明问题在 API 层，需要检查 tool_calls 响应格式 |
| 提示词改动导致模型输出格式错误（不再输出 XML 块） | 低 | pipeline.ts 中 parseChanges 的 try-catch 会捕获，重试路径会触发 |
| Token 消耗增加 | 低 | 新增 ~40 行提示词，约 400 tokens，可忽略 |
| 工具调用增加了延迟 | 低 | 5 轮上限下最坏 ~2.5 分钟，可接受 |

## 6. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-04 | v1.0 | 初始 spec：修复 PATCH_PROMPT 规则 10、REPAIR_PROMPT 缺工具引导、重试路径缺 tools |
