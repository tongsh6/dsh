# DeepSeek-native Coding Harness SPEC v0.3

> 状态: active | 日期: 2026-05-02 | 作者: loong
>
> **v0.3 变更:**
> - **§7.3.3 SEARCH/REPLACE 协议** — 新增 `<PATCH type="search">` 操作，带 XML 子标签格式（`<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE`）。DeepSeek 模型在某些场景下 SEARCH/REPLACE 成功率优于 unified diff。
> - **§7.3.4 三级宽松匹配** — SEARCH 块应用失败时自动降级：精确匹配 → 空白弹性匹配 → 锚点关键词匹配。DeepSeek 专属优化，解决模型在 diff 中行号偏移的问题。
> - **§7.3.5 INSERT 操作** — 新增 `<INSERT anchor="..." position="before|after">` 操作，支持锚点文本定位 + `from-file` 属性引用外部文件内容。解决大文件修改中 CREATE 开销过高的问题。
> - **§7.3.6 大文件处理策略** — 自动检测超过阈值的文件，向模型注入两阶段 CREATE+INSERT 提示，避免模型因 token 限制截断长文件。
> - **§7.3.7 RENAME 操作** — 新增 `<RENAME from="..." to="..." />` 文件重命名支持。
> - **§19 当前实现状态** — 新增 spec 描述与实际代码的对照表，标记各能力的实现状态。
>
> **v0.2 变更 (§7.3):** 文件操作协议从单一 `<PATCH>` unified diff 扩展为 `<CREATE>` / `<PATCH>` / `<DELETE>` 三个语义化操作块。依据：业界所有主流工具（Claude Code/Cline/Aider）均用 Whole File 新建文件，unified diff 的 `/dev/null` hack 在 LLM 中成功率为 0%（参见 dsh benchmark 数据）。

## 1. 项目定位

一个专门为 DeepSeek 长上下文与推理模式优化的工程代码执行器。

**英文定位:**

> A DeepSeek-native coding agent runtime optimized for long-context engineering tasks.

**不是:**
- 通用多模型 Agent 工具
- DeepSeek 版 Claude Code
- OpenCode / Cline / Aider 的 DeepSeek 适配版

**是:**
- 围绕 DeepSeek 模型行为深度优化的 Coding Agent 执行器
- 类比: Claude Code 之于 Claude/Opus，dsh 之于 DeepSeek-V4-Pro/Flash

## 2. 非目标

第一阶段明确不做:

1. 通用多模型调度
2. 完整 Claude Code 替代品
3. IDE / VS Code 插件
4. 完整 TUI
5. Web 管理台
6. 本地部署 DeepSeek
7. 团队协作平台
8. 复杂 MCP 生态
9. 自研 IDE
10. 大而全 AI 编程平台

第一阶段只做一个最小可验证内核: **DeepSeek Coding Agent 的工程执行闭环**。

## 3. 核心闭环

```
Plan -> Patch -> Verify -> Repair -> Handoff
```

| 阶段 | 职责 | 输入 | 输出 |
|------|------|------|------|
| Plan | 读取项目上下文，生成任务计划 | 任务描述 + 项目上下文 | 结构化计划 |
| Patch | 生成可审计的 unified diff | 计划 + 相关文件全文 | unified diff |
| Verify | 执行 test/lint/typecheck 等验证命令 | 修改后的工作树 | 通过/失败 + 日志 |
| Repair | 将失败日志回灌 DeepSeek，生成修复 patch | 验证失败输出 + 上一轮 patch | 新 patch |
| Handoff | 输出结构化交接记录 | task-state 全部历史 | markdown 交接文件 |

**核心原则: 没有验证闭环的 Coding Agent 都是不可靠的。**

## 4. 架构决策

已确认的技术选择:

| 决策 | 选择 | 理由 |
|------|------|------|
| 项目结构 | 新顶级项目 `dsh/`，独立 pnpm workspace | 独立演进，与 loamlog 保持上下游关系 |
| API 接入 | 自建轻量 HTTP client，直调 DeepSeek 原生 API | 不受 OpenAI/Anthropic 兼容层语义折损 |
| 状态持久化 | 文件系统 `.dsh/task-state.json` | 简单、可审计、可 gitignore |

## 5. 技术栈

```yaml
语言: TypeScript
运行时: Node.js >= 18
包管理: pnpm
模块系统: ESM
CLI 框架: cac
类型校验: zod
diff 解析: diff（npm 包）
```

