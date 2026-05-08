# DSH 产品蓝图 v1.0

> 状态: active | 日期: 2026-05-02
>
> 本文档描述 DSH 最终产品形态和分阶段演进路线。Spec/Plan/Task 三层文档均从本蓝图衍生。
>
> **关联文档:** CONSTITUTION.md（原则）| SPEC v0.3（当前架构）| TASK-SPEC.md（任务规范）

## 1. 最终产品形态

### 一句话定位

**DeepSeek 原生 Coding Agent**——一个围绕 DeepSeek 模型行为深度优化的终端编程助手，覆盖从任务理解、代码生成、验证修复到知识沉淀的完整闭环。

### 核心用户场景

1. **交互式编程** — 开发者在终端中描述任务，Agent 实时分析代码库、生成变更、运行验证、自我修复，开发者全程可见可干预
2. **自动化流水线** — CI 中自动修复 lint/type/test 问题，生成可审计的修复记录，PR 中展示治理报告
3. **批量评测对比** — 在多语言多仓库上系统化评测 DeepSeek 的代码生成质量，与基线工具持续对比

### 能力全景图

```
┌─────────────────────────────────────────────────────────────┐
│                      交互层 (Interaction)                     │
│  CLI 命令  →  流式输出  →  TUI（实时思考+会话管理）            │
├─────────────────────────────────────────────────────────────┤
│                      编排层 (Orchestration)                    │
│  Pipeline  →  Agent Loop  →  子Agent并行调度                  │
├─────────────────────────────────────────────────────────────┤
│                      工具层 (Tool System)                      │
│  文件操作  →  代码搜索  →  Shell执行  →  Git操作  →  MCP     │
├─────────────────────────────────────────────────────────────┤
│                      执行层 (Execution Engine)                 │
│  协议解析  →  上下文装配  →  验证闭环  →  修复引擎  →  静态治理 │
├─────────────────────────────────────────────────────────────┤
│                      数据层 (Data & Persistence)               │
│  任务状态  →  会话历史  →  评测结果  →  知识沉淀               │
└─────────────────────────────────────────────────────────────┘
```

### 竞品参照系

| 项目 | 定位 | 与 DSH 的关系 |
|------|------|--------------|
| **DeepSeek-TUI** | Rust + TUI，模型主导的交互式 Agent | **同一赛道**。DSH 从执行质量切入，DS-TUI 从交互体验切入 |
| **Claude Code** | Claude 专属，完整 Agent 产品 | **同类标杆**。DSH 之于 DeepSeek ≈ CC 之于 Claude |
| **OpenCode** | 通用多模型 CLI Agent | DSH 不做通用的多模型适配，聚焦 DeepSeek 深度优化 |
| **Aider** | Python + Git，多模型，侧重 diff 编辑 | DSH 的 patch 协议参考其 Search/Replace 格式，但做了 DeepSeek 专属调整 |

---

## 2. 分维度演进路线

### 2.1 执行引擎 — 从协议解析到智能工具调用

```
Phase 1 (当前)              Phase 2                     Phase 3
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ XML 协议解析      │    │ 工具化架构            │    │ 自导 Agent Loop      │
│ • 6 种操作块      │ →  │ • read_file 工具      │ →  │ • 模型自主选择工具     │
│ • 三级宽松匹配     │    │ • grep_files 工具     │    │ • 子任务分解+并行      │
│ • 大文件检测       │    │ • exec_shell 工具     │    │ • 多轮自我修正         │
│ • 静态扫描治理     │    │ • 工具结果注入上下文    │    │ • 工具调用审批门禁      │
└─────────────────┘    └─────────────────────┘    └─────────────────────┘
  模型被动"描述变更"      模型主动"调查→变更→验证"      模型自导"分解→执行→聚合"
```

**当前状态（Phase 1）**：模型在一个响应中输出所有变更描述（XML 块），系统解析并应用。问题是模型在"闭眼出 patch"——没看过文件就生成 diff。

**Phase 2 目标**：引入基础工具集（`read_file`、`grep_files`、`exec_shell`），让模型在生成 patch 前能先探索代码库。从"一次响应包含全部变更"升级为"多轮工具调用 + 最终变更"。

**Phase 3 目标**：完整的 Agent Loop——模型自主分解任务、调度子 Agent 并行执行、多轮自我修正。对标 DeepSeek-TUI 当前的 Agent 架构。

### 2.2 交互层 — 从无状态 CLI 到流式终端体验

