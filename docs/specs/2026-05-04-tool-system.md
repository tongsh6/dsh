# DSH 工具系统 SPEC

> 状态: draft | 日期: 2026-05-04 | 作者: loong
>
> 目标: 让 DeepSeek 模型在生成 patch 前能主动探索代码库——读取文件、搜索代码、执行 shell 命令。从"闭眼出 patch"升级为"先看再改"。

## 1. 问题定义

### 1.1 当前状态

当前 `dsh patch` 的工作流是：预装配 top 10 文件内容为 Task Context → 组装 prompt → 一次 `client.chat()` → 从响应中 `parseChanges(content)` → 应用 patch。

模型在整个过程中**只有一次说话机会**。它看不到 plan 涉及文件之外的代码，不能搜索调用点，不能确认文件当前内容。它对代码库的了解完全依赖 `context-builder.ts` 预加载的内容。

### 1.2 核心痛点

1. **SEARCH_REPLACE 匹配失败的根本原因**：模型的 `<SEARCH>` 块来自预加载的文件快照，但快照可能在 prompt 组装后已经过时（之前的操作修改了文件）。`patch-parser.ts` 中的 5 级回退匹配（Level 0/0.5/1/2/3）本质是在补偿这个信息不对称。
2. **模型不知道 caller 在哪**：修改一个函数签名后，不知道有多少个调用点需要更新。当前 `failure-detector.ts` 的 `findCallSites` 是在 repair 阶段补救。
3. **benchmark 完成率的天花板**：6/8 (75%) 的 benchmark 数据表明，仅靠预装配上下文生成的 patch 有 25% 的失败率。工具化是提升这个数字最直接的杠杆。

### 1.3 目标

引入 **PATCH 阶段工具调用循环**（非完整 Agent Loop），让模型在生成最终 patch 前可以：

- `read_file(path)` — 读取任意文件的最新内容
- `grep_files(pattern, include)` — 搜索代码库
- `exec_shell(command)` — 执行只读 shell 命令（test/lint/build 等）

## 2. 非目标

明确不做：

1. **不做完整 Agent Loop**（Phase 4）：模型不能自主分解任务或调度子 Agent
2. **不做对话式会话管理**（Phase 5）：每次 `dsh patch` 仍然是独立调用
3. **不做 MCP 集成**（Phase 7）：工具是 DSH 内置的，不通过 MCP 协议
4. **不做 plan 阶段工具调用**：plan 阶段仍使用预装配上下文（plan 不需要精确代码）
5. **不做文件写入工具**：模型仍然通过 XML 协议块（CREATE/PATCH/INSERT 等）输出变更
6. **不做工具调用审批门禁**：本阶段所有工具自动执行（在 Phase 4 Agent Loop 中引入审批）

## 3. 设计

### 3.1 工具调用循环

```
┌─────────────────────────────────────────────┐
│  runPatch() 进入                             │
│      │                                       │
│      ▼                                       │
│  组装初始上下文（Base + Repo + Task + Dynamic）│
│      │                                       │
│      ▼                                       │
│  ┌──────────────────────┐                    │
│  │ 调用 DeepSeek API     │◄─────────────────┐│
│  │ (带工具定义)          │                   ││
│  └──────┬───────────────┘                   ││
│         │                                    ││
│         ▼                                    ││
│  ┌──────────────┐                            ││
│  │ 解析响应      │                            ││
│  └──┬───┬───┬───┘                            ││
│     │   │   │                                ││
│     ▼   ▼   ▼                                ││
│  ┌────┐┌────┐┌──────┐                        ││
│  │工具││补丁││完成   │                        ││
│  │调用││块  ││(无调用)│                       ││
│  └──┬─┘└──┬─┘└──────┘                        ││
│     │     │                                   ││
│     ▼     ▼                                   ││
│  ┌────────────┐                               ││
│  │ 执行工具    │                               ││
│  │ 结果注入    │──────────────────────────────┘│
│  │ 上下文      │                               │
│  └────────────┘                               │
│                                                │
│  最大 5 轮工具调用后强制要求输出 patch          │
└─────────────────────────────────────────────┘
```