选择理由:
- CLI 工具生态成熟
- 文件操作、diff、shell、JSON stream 处理便捷
- 与现有 AI 工程体系（aief-pm、loamlog）技术栈一致
- 后续做 TUI、VS Code 插件、MCP 更自然

## 6. 模块结构

```
dsh/
├── packages/
│   ├── cli/              # CLI 入口，6 个命令
│   │   └── src/
│   │       ├── main.ts           # CLI 注册
│   │       ├── commands/
│   │       │   ├── init.ts
│   │       │   ├── plan.ts
│   │       │   ├── patch.ts
│   │       │   ├── verify.ts
│   │       │   ├── repair.ts
│   │       │   └── handoff.ts
│   │       └── utils/
│   │           ├── output.ts      # 终端格式化输出
│   │           └── confirm.ts     # 用户确认交互
│   │
│   ├── core/              # 核心引擎
│   │   └── src/
│   │       ├── task-state.ts      # 状态机 + JSON 读写
│   │       ├── context-builder.ts # 四层上下文组装
│   │       ├── prompt-builder.ts  # system prompt + XML 协议模板
│   │       ├── patch-parser.ts    # XML 块提取 + unified diff 校验 + CREATE/DELETE 操作
│   │       ├── verifier.ts        # 验证命令执行
│   │       ├── repair-loop.ts     # 修复循环（最多 N 轮）
│   │       └── handoff-writer.ts  # 交接文件生成
│   │
│   ├── provider/          # DeepSeek API 接入
│   │   └── src/
│   │       ├── client.ts          # HTTP client（~200 行）
│   │       ├── router.ts          # thinking/non-thinking 路由
│   │       └── normalizer.ts      # 响应标准化
│   │
│   ├── repo/              # 仓库扫描与分析
│   │   └── src/
│   │       ├── scanner.ts         # 技术栈识别
│   │       ├── file-ranker.ts     # 按任务描述匹配相关文件
│   │       ├── rule-loader.ts     # 规则文件提取
│   │       └── git.ts             # git log / changed files
│   │
│   └── eval/              # 评测集 + 对比 runner
│       └── src/
│           ├── benchmark-runner.ts
│           ├── task-fixtures.ts
│           ├── score.ts
│           └── fixtures/          # 20 个任务 YAML fixture
│
├── .dsh/                  # 运行时生成（gitignore）
│   ├── config.yml
│   ├── task-state.json
│   └── handoff/
│
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-04-29-dsh-design.md
│
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

### 模块职责

| 模块 | 单一职责 |
|------|---------|
| `cli` | 解析命令参数，调度 core，输出到终端 |
| `core/task-state` | 读写 `.dsh/task-state.json`，状态机: `init → planned → patched → verified` 或 `verification_failed → repairing → verified` 或 `repair_exhausted → done` |
| `core/context-builder` | 分层组装 Base / Repo / Task / Dynamic 四个上下文块 |
| `core/prompt-builder` | 按协议模板构造 system prompt + user message，强制 XML 块输出 |
| `core/patch-parser` | 提取 `<CREATE>`/`<PATCH>`/`<DELETE>` 块，解析 unified diff，校验格式。新建文件用完整内容，修改用 diff |
| `core/verifier` | 执行用户定义或自动检测的验证命令 |
| `core/repair-loop` | 最多 N 轮（默认 3），把失败日志回灌，调用 patch → verify |
| `core/handoff-writer` | 生成结构化 markdown 交接文件 |
| `provider/client` | 轻量 HTTP client，直接调 DeepSeek 原生 API（~200 行） |
| `provider/router` | 按命令类型硬编码路由 Pro thinking / Flash thinking / Flash non-thinking |
| `repo/scanner` | 目录树、关键文件摘要、最近变更、规则文件识别 |
| `repo/file-ranker` | 按任务描述关键词匹配相关文件，输出排序列表 |
| `eval` | 20 个任务 fixture + benchmark runner + 评分体系 |

## 7. DeepSeek 专属优化

### 7.1 thinking / non-thinking 路由

硬编码路由表，不依赖 LLM 自动判断:

```typescript
const ROUTES: Record<string, { model: string; thinking: boolean }> = {
  "plan":                { model: "deepseek-v4-pro",    thinking: true  },
  "patch/single":        { model: "deepseek-v4-flash",   thinking: true  },
  "patch/multi":         { model: "deepseek-v4-pro",    thinking: true  },
  "verify":              { model: "deepseek-v4-flash",   thinking: false },
  "repair":              { model: "deepseek-v4-pro",    thinking: true  },
  "handoff":             { model: "deepseek-v4-flash",   thinking: false },
  "init/scan":           { model: "deepseek-v4-flash",   thinking: false },
  "init/rule-detect":    { model: "deepseek-v4-pro",    thinking: true  },
};
```

路由依据: 命令类型 + task-state 中的 `taskType` 字段。纯粹的函数映射，输出 `{ model, thinking }`。不超过 30 行。

### 7.2 1M Context 分层

```
┌──────────────────────────────────────────┐
│ Base Context (~2K tokens, 固定)           │
│ .dsh/config.yml + 项目规则文件内容         │
├──────────────────────────────────────────┤
│ Repo Context (~5K tokens, init 时生成)    │
│ 目录树 + 关键文件摘要 + 最近 git log       │
├──────────────────────────────────────────┤
│ Task Context (~20K tokens, 按需加载)      │
│ plan 涉及文件全文 + 测试文件 + 业务规则     │
├──────────────────────────────────────────┤
│ Dynamic Context (~5K tokens, 每轮追加)    │
│ 上一轮 patch + verify 输出 + 失败日志       │
└──────────────────────────────────────────┘
```

关键约束:
- **不 dump 整个仓库**。Repo Context 只存摘要，Task Context 只加载 plan 涉及的文件
- **Dynamic Context 每轮截断**: repair 时只保留最近 2 轮失败信息
- **Base Context 不可变**: 一次 `dsh init` 后固定

### 7.3 文件操作协议

#### 7.3.1 设计依据

业界调研（2025-2026）结论：

| 编辑格式 | LLM 成功率 | Token 开销 | 业界采用 |
|----------|:--:|:--:|------|
| Whole File（完整内容） | 60–75% | 极高 | Claude Code / Cline 新建文件 |
| Unified Diff | 70–85% | 极低 | Aider / Codex CLI 修改文件 |
| Search/Replace | 80–98% | 低 | Cline / Aider / OpenCode 主方案 |

行业共识：**新建文件 = Whole File，修改文件 = Search/Replace 或 Unified Diff，没有工具用 diff 新建文件**。

DeepSeek 在 Aider benchmark 上的最佳表现：diff 格式 80.5%，whole 格式 78.9%。作为 Editor 模型配合 Architect 可达 85% SOTA。

#### 7.3.2 协议 v0.3：完整操作集

协议当前支持的完整操作：

```xml
<PLAN>
## 目标
...
## 涉及文件
...
## 修改策略
...
</PLAN>