```
Phase 1 (当前)              Phase 2                     Phase 3
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ 无状态 CLI        │    │ 流式 + 会话           │    │ 完整 TUI              │
│ • 6 个独立命令     │ →  │ • 流式输出 thinking    │ →  │ • 实时思考展示         │
│ • task-state.json │    │ • 会话持久化           │    │ • 键盘驱动交互         │
│ • 文件系统状态     │    │ • 断点续跑             │    │ • 内联 diff 审查       │
│                   │    │ • 进度反馈             │    │ • 模式切换(Plan/Agent) │
└─────────────────┘    └─────────────────────┘    └─────────────────────┘
  批处理，异步把关         在线参与，实时可见              交互式，沉浸体验
```

**当前状态（Phase 1）**：CLI 命令每次独立调用，状态存 JSON 文件。适合 CI/自动化场景，不适合日常开发。

**Phase 2 目标**：CLI 保持可用，但增加流式输出（实时展示 thinking + patch 生成过程）和会话管理（跨命令保持上下文，支持断点续跑）。

**Phase 3 目标**：完整 TUI——对标 DeepSeek-TUI 的终端体验，但保持 DSH 的验证闭环差异化（TUI 中内联展示 verify 结果和 repair 进度）。

### 2.3 上下文管理 — 从静态装配到模型自管理

```
Phase 1 (当前)              Phase 2                     Phase 3
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ 4 层静态装配      │    │ 动态上下文            │    │ 模型自管理            │
│ • Base/Repo/     │ →  │ • 工具调用结果注入      │ →  │ • V4 降级曲线认知      │
│   Task/Dynamic   │    │ • Working set 跟踪     │    │ • Cycle 检查点重启     │
│ • file-ranker    │    │ • 按需加载文件          │    │ • Thinking budget    │
│   top 10         │    │ • 上下文 budget 控制    │    │ • 上下文层缝合         │
└─────────────────┘    └─────────────────────┘    └─────────────────────┘
  预装配，一次性加载        按需扩展，budget 感知           模型自感知，主动管理
```

**Phase 2 目标**：上下文不再是"一次装配、全程不变"，而是根据工具调用结果动态扩展。模型调了 `read_file` → 内容进入上下文；调了 `grep_files` → 搜索结果进入上下文。同时引入上下文 budget 控制（类似 DeepSeek-TUI 的 cycle restart）。

**Phase 3 目标**：在系统 prompt 中教给模型 V4 的上下文特性（降级曲线、缓存经济、thinking budget），让模型主动管理自己的上下文窗口。

### 2.4 验证体系 — 从 Shell 命令到智能守护

```
Phase 1 (当前)              Phase 2                     Phase 3
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ Shell 命令验证    │    │ 多维度质量门禁         │    │ 智能质量守护          │
│ • test/lint/     │ →  │ • LSP 诊断注入         │ →  │ • Pre-patch baseline │
│   typecheck     │    │ • Pre-scan baseline    │    │ • 增量问题优先         │
│ • 静态扫描后置    │    │ • 历史 vs 新增区分      │    │ • 自动 replan         │
│ • Top N 修复     │    │ • 独立 dsh scan 命令   │    │ • CI 产物+PR 摘要     │
└─────────────────┘    └─────────────────────┘    └─────────────────────┘
  被动执行，二元结果        主动诊断，分类治理              持续守护，自动响应
```

### 2.5 评测体系 — 从单仓库到系统化对比

```
Phase 1 (当前)              Phase 2                     Phase 3
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ 基础 Benchmark   │    │ 多维度系统化评测        │    │ 持续评测平台          │
│ • 41 个 fixture  │ →  │ • 多语言(TS/Java/Py)  │ →  │ • 统计显著性           │
│ • 10 维评分       │    │ • 多工具对比自动化      │    │ • 回归自动检测         │
│ • 单 repo 串行    │    │ • 成本/Token 追踪      │    │ • 协议升级门禁         │
│ • 手动对比报告    │    │ • 失败分类统计          │    │ • 公开 Benchmark 榜   │
└─────────────────┘    └─────────────────────┘    └─────────────────────┘
  可跑，数据少             可对比，覆盖广                 可量化，持续监控
```

### 2.6 项目识别 — 从结论型推断到证据驱动决策