### 3.2 工具定义

#### 3.2.1 read_file

```
名称: read_file
描述: 读取指定文件的完整内容。用于在生成 patch 前确认文件的最新状态。
参数:
  - path (string, required): 相对于项目根目录的文件路径
返回:
  - 文件内容字符串，或错误信息（文件不存在/路径不安全/超过大小限制）
限制:
  - 拒绝绝对路径和包含 ../ 的路径
  - 单次最大返回 50KB（约 1500 行）
  - 对超过限制的文件，返回前 50KB + 行号范围提示
```

#### 3.2.2 grep_files

```
名称: grep_files
描述: 在项目中搜索匹配正则模式的内容。用于查找函数定义、调用点、import 语句等。
参数:
  - pattern (string, required): JavaScript 正则表达式模式
  - include (string, optional): 文件类型过滤 glob，如 "*.ts"、"*.py"。默认搜索所有文本文件
返回:
  - 匹配结果列表，每项包含 file、line_number、content（截断至 200 字符）
  - 最多返回 30 条结果
限制:
  - 自动跳过 node_modules、.git、dist、.dsh、__pycache__ 等目录
  - 超时 10 秒
```

#### 3.2.3 exec_shell

```
名称: exec_shell
描述: 执行只读的 shell 命令。用于运行 test/lint/typecheck 等验证命令。命令在项目根目录执行。
参数:
  - command (string, required): 要执行的 shell 命令
返回:
  - { exit_code, stdout, stderr, duration_ms }
限制:
  - 超时 120 秒
  - 允许列表机制（见 §3.4），不在允许列表中的命令拒绝执行
  - stdout/stderr 上限 100KB
```

### 3.3 工具调用格式

采用 DeepSeek API 兼容的 OpenAI function calling 格式。

System Prompt 中的工具定义（JSON Schema）：

```json
[
  {
    "type": "function",
    "function": {
      "name": "read_file",
      "description": "读取指定文件的完整内容。用于在生成 patch 前确认文件的最新状态。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "相对于项目根目录的文件路径" }
        },
        "required": ["path"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "grep_files",
      "description": "在项目中搜索匹配正则模式的内容。用于查找函数定义、调用点、import 语句等。",
      "parameters": {
        "type": "object",
        "properties": {
          "pattern": { "type": "string", "description": "JavaScript 正则表达式模式" },
          "include": { "type": "string", "description": "可选的文件类型过滤 glob，如 *.ts、*.py" }
        },
        "required": ["pattern"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "exec_shell",
      "description": "执行只读的 shell 命令。用于运行 test/lint/typecheck 等验证命令。",
      "parameters": {
        "type": "object",
        "properties": {
          "command": { "type": "string", "description": "要执行的 shell 命令" }
        },
        "required": ["command"]
      }
    }
  }
]
```

### 3.4 exec_shell 安全模型

`exec_shell` 采用**静态允许列表 + 动态危险模式检测**：

**允许列表**（命令必须以这些前缀之一开头）：
```
pnpm run test, pnpm test, pnpm --filter, pnpm run lint, pnpm run typecheck,
npm test, npm run test, npm run lint, npm run typecheck,
npx jest, npx eslint, npx tsc, npx vitest,
python3 -m pytest, pytest, go test, cargo test,
cat, head, tail, wc -l, git diff, git log, git status,
ls, find, grep, rg
```

**动态拒绝**（命令中包含以下模式则拒绝）：
- `rm `, `rmdir`, `unlink`
- `>` 或 `>>`（输出重定向）
- `|` （管道，可能被用于注入）
- `$(` 或 `` ` ``（命令替换）
- `sudo`, `chmod`, `chown`
- `curl`, `wget`
- `git push`, `git commit`, `git merge`, `git rebase`
- `&&` 或 `;`（命令链）

**不在允许列表中且不触发动检 → 拒绝执行**。

### 3.5 上下文注入格式

每次工具调用后，结果以 Markdown 格式注入到消息历史中：

```
## 工具调用结果: read_file("packages/core/src/verifier.ts")

```typescript
<文件完整内容>
```
```

```
## 工具调用结果: grep_files("detectVerifyCommands")