<FILES>
- file1
- file2
</FILES>

<!-- 新建文件：输出完整内容，无需 diff 格式 -->
<CREATE path="tests/unit/test_foo.py">
文件完整内容，无前缀、无 diff header
</CREATE>

<!-- 修改已有文件（主方式）：unified diff -->
<PATCH>
--- a/file1
+++ b/file1
@@ -l,s +l,s @@
...
</PATCH>

<!-- 修改已有文件（回退方式）：Search/Replace -->
<PATCH type="search" file="path/to/file">
<<<<<<< SEARCH
exact code to find in the file
=======
replacement code
>>>>>>> REPLACE
</PATCH>

<!-- 在已有文件中插入内容：锚点定位 -->
<INSERT anchor="def existing_function():" position="before" from-file="file">
新的代码块或内容
</INSERT>

<!-- 删除文件 -->
<DELETE path="tools/deprecated.py" />

<!-- 重命名文件 -->
<RENAME from="old/name.ts" to="new/name.ts" />

<VERIFY>
command1
</VERIFY>

<RISKS>
...
</RISKS>
```

**语义对比（v0.2 → v0.3）：**

| 操作 | v0.2 | v0.3 |
|------|------|------|
| 新建文件 | `<CREATE path="...">` | `<CREATE path="...">`（不变） |
| 修改文件 | `<PATCH>` unified diff only | `<PATCH>` unified diff（主）+ `<PATCH type="search">`（回退） |
| 插入内容 | 不支持 | `<INSERT anchor="..." position="...">`（v0.3 新增） |
| 删除文件 | `<DELETE path="..." />` | `<DELETE path="..." />`（不变） |
| 重命名 | 不支持 | `<RENAME from="..." to="..." />`（v0.3 新增） |

#### 7.3.3 SEARCH/REPLACE 协议

当 unified diff 不适用时（行号偏移、复杂上下文），模型可以使用 Search/Replace 回退：

```xml
<PATCH type="search" file="src/utils.ts">
<<<<<<< SEARCH
function validate(input: string) {
  if (!input) {
    return false;
  }
  return true;
}
=======
function validate(input: string): boolean {
  if (!input || input.trim().length === 0) {
    return false;
  }
  return true;
}
>>>>>>> REPLACE
</PATCH>
```

**与 unified diff 的模型选择策略：**
- DeepSeek 在 unified diff 上成功率 80.5%，在 Search/Replace 上 78.9%
- 因此 **unified diff 保持为主格式，Search/Replace 作为回退**
- 这与 Claude 模型相反（Claude 更擅长 Search/Replace）
- repair-loop 会在 diff apply 失败时主动提示模型尝试 Search/Replace

#### 7.3.4 SEARCH/REPLACE 三级宽松匹配

当 SEARCH 块在目标文件中找不到精确匹配时，系统自动降级尝试：

```
Level 1: 精确字符串匹配（includes）
    ↓ 失败