```
Phase 1 (止血)              Phase 2 (模型)              Phase 3 (替换)
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ 消除危险默认推断   │    │ Fact → Candidate     │    │ 完整决策管道          │
│ • 弱推断不再伪装    │ →  │   → Decision 模型    │ →  │ • verify 从 Capability│
│   成事实          │    │ • 安全 Probe 框架     │    │   推导而非 language   │
│ • 引入最小的       │    │ • Project Card       │    │   → command 硬映射    │
│   Intelligence   │    │   给 LLM 使用         │    │ • scanner 内部改为    │
│   模型           │    │ • doctor 命令         │    │   Intelligence 驱动  │
│ • 3 个已知 bug    │    │ • 候选置信度决策       │    │ • .dsh/project.yml   │
│   立即修复        │    │ • capabilities 推导   │    │   人工确认层          │
└─────────────────┘    └─────────────────────┘    └─────────────────────┘
 「确定」vs「不确定」      「不确定 → 候选 + 探测」         Intelligence 是项目
 不再是一刀切                                   事实的单一真相源
```

**核心理念**：DSH 不应把弱推断伪装成事实；但必须把弱推断转化为候选、探测和建议。

当前 `scanner.ts` 的 `detectTechStack` + `detectVerifyCommands` 存在一类系统性缺陷：**把关联关系当成等价关系**。看到 `.java` 文件 → 推断 Maven；看到 `.py` 文件 → 推断 pip；packageManager 为 null 时 verify 命令默认 Maven。这些不是"识别"，而是"猜测并假装确定"。

**Phase 1 目标（当前立即执行）**：消除 3 个已知危险默认推断；引入最小的 `ProjectIntelligence` 抽象（Fact / Candidate / Decision / Capability 四模型），通过 `toLegacyTechStack` 投影兼容现有调用链路。新增 `toProjectCard` 给 LLM 注入"已知 / 未知 / 禁止推断"的结构化上下文。

**Phase 2 目标**：完整 Fact 收集器（文件系统 + 构建描述符 + wrapper 脚本 + 源码语法版本推断）；Candidate 生成器实现多候选排序 + 置信度计算；`dsh doctor` 命令输出候选判断和能力状态；`.dsh/project.yml` 人工确认层。

**Phase 3 目标**：`detectVerifyCommands` 退役，verify plan 从 `ProjectCapability` 推导；scanner 内部改为 `assembleIntelligence` 驱动；LLM context 统一使用 Project Card。

**与主阶段的关系**：本维度是横切关注点——Phase 1 止血与 Phase 3（工具化）并行推进，Phase 2 与 Phase 4（Agent Loop）重叠。它不是独立的 Phase 8，而是对现有 scanner/verify/context 三个模块的渐进式加固。

---

## 3. 阶段划分与优先级逻辑

### 阶段概览

| 阶段 | 名称 | 目标 | 预计 |
|------|------|------|------|
| **Phase 1** | 核心闭环（MVP） | Plan→Patch→Verify→Repair→Handoff 跑通 | ✅ 已完成 |
| **Phase 2** | 协议+评测完善 | Patch 协议升级（v0.4）、评测体系建立、静态扫描治理 | ✅ 已完成（2026-05-08，详见 `docs/reports/phase-2-exit-review.md` §5.7） |
| **Phase 3** | 工具化 | 引入基础工具集（read_file/grep/exec_shell），模型从"闭眼出 patch"升级为"先探索再修改" | 🔧 进行中 |
| **Phase 4** | Agent Loop | 多轮工具调用、模型自主分解任务、repair 内联到 patch 阶段 | 📋 |
| **Phase 5** | 流式+会话 | 流式输出、会话持久化、断点续跑 | 📋 |
| **Phase 6** | TUI | 完整终端交互体验 | 📋 |
| **Phase 7** | 生态扩展 | MCP、子 Agent、多 Provider | 📋 |

### 为什么是这个顺序

每个阶段的顺序由两个原则决定：

1. **前置依赖** — 后续阶段依赖前一阶段的产出。Phase 3（工具化）依赖 Phase 2 的评测体系来验证"工具化是否提升了成功率"。Phase 4（Agent Loop）依赖 Phase 3 的工具集。Phase 6（TUI）依赖 Phase 4 的 Agent Loop。

2. **先验证核心假设，再扩展范围** — Phase 2 的评测体系必须先建立，因为后续每个阶段的优化都必须用 benchmark 数据证明"确实变好了"（CONSTITUTION 原则 5）。没有评测数据，所有优化都是"我觉得"。

### Phase 2 退出条件（已全部勾选 — 2026-05-08）

每个条件含阈值和数据来源，可逐项验证。