找到 5 处匹配:
- packages/repo/src/scanner.ts:142: export function detectVerifyCommands(...
- packages/repo/src/scanner.test.ts:12: import { detectTechStack, detectVerifyCommands } from ...
- packages/repo/src/scanner.test.ts:67: const commands = detectVerifyCommands(...
- packages/repo/src/scanner.test.ts:73: const commands = detectVerifyCommands(...
- packages/repo/src/scanner.test.ts:83: const commands = detectVerifyCommands(...
```

```
## 工具调用结果: exec_shell("pnpm --filter @dsh/repo test")

Exit code: 0
Duration: 2345ms
stdout:
✓ 37 tests passed
```

### 3.6 循环终止条件

工具调用循环在以下任一条件满足时终止：

1. **模型输出了包含变更操作的响应**（检测到 CREATE/PATCH/INSERT/DELETE/RENAME 任意一个 XML 块）→ 正常退出，解析变更
2. **达到最大工具调用轮数**（5 轮）→ 在下一轮请求中注入 "MAX TOOL ROUNDS REACHED. You MUST now output your patch with CREATE/PATCH/INSERT/DELETE/RENAME blocks."
3. **模型连续 2 轮调用同一工具且参数相同** → 检测到循环，注入 "You have called the same tool with the same arguments. The result will not change. Proceed to output your patch."
4. **exec_shell 命令被拒绝** → 返回拒绝原因，不终止循环

### 3.7 与现有 patch-parser 的关系

工具调用循环**不替换** `patch-parser.ts`。循环结束后，模型的最终响应仍然通过现有的 `parseChanges()` → `applyChanges()` 流程处理。这使得：

- 现有的 6 种操作协议（CREATE/PATCH/SEARCH_REPLACE/INSERT/DELETE/RENAME）继续有效
- 现有的重试逻辑（parse failure → retry hints → re-call）在工具循环外继续工作
- 现有的冲突检测、路径安全检查不变

### 3.8 文件结构

```
packages/core/src/
├── tool-executor.ts       # 新增：工具执行引擎
├── tool-executor.test.ts  # 新增：工具执行测试
├── tool-definitions.ts     # 新增：工具定义（JSON Schema）导出
├── pipeline.ts             # 修改：runPatch 支持多轮工具调用
├── prompt-builder.ts       # 修改：PATCH_PROMPT 添加工具使用说明
└── ...
```

## 4. 数据模型

### 4.1 ToolCall

```ts
interface ToolCall {
  id: string;                    // 唯一标识，如 "call_1"
  name: "read_file" | "grep_files" | "exec_shell";
  arguments: Record<string, string>;
}
```

### 4.2 ToolResult

```ts
interface ToolResult {
  callId: string;
  status: "success" | "error";
  content: string;               // 注入到上下文的内容
  error?: string;                // 错误描述（仅 status=error 时）
}
```

### 4.3 ToolRoundRecord

记录在 task-state.json 的 patches 记录中，用于审计：

```ts
interface ToolRoundRecord {
  round: number;
  calls: { name: string; arguments: Record<string, string> }[];
  results: { callId: string; status: "success" | "error"; summary: string }[];
}
```

## 5. 上下文预算

工具调用会增加上下文长度。需要考虑以下控制：

| 控制项 | 值 | 说明 |
|--------|-----|------|
| 最大工具轮数 | 5 | 超过后强制输出 |
| read_file 最大返回 | 50KB | 约 1500 行 |
| grep_files 最大返回 | 30 条 | 每条截断至 200 字符 |
| exec_shell 输出上限 | 100KB | stdout+stderr |
| 上下文总量告警阈值 | 800K 字符 | 约 230K tokens，接近时在 prompt 中提示模型尽快输出 patch |

当累计工具调用上下文超过告警阈值时，在下一轮 prompt 中注入：
```
⚠️ CONTEXT BUDGET WARNING: You have used a significant portion of the context window. 
Limit further tool calls to critical information only. Consider outputting your patch now.
```

## 6. 实现策略

### 6.1 分步实现

**Step 1: tool-definitions.ts + tool-executor.ts**
- 实现 3 个工具的纯逻辑（无 DeepSeek API 依赖）
- 单元测试覆盖：正常执行、错误处理、安全拒绝

**Step 2: prompt-builder.ts 修改**
- PATCH_PROMPT 中添加工具使用说明
- 工具定义的 JSON Schema 作为独立导出

**Step 3: pipeline.ts runPatch 修改**
- 引入多轮对话循环
- 解析 DeepSeek function calling 响应格式
- 集成 tool-executor

**Step 4: 端到端验证**
- 在 dsh 自身仓库上完成 1 个 self-hosted 任务

### 6.2 DeepSeek API 兼容性

DeepSeek API 兼容 OpenAI 的 function calling 格式。关键参数：
- 请求中添加 `tools` 数组（与 `messages` 同级）
- 模型响应中 `choices[0].message.tool_calls` 包含工具调用
- 调用结果通过 `role: "tool"` 消息回传

### 6.3 路由策略

工具调用循环期间**强制使用 Pro + thinking**（当前 `patch/multi` 路由策略的扩展）：
- 工具调用需要推理能力来判断"是否需要更多信息"和"如何解读搜索结果"
- Flash 模型可能在工具调用决策上不够稳定

## 7. 成功标准

1. **功能验收**：
   - [ ] 模型在 patch 阶段能调用 `read_file` 读取 plan 之外的文件
   - [ ] 模型在 patch 阶段能调用 `grep_files` 搜索函数引用
   - [ ] 模型在 patch 阶段能调用 `exec_shell` 运行测试
   - [ ] 工具调用不超过 5 轮后强制输出 patch
   - [ ] exec_shell 拒绝执行危险命令（rm/curl/sudo 等）

2. **质量验收**：
   - [ ] SEARCH_REPLACE 首次匹配率相对无工具基线提升 20%+
   - [ ] 在 dsh 自身仓库上 ≥3 个自托管任务端到端通过
   - [ ] 现有 334 个测试继续通过
   - [ ] 新增 tool-executor 测试覆盖率 ≥80%

3. **性能验收**：
   - [ ] 无工具调用的 patch 流程不增加额外延迟（<5% 开销）
   - [ ] 有工具调用的 patch 流程总耗时在可接受范围（≤10 分钟含 API 时间）

## 8. 风险与缓解

| 风险 | 概率 | 缓解措施 |
|------|------|----------|
| DeepSeek API function calling 行为与 OpenAI 有差异 | 中 | Step 1-2 独立于 API，先用 mock 验证工具执行逻辑；API 集成时逐步调优 |
| 模型在工具循环中"迷路"——连续调用无关工具 | 中 | 5 轮上限 + 重复检测终止；在 prompt 中强调"explore efficiently" |
| exec_shell 允许列表不够覆盖实际场景 | 中 | 允许列表可通过 `.dsh/config.yml` 扩展；初始范围覆盖 90% 常见验证命令 |
| Token 消耗显著增加（工具调用结果填满上下文） | 中 | 上下文预算告警 + 结果截断；read_file 最高 50KB，grep_files 最高 30 条 |
| 工具调用增加 API 往返延迟 | 低 | DeepSeek API 延迟通常在 5-30s，5 轮上限下总计 ≤2.5min（可接受） |

## 9. 与其他 Phase 的关系

- **Phase 2（当前）**：本 spec 是 Phase 2 的核心增量——在评测体系之外补上"模型能看代码"的能力
- **Phase 3（工具化）**：BLUEPRINT.md 中 Phase 3 描述 "read_file / grep_files / exec_shell 工具"——本 spec 提前实现了 Phase 3 的核心，但暂不做"工具调用审批门禁"（留给 Agent Loop）
- **Phase 4（Agent Loop）**：本 spec 的多轮工具循环是 Agent Loop 的简化版——Agent Loop 在此基础上增加任务分解、子 Agent 并行调度、多轮自我修正
- **Phase 5-6（流式+TUI）**：工具调用的中间结果可以成为流式输出的展示内容

## 10. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-04 | v1.0 | 初始工具系统 spec：read_file/grep_files/exec_shell + 多轮调用循环 |