Level 2: 空白弹性匹配（空白字符归一化后匹配）
    ↓ 失败
Level 3: 锚点关键词匹配（从 SEARCH 块中提取关键词在文件中定位）
```

每级匹配结果都会记录，用于在 retry hint 中给模型提供准确反馈（"SEARCH 块精确未匹配，但空白弹性匹配已找到位置"等）。这是 DeepSeek 专属优化——模型生成的 SEARCH 块常在缩进/换行上有微小偏差。

#### 7.3.5 INSERT 操作

针对大文件的局部插入场景，避免 WHOLE FILE CREATE 的 token 开销：

```xml
<INSERT anchor="export function setupRoutes() {" position="before">
app.use('/api/v2', v2Router);
</INSERT>
```

- `anchor`: 文件中必须唯一存在的文本片段，用于定位插入点
- `position`: `"before"` 或 `"after"`，相对于锚点的插入位置
- `from-file`: 可选属性，指定外部文件路径，将其内容作为插入源
- 锚点匹配失败时，系统提取文件中的 headings/keywords 作为候选锚点提示模型

**大文件两阶段策略：** 对于超过阈值的文件，系统自动检测并注入提示：
1. 第一阶段：用 `<CREATE>` 输出完整文件内容（如果模型能输出）
2. 如模型因长度截断 → 提示使用 `<INSERT from-file="...">` 引用外部文件

#### 7.3.6 解析规则（v0.3）

```typescript
// 处理优先级
1. <CREATE> 块 → 直接写文件（完整内容，trim 首尾空白）
2. <RENAME> 块 → 重命名文件，检测目标与 CREATE/DELETE 冲突
3. <DELETE> 块 → 删除目标文件
4. <PATCH> 块 → unified diff apply（含 /dev/null 兼容）
5. <PATCH type="search"> 块 → Search/Replace，三级宽松匹配
6. <INSERT> 块 → 锚点定位 + 插入内容

// 冲突检测
7. <CREATE> 和 <PATCH> / <PATCH type="search"> / <DELETE> 指向同一文件 → 拒绝
8. <RENAME> from 与 <DELETE> 指向同一文件 → 拒绝
9. <RENAME> to 与 <CREATE> 指向同一文件 → 拒绝
10. 所有路径包含 ../ 或绝对路径 → 拒绝

// 格式校验
11. <CREATE> 块为空 → 警告
12. <PATCH> 解析失败 → 回灌格式错误，重试（最多 2 次）
13. <VERIFY> 块为空 → 警告
14. <PATCH> 中 /dev/null 仍支持，但不推荐 → 建议模型迁移到 <CREATE>
```

#### 7.3.7 RENAME 操作

```xml
<RENAME from="packages/cli/src/commands/obsolete.ts" to="packages/cli/src/commands/replacement.ts" />
```

- 源文件必须存在，目标路径不能已存在（除非与 CREATE 目标一致）
- 自动创建目标路径所需的目录结构

### 7.4 失败模式库

结构化 fixture，存放在 `packages/eval/fixtures/`:

```yaml
# eval/fixtures/overconfidence.yaml
id: "overconfidence"
description: "DeepSeek 过度自信，跳过验证直接声称完成"
detection:
  - patch 为空但声称修改完成
  - VERIFY 块为空
  - RISKS 块写"无风险"