- [x] **v0.4 协议操作覆盖率** — 6 种操作（CREATE/PATCH/SEARCH_REPLACE/INSERT/DELETE/RENAME）每种 ≥3 个 fixture 标注预期触发，且 ≥1 个 fixture 实际触发并记录成功率。数据来源：`formatEvaluationReport` 输出的 Protocol Operation Coverage 表（`docs/reports/260508-003359/`：6/6 全达标）
- [x] **多语言** — Python（pi-proof-forge）≥3 + TypeScript（loamlog）≥3 + Java+Vue 混合（release-hub 后端 Java + 前端 Vue）≥3 个 fixture 执行通过。数据来源：benchmark 报告 Per-Task Detail（pi 4/7、loam 3/8、rh Java+Vue 4/9）
- [x] **多仓库** — ≥3 个不同 repo 上有 ≥3 个 fixture 执行通过。数据来源：benchmark 报告
- [x] **完成率** — ≥10 个 fixture 完成率 >60%。数据来源：benchmark 报告 Overview。**字段口径**：双口径制（决议 2026-05-08 见 `phase-2-exit-review.md` §5.7）—— Phase 2 退出按 `completed=24/24=100%` 满足；`testsPassed=11/24=45%` 作为 Phase 3 起点 baseline
- [x] **静态扫描治理 Phase 2-3** — 完整 finding schema（Phase 2 ✅）+ Top N 可解释选择（Phase 3：`static-topn.ts` 存在，支持多维 scoring + 选择理由记录）。数据来源：`packages/core/src/static-topn.ts` 文件存在 + 测试通过
- [x] **跨工具对比** — ≥5 个相同 fixture 的 DSH vs OpenCode 对比数据产出。Claude Code 对比为 Phase 3 目标。数据来源：`docs/reports/oc-motf4q7b/dsh-vs-opencode-comparison.md`
- [x] **对比报告** — 首份正式 DSH Evaluation Report v1.0，含协议操作分类统计。数据来源：`docs/reports/` 下归档报告
- [x] **长期跟踪事项复审** — 遍历 `docs/project-ledger.md` §8 全部条目，对每个 status=waiting 的事项做出决策（promote 为 ready task / 继续延后 / cancel）；复审记录归档到 `docs/reports/phase-2-exit-review.md`（v1 + v2 两轮复审完成）。详见 §3.1 Phase 退出复审协议。数据来源：`docs/project-ledger.md` §8 + 归档复审报告

### 3.1 Phase 退出复审协议

每个 Phase 退出条件中含「长期跟踪事项复审」checkbox（治理依据：CONSTITUTION 原则 8）。复审流程：

1. 遍历 `docs/project-ledger.md` §8 全部 status=waiting 条目
2. 对每条做出决策之一：
   - **trigger 已满足** → status 转 `ready`，并创建对应 task 卡片到 `docs/tasks/`
   - **trigger 未满足** → 仅更新 `last_reviewed` 为本次复审日期
   - **已被 superseded**（被新 spec / 新条目替代）→ status 转 `cancelled`，备注新替代条目 id
3. 复审记录归档到 `docs/reports/phase-X-exit-review.md`，列出本次决策矩阵（事项 id / 决策 / 理由）
4. 该 checkbox 仅在所有 waiting 条目都被处理后才能勾选

复审节奏：每 Phase 退出时强制触发；日常无强制频率，但 CI（`scripts/check-tracked-items.ts`）对 last_reviewed > 90 天的条目发出 warn。

---

## 4. 架构原则（摘录自 CONSTITUTION.md）

> 完整原则见 CONSTITUTION.md。此处仅引用与蓝图直接相关的部分。

| 原则 | 对蓝图的影响 |
|------|-------------|
| **设计文档先行** | 每个新阶段必须有 Spec → Plan → Task 后才实施 |
| **验证闭环** | 交互层无论多丰富，verify 永远是必须经过的门禁 |
| **实证驱动** | Phase 3-7 每步升级都用 benchmark 数据证明效果 |
| **DeepSeek 原生** | 所有优化围绕 DeepSeek 模型行为，不考虑通用适配 |
| **文件系统是 API** | Phase 7 的 MCP 是可选扩展，核心能力始终通过文件系统对接 |

---

## 5. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-02 | v1.0 | 初始蓝图：产品形态、5 个维度演进路线、7 阶段划分 |
| 2026-05-05 | v1.1 | Phase 2 退出条件追加「长期跟踪事项复审」checkbox；新增 §3.1 Phase 退出复审协议（依据 CONSTITUTION v1.1 原则 8） |