strategy:
  - 强制要求 VERIFY 块非空
  - repair 时注入提示"请列出至少 2 个潜在风险"
```

MVP 覆盖 5 个高频失败模式:
1. **overconfidence** — 过度自信
2. **patch-drift** — patch 格式偏移
3. **rule-blindness** — 漏读业务规则
4. **scope-creep** — 修改范围扩大
5. **hallucinated-api** — 编造不存在的 API

后续从 loamlog 复盘数据中持续沉淀。

## 8. MVP 命令设计

### 8.1 dsh init

```bash
dsh init [--force]
```

**行为:**
1. 识别技术栈（package.json → Node/TS, pyproject.toml → Python, go.mod → Go）
2. 自动检测验证命令（test, lint, typecheck, build）
3. 提取项目规则文件（.cursorrules, CLAUDE.md, AGENTS.md, AIEF）
4. 生成 `.dsh/config.yml` 和 `.dsh/task-state.json`
5. 生成初始 Repo Context

**输出:**
```
✓ 检测到 TypeScript + Node.js 项目
✓ 验证命令:
  - test:  npx jest --no-coverage
  - lint:  npx eslint src/
  - type:  npx tsc --noEmit
✓ 规则文件: AGENTS.md, .cursorrules
✓ 配置已写入 .dsh/config.yml
```

### 8.2 dsh plan

```bash
dsh plan "实现任务描述" [--type bugfix|feature|refactor|test|docs]
```

**行为:**
1. 读 Base Context + Repo Context
2. `file-ranker` 按任务描述关键词匹配相关文件，加载全文 → Task Context
3. router 选择 Pro + thinking
4. `prompt-builder` 组装 system prompt（含协议要求 + 失败模式告警）+ 分层上下文
5. 调 DeepSeek，解析 `<PLAN>` 块
6. 写入 task-state，状态 → `planned`

**输出:** 结构化计划（目标、涉及文件、策略、风险）

### 8.3 dsh patch

```bash
dsh patch [--auto] [--dry-run]
```

**行为:**
1. 读 task-state，确认状态为 `planned` 或 `repairing`
2. 加载 Task Context
3. 调 DeepSeek，强制输出 `<PATCH>` 块
4. `patch-parser` 提取并校验 unified diff
5. `--dry-run`: 只输出 diff
6. 默认: 展示 diff，等待用户 Y/n 确认
7. `--auto`: 直接 apply
8. 写入 task-state，状态 → `patched`

### 8.4 dsh verify

```bash
dsh verify [--test] [--lint] [--typecheck] [--all]
```

**行为:**
1. 读 `.dsh/config.yml` 获取验证命令
2. 执行命令，捕获 stdout/stderr + 退出码
3. 写入 task-state，状态 → `verified` 或 `verification_failed`

### 8.5 dsh repair

```bash
dsh repair [--rounds 3]
```

**行为:**
1. 确认状态为 `verification_failed`
2. 构建 Dynamic Context（上一轮 patch + verify 失败输出）
3. 注入失败模式告警
4. 调 DeepSeek Pro + thinking，生成新 patch
5. 应用后自动执行 verify
6. 循环直到全部通过或达到 `--rounds` 上限
7. 达到上限 → 状态 `repair_exhausted`，提示用户介入

### 8.6 dsh handoff

```bash
dsh handoff [--format markdown|json] [--output ./handoff/]
```

**行为:**
1. 读 task-state 全部历史
2. 组装结构化交接记录
3. 输出到 `--output` 目录（默认 `.dsh/handoff/`）

**输出:** markdown 交接文件，含修改内容、验证结果、修复历史、风险、下一步

## 9. 状态机

```
                    ┌─────────┐
                    │  init   │
                    └────┬────┘
                         │
                    ┌────▼────┐
                    │ planned │
                    └────┬────┘
                         │
                    ┌────▼────┐
                    │ patched │
                    └────┬────┘
                         │
                    ┌────▼────┐
                    │ verified │──────▶ done
                    └────┬────┘
                         │ (失败)
                    ┌────▼──────────┐
                    │ verif_failed  │
                    └────┬──────────┘
                         │
                    ┌────▼────┐
                    │repairing◄──────┐
                    └───┬─────┘      │
                        │            │ (未通过, < max rounds)
                    ┌───▼──────┐     │
                    │ verifying├─────┘
                    └───┬──────┘
                        │ (通过)
                    ┌───▼──────┐
                    │ verified │──────▶ done
                    └──────────┘
                        │ (超过 max rounds)
                    ┌───▼─────────────┐
                    │ repair_exhausted│──▶ 用户介入
                    └─────────────────┘
```

## 10. task-state.json 结构

```json
{
  "version": "0.1",
  "status": "planned",
  "task": {
    "description": "修复 login.ts 中 token 过期不刷新的 bug",
    "type": "bugfix",
    "created_at": "2026-04-29T10:00:00Z"
  },
  "plan": {
    "summary": "在 token.ts 新增 refreshIfExpired()，login.ts 调用它",
    "files": ["src/auth/login.ts", "src/auth/token.ts"],
    "risks": ["token.ts 的 refresh() 可能是异步的"],
    "raw_xml": "<PLAN>...</PLAN>"
  },
  "patches": [
    {
      "round": 1,
      "patch": "--- a/src/auth/token.ts\n+++ ...",
      "apply_status": "ok",
      "files_changed": ["src/auth/token.ts", "src/auth/login.ts"]
    }
  ],
  "verify_results": [
    {
      "round": 1,
      "results": [
        {"command": "npx jest --no-coverage", "status": "failed", "exit_code": 1, "output": "...", "duration_ms": 2300}
      ]
    }
  ],
  "repair_rounds": 0,
  "handoff": null
}
```

## 11. 配置文件 .dsh/config.yml

```yaml
project:
  name: "my-project"
  language: typescript
  package_manager: pnpm

verify:
  test: "npx jest --no-coverage"
  lint: "npx eslint src/"
  typecheck: "npx tsc --noEmit"

rules:
  files:
    - path: "AGENTS.md"
    - path: ".cursorrules"

deepseek:
  default_model: deepseek-v4-pro
  flash_model: deepseek-v4-flash
  max_repair_rounds: 3
  thinking_default: true
```

## 12. System Prompt 结构

```
SYSTEM:
You are a DeepSeek-native Coding Agent. You output structured XML blocks.

## Protocol
Your response MUST contain these blocks in order:
<PLAN>...</PLAN>
<FILES>...</FILES>
<PATCH>...</PATCH>
<VERIFY>...</VERIFY>
<RISKS>...</RISKS>

## Failure Patterns to Avoid
1. Overconfidence: do NOT claim completion without VERIFY commands
2. Patch drift: ensure hunk headers match current file line numbers
3. Rule blindness: read and respect all project rules in Base Context
4. Scope creep: only modify files listed in <FILES>
5. Hallucinated API: do NOT reference APIs that don't exist in the repo

## Context Layers
[Base Context]
[Repo Context]
[Task Context]
[Dynamic Context - only in repair]

USER:
[任务描述]
[相关文件全文]

Output your response following the protocol above.
```

## 13. 评测体系

### 13.1 任务集

20 个真实工程任务:

| 类型 | 数量 | 示例 |
|------|------|------|
| bug fix | 5 | token 过期不刷新 / 空指针 / 边界条件 |
| 小功能 | 5 | 新增参数校验 / 添加日志 / 扩展 API |
| 重构 | 5 | 提取公共函数 / 替换实现 / 调整接口 |
| 测试补充 | 3 | 覆盖未测试路径 / 边界测试 |
| 文档规则 | 2 | 同步 README / 更新 AIEF 规则 |

### 13.2 评分维度

每个任务记录 10 个指标:

| # | 指标 | 评分方式 |
|---|------|---------|
| 1 | 是否完成任务 | 0/1 |
| 2 | 修改文件数是否合理 | 实际 vs 预期 |
| 3 | 是否超出任务范围 | 额外修改的文件 |
| 4 | 是否违反架构规则 | 规则检查 |
| 5 | patch 是否稳定 apply | 0/1 |
| 6 | 测试是否通过 | 0/1 |
| 7 | 失败后是否有效修复 | 0/1（repair 后通过） |
| 8 | 是否遗漏业务规则 | 人工检查 |
| 9 | handoff 是否清晰 | 0-3 分 |
| 10 | 人工修正成本 | 需要额外输入的次数 |

### 13.3 对比基线

同一个任务用以下方式执行并对比:
- **dsh** — 本项目
- **OpenCode + DeepSeek** — 当前主力方案
- **Claude Code + DeepSeek** — 对照

### 13.4 成功标准

```
dsh 在以下方面优于基线:
- 任务完成率 > 基线
- 失败修复率 > 基线
- 人工介入次数 < 基线
- 架构违规数 < 基线
```

## 14. Provider Client 设计

```typescript
// packages/provider/src/client.ts (~200 行)

interface DeepSeekRequest {
  model: string;
  messages: Message[];
  thinking?: boolean;
  max_tokens?: number;
  temperature?: number;
}

interface DeepSeekResponse {
  id: string;
  choices: {
    message: {
      content: string;
      reasoning_content?: string;  // thinking 内容
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// 核心方法
class DeepSeekClient {
  constructor(config: { apiKey: string; baseUrl?: string });

  // 非流式调用（plan / patch / handoff）
  async chat(req: DeepSeekRequest): Promise<DeepSeekResponse>;

  // 流式调用（可选，repair 多轮时展示进度）
  async chatStream(req: DeepSeekRequest): AsyncIterable<string>;

  // thinking 开关通过请求体字段控制
  // DeepSeek 原生支持 reasoning_effort 或 thinking 参数
}
```

API Key 从环境变量 `DEEPSEEK_API_KEY` 读取，与现有 DeepSeek 配置一致。

## 15. 与 AI 工程体系的关系

```
AIEF (规则层)
  │
  ▼
context-bridge (上下文层)
  │
  ▼
dsh (执行层)    ← 本项目
  │
  ▼
Loamlog (复盘沉淀层)
```

dsh 是独立的执行层，通过文件系统与上下游对接:
- **输入**: AIEF 规则文件 + context-bridge 任务上下文
- **输出**: handoff markdown + task-state JSON → 可被 Loamlog 摄取

## 16. 第一阶段交付物

1. **SPEC.md** — 本文档
2. **最小 CLI** — 6 个命令可运行
3. **DeepSeek provider** — HTTP client + router + normalizer
4. **context builder** — 四层上下文组装
5. **patch parser** — XML 协议解析（含 `<CREATE>`/`<PATCH>` 操作块）+ unified diff 校验 + 新建文件直接写
6. **verify runner** — 自动检测并执行验证命令
7. **repair loop** — 最多 3 轮修复循环
8. **handoff writer** — markdown 交接文件
9. **20 个任务评测集** — YAML fixture
10. **对比报告** — dsh vs OpenCode vs Claude Code

## 17. 第一阶段开发路线

| 阶段 | 内容 | 预计 |
|------|------|------|
| 1 | 项目骨架 + CLI 框架 + provider/client | 基础设施 |
| 2 | repo/scanner + core/context-builder | 上下文准备 |
| 3 | core/prompt-builder + core/patch-parser | 协议实现 |
| 4 | core/verifier + core/repair-loop | 验证闭环 |
| 5 | core/handoff-writer + 全部 6 个命令串联 | 主线通 |
| 6 | eval/ 评测集 + benchmark-runner | 可对比 |
| 7 | 对比报告 + 调优 | 验证假设 |

## 18. 不做的（明确排除）

- 不做 TUI — 第一阶段只做 CLI 命令行交互
- 不做 checkpoint / undo — 依赖 `git diff` 手动回滚
- 不做 MCP 集成 — 纯文件系统输入
- 不做 subagent — 单任务串行执行
- 不做多模型切换 — 只接 DeepSeek
- 不做 VS Code 扩展 — 纯终端
- 不做 watch mode — 用户主动调用命令
- 不做 `.env` 自动加载 — 依赖 shell 环境变量

## 19. 当前实现状态（2026-05-02）

Spec 描述与实际代码的对照。标记说明：✅ 已完成 | 🔧 实现中 | 📋 计划中 | ❌ 未开始

### 19.1 核心模块

| 模块 | Spec 描述 | 实际状态 | 备注 |
|------|-----------|---------|------|
| `cli` — 6 个命令 | §8 | ✅ | `init/plan/patch/verify/repair/handoff` 全部可用 |
| `core/pipeline` | §3 | ✅ | Programmatic API：`runPlan/runPatch/runVerify/runRepair/runHandoff/runFullPipeline` |
| `core/task-state` | §9, §10 | ✅ | 完整状态机 + Zod schema + JSON 文件读写 |
| `core/context-builder` | §7.2 | ✅ | 四层上下文组装（Base/Repo/Task/Dynamic） |
| `core/prompt-builder` | §12 | ✅ | System prompt + 协议模板 + token 估算 |
| `core/patch-parser` | §7.3 | ✅ | CREATE/PATCH(ufiff+search)/INSERT/DELETE/RENAME + 三级宽松匹配 |
| `core/verifier` | §8.4 | ✅ | Shell 命令执行 + 结果捕获 |
| `core/repair-loop` | §8.5 | ✅ | 最多 N 轮 + 失败模式检测 + 智能 retry hints |
| `core/handoff-writer` | §8.6 | ✅ | Markdown + JSON 格式，含静态扫描摘要 |
| `core/failure-detector` | §7.4 | ✅ | 6 种失败模式：overconfidence/patch-drift/rule-blindness/scope-creep/hallucinated-api/search-replace-mismatch |
| `provider/client` | §14 | ✅ | DeepSeek 原生 API HTTP client + chat/chatStream |
| `provider/router` | §7.1 | ✅ | thinking/non-thinking 硬编码路由表 |
| `repo/scanner` | §8.1 | ✅ | 技术栈识别（TS/JS/Python/Go/Rust）+ 验证命令推断 + pnpm workspace 支持 |
| `repo/file-ranker` | §8.2 | ✅ | 关键词匹配 + 文件排序 |
| `repo/rule-loader` | §8.1 | ✅ | .cursorrules/CLAUDE.md/AGENTS.md/AIEF 规则加载 |
| `repo/git` | §7.2 | ✅ | git log/changed files/branch info |
| `repo/config-loader` | §11 | ✅ | `.dsh/config.yml` 读取 |

### 19.2 静态扫描治理

| 能力 | Plan Phase | 实际状态 | 备注 |
|------|-----------|---------|------|
| Post-patch 自动扫描 + Top N 修复 | Phase 1 | ✅ | `dsh patch`/`dsh repair` 后自动触发 |
| Finding parser 接口 | Phase 2 | ✅ | `StaticFindingParser { name, canParse, parse }` |
| ESLint stylish parser | Phase 2 | ✅ | |
| TypeScript diagnostics parser | Phase 2 | ✅ | |
| SARIF v2.1.0 parser（CodeQL + Gitleaks） | Phase 2 | ✅ | 自动检测工具名称 |
| Semgrep JSON parser | Phase 2 | ✅ | `semgrep --json` 输出标准化 |
| 完整 finding schema（severity + category 全级别） | Phase 2 | ✅ | `critical/high/error/medium/warning/low/info` × `bug/type/style/security/secret/dependency/unknown` |
| Text fallback parser | Phase 2 | ✅ | 非结构化输出的兜底处理 |
| Top N 选择策略完整化 | Phase 3 | 📋 | 当前为简化版（severity + changed file + scanner order），完整版见 static-scan-governance spec |
| Baseline 与新增问题区分 | Phase 4 | 📋 | 尚未实现 pre-scan/post-scan diff |
| 独立 `dsh scan` 命令 | Phase 5 | 📋 | 尚未实现，当前扫描仅作为 pipeline 步骤 |
| CI 产物上传 | Phase 6 | 📋 | 尚未实现 |
| 治理报告升级 | Phase 7 | 📋 | 尚未实现 |

### 19.3 评测体系

| 能力 | 状态 | 备注 |
|------|------|------|
| Benchmark runner（runTask/runAll） | ✅ | 多 repo 支持，git branch 隔离 |
| 10 维评分 | ✅ | |
| pi-* fixtures（Python） | ✅ | 5 个 |
| dsh-* fixtures（TypeScript self-hosting） | ✅ | 3 个（已创建，待执行） |
| task-* fixtures（通用） | ✅ | 20 个 |
| 基线对比（dsh vs OpenCode vs Claude Code） | 📋 | 首次 benchmark 已跑 4/5 pi-*，但未做跨工具对比 |
| 报告归档 | ✅ | `docs/superpowers/reports/<run-id>/` |

### 19.4 文档与项目治理

| 项目 | 状态 | 备注 |
|------|------|------|
| CLAUDE.md | ✅ | 2026-05-02 创建 |
| TASK-SPEC.md | ✅ | 2026-05-02 创建，定义任务格式与生命周期 |
| CI workflows（scan/codeql/gitleaks） | ✅ | |
| dsh 自身 config.yml 自洽性 | ✅ | 已修正为 typescript/pnpm |
| README.md | ❌ | 未创建 |
