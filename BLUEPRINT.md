# DSH 产品蓝图 v1.6

> 状态: active | 最近同步: 2026-06-09
>
> 本文档描述 DSH 最终产品形态和分阶段演进路线。Spec/Plan/Task 三层文档均从本蓝图衍生。
>
> **关联文档:** CONSTITUTION.md（原则）| SPEC v0.3（当前架构）| TASK-SPEC.md（任务规范）

> **当前项目阶段:** Phase 4 Agent Loop 实施期。Phase 3 已于 2026-05-22 基于 N=3 replicated benchmark `260521151313` 退出：Project Card on `64/84 = 76.2%`，Pure Standard on `52/63 = 82.5%`，loamlog Project Card lift 为 `+8.3pp`。阶段性声明优先引用 `docs/reports/knowledge/20260522-phase3-exit-replicated-benchmark.md` 与本地 runlog 机器数据。

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
Phase 1                     Phase 2                     Phase 3
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ XML 协议解析      │    │ 工具化架构            │    │ 自导 Agent Loop      │
│ • 6 种操作块      │ →  │ • read_file 工具      │ →  │ • 模型自主选择工具     │
│ • 三级宽松匹配     │    │ • grep_files 工具     │    │ • 子任务分解+并行      │
│ • 大文件检测       │    │ • exec_shell 工具     │    │ • 多轮自我修正         │
│ • 静态扫描治理     │    │ • 工具结果注入上下文    │    │ • 工具调用审批门禁      │
└─────────────────┘    └─────────────────────┘    └─────────────────────┘
  模型被动"描述变更"      模型主动"调查→变更→验证"      模型自导"分解→执行→聚合"
```

**当前状态（Phase 4 启动，2026-05-22 后）**：Phase 3 的基础工具集、ProjectIntelligence 主路径、PatchCoverage 状态机、DSML salvage 与严格验证门禁已作为底座落地。Phase 4 当前主线是 Route X：把文件编辑从 content-XML 变更描述迁到 DeepSeek-native `apply_patch` 工具通道；第一版必须保留 content-XML 双轨回退。2026-06-11 targeted residual run `260611121509` 证明 residual slice 生效：Card ON 9/9、Card OFF 7/9，native apply error 9 -> 3，invalid native rounds 5 -> 2，content XML 为 0，`DONE` tool-call 残余消失。Route X 仍默认 off；下一步先收敛 provider-dedup Card OFF 的 2 个 `repair_exhausted`，再进入 broader/stability 复审和默认开启讨论。

**Phase 2 目标**：引入基础工具集（`read_file`、`grep_files`、`exec_shell`），让模型在生成 patch 前能先探索代码库。从"一次响应包含全部变更"升级为"多轮工具调用 + 最终变更"。

**Phase 3 目标**：完整的 Agent Loop——模型自主分解任务、调度子 Agent 并行执行、多轮自我修正。对标 DeepSeek-TUI 当前的 Agent 架构。

### 2.2 交互层 — 从无状态 CLI 到流式终端体验

```
Phase 1                     Phase 2                     Phase 3
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ 无状态 CLI        │    │ 流式 + 会话           │    │ 完整 TUI              │
│ • 8 个独立命令     │ →  │ • 流式输出 thinking    │ →  │ • 实时思考展示         │
│ • task-state.json │    │ • 会话持久化           │    │ • 键盘驱动交互         │
│ • 文件系统状态     │    │ • 断点续跑             │    │ • 内联 diff 审查       │
│                   │    │ • 进度反馈             │    │ • 模式切换(Plan/Agent) │
└─────────────────┘    └─────────────────────┘    └─────────────────────┘
  批处理，异步把关         在线参与，实时可见              交互式，沉浸体验
```

**当前状态（基础 CLI 已可用）**：CLI 命令每次独立调用，状态存 JSON 文件；`dsh run` / `dsh doctor` 已作为 Phase 3 退出条件通过测试。交互层增强仍是后续阶段，不能抢 Phase 4 执行引擎主线。

**Phase 2 目标**：CLI 保持可用，但增加流式输出（实时展示 thinking + patch 生成过程）和会话管理（跨命令保持上下文，支持断点续跑）。

**Phase 3 目标**：完整 TUI——对标 DeepSeek-TUI 的终端体验，但保持 DSH 的验证闭环差异化（TUI 中内联展示 verify 结果和 repair 进度）。

### 2.3 上下文管理 — 从静态装配到模型自管理

```
Phase 1                     Phase 2                     Phase 3
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
Phase 1                     Phase 2                     Phase 3
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
Phase 1                     Phase 2                     Phase 3
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│ 基础 Benchmark   │    │ 多维度系统化评测        │    │ 持续评测平台          │
│ • 41 个 fixture  │ →  │ • 多语言(TS/Java/Py)  │ →  │ • 统计显著性           │
│ • 10 维评分       │    │ • 多工具对比自动化      │    │ • 回归自动检测         │
│ • 单 repo 串行    │    │ • 成本/Token 追踪      │    │ • 协议升级门禁         │
│ • 手动对比报告    │    │ • 失败分类统计          │    │ • 公开 Benchmark 榜   │
└─────────────────┘    └─────────────────────┘    └─────────────────────┘
  可跑，数据少             可对比，覆盖广                 可量化，持续监控
```

**Phase 2.5 严肃实证方法论（2026-05-15 v1.1）**：LLM benchmark 属于随机系统评测，不能用单次运行或固定 `testsPassed ±2` 当作行为验收。任何用于证明核心能力提升、退化或 Phase 退出的 benchmark，最低标准是：

1. **重复采样**：同一配置至少 N≥3 replication；如果对比两个策略，采用 randomized A/B 交错运行，避免时间、缓存和环境顺序偏差。
2. **严格清理**：每个 trial 前执行 hard cleanup，清除工作区、`.dsh` 状态、构建产物和 fixture 残留；清理策略必须写入报告，避免 state leak 被误判为模型能力。
3. **双层判定**：总通过数不得低于 baseline；单 fixture pass rate 用 Wilson 95% CI 判断是否出现显著退化。高方差 fixture（pass rate 约 25%–75%）单独标注，不作为普通退化直接归因。
4. **证据归档**：报告必须记录 baseline、样本量、随机化方式、清理策略、结论和下一步。阶段性声明优先引用 `docs/reports/knowledge/` 下的归档报告，而不是单个 runlog。

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

**当前实现状态（2026-05-22 后）**：ProjectIntelligence 已通过 Phase 3 退出门禁。`scanner.ts` 已退役，生产路径通过 `assembleIntelligence` 生成 `ProjectIntelligence`；`init` 使用 `pickVerifyPlan` 投影验证命令；`pipeline` 通过 `generateRepoContext(cwd, pi)` 注入 RepoContext；LLM 上下文默认包含 Project Card，并可通过 `DSH_INJECT_PROJECT_CARD=false` 做 A/B。

**Phase 1 目标（已完成）**：消除 3 个已知危险默认推断；引入最小的 `ProjectIntelligence` 抽象（Fact / Candidate / Decision / Capability 四模型），通过 `toLegacyTechStack` 投影兼容现有调用链路。新增 `toProjectCard` 给 LLM 注入"已知 / 未知 / 禁止推断"的结构化上下文。

**Phase 2 目标（已完成）**：完整 Fact 收集器（文件系统 + 构建描述符 + wrapper 脚本 + 源码语法版本推断）；Candidate 生成器实现多候选排序 + 置信度计算；`dsh doctor` 命令输出候选判断和能力状态；`.dsh/project.yml` 人工确认层。

**Phase 3 目标（已完成）**：`detectVerifyCommands` 退役，verify plan 从 `ProjectCapability` 推导；项目识别统一由 `assembleIntelligence` 驱动；LLM context 统一使用 Project Card。后续 verify plan 精细化属于独立增强，不再作为 Phase 3 退出 blocker。

**与主阶段的关系**：本维度是横切关注点——Phase 1 止血与 Phase 3（工具化）并行推进，Phase 2 与 Phase 4（Agent Loop）重叠。它不是独立的 Phase 8，而是对现有 scanner/verify/context 三个模块的渐进式加固。

---

## 3. 阶段划分与优先级逻辑

### 阶段概览

| 阶段 | 名称 | 目标 | 预计 |
|------|------|------|------|
| **Phase 1** | 核心闭环（MVP） | Plan→Patch→Verify→Repair→Handoff 跑通 | ✅ 已完成 |
| **Phase 2** | 协议+评测完善 | Patch 协议升级（v0.4）、评测体系建立、静态扫描治理 | ✅ 已完成（2026-05-08，详见 `docs/reports/phase-2-exit-review.md` §5.7） |
| **Phase 3** | 工具化收口验证 | 引入基础工具集（read_file/grep/exec_shell），模型从"闭眼出 patch"升级为"先探索再修改" | ✅ 已完成（2026-05-22，`260521151313` N=3 replicated benchmark） |
| **Phase 4** | Agent Loop | Route X `apply_patch` 工具通道、多轮工具调用、模型自主分解任务、repair 内联到 patch 阶段 | 🔧 实施中 |
| **Phase 5** | 流式+会话 | 流式输出、会话持久化、断点续跑 | 📋 |
| **Phase 6** | TUI | 完整终端交互体验 | 📋 |
| **Phase 7** | 生态扩展 | MCP、子 Agent、多 Provider | 📋 |

### 为什么是这个顺序

每个阶段的顺序由两个原则决定：

1. **前置依赖** — 后续阶段依赖前一阶段的产出。Phase 3（工具化）依赖 Phase 2 的评测体系来验证"工具化是否提升了成功率"。Phase 4（Agent Loop）依赖 Phase 3 的工具集。Phase 6（TUI）依赖 Phase 4 的 Agent Loop。

2. **先验证核心假设，再扩展范围** — Phase 2 的评测体系必须先建立，因为后续每个阶段的优化都必须用 benchmark 数据证明"确实变好了"（CONSTITUTION 原则 5）。没有评测数据，所有优化都是"我觉得"。

### Phase 3 退出条件（已满足 — 2026-05-22）

Phase 3 已退出，证据来自本地机器 runlog `docs/reports/runlogs/260521151313-pie-replicated/`（168 trials）和归档知识报告 `docs/reports/knowledge/20260522-phase3-exit-replicated-benchmark.md`：

- [x] **ProjectIntelligence 唯一主路径** — `init` / `pipeline` / context builder 均通过 `assembleIntelligence`、`generateRepoContext`、Project Card 工作；`suggest` 只作为候选，不能投影成确定事实。
- [x] **入口文档状态一致** — README / BLUEPRINT / project-ledger 描述为 Phase 4 实施期，并把 Phase 3 benchmark 作为归档 evidence，而不是当前 blocker。
- [x] **最新 N=3 replicated benchmark 达标** — `260521151313`：Project Card on `64/84 = 76.2%`，Pure Standard on `52/63 = 82.5%`；loamlog on `20/24 = 83.3%` vs off `18/24 = 75.0%`。
- [x] **hard-fail / high-variance fixture 经复审分流** — failure matrix 保留 `exclude_from_phase3_exit` / `label_required` 治理标签，高方差与 split fixture 单独报告，不作为单 fixture 硬门禁。
- [x] **failure matrix 机器可读** — `packages/eval/src/failure-matrix.json` 可被测试校验，并可被 benchmark metadata 读取。
- [x] **legacy scanner 防回流** — 生产路径不得 import 或调用旧 `detectTechStack` / `detectVerifyCommands`，并有自动化测试防止回流。
- [x] **最小产品入口可用** — `dsh run` / `dsh doctor` 通过 CLI 测试，并能展示 ProjectIntelligence / Project Card 相关状态。
- [x] **质量门禁通过** — build / typecheck / lint / test / scan 作为阶段退出门禁通过；后续代码改动仍需按变更范围重新验证。

Phase 4 已可进入正式实现，但每个实施切片仍必须遵守 Spec → Plan → Task、原则 5 的 benchmark 证据、原则 7.2 的边界约束和原则 9 的无临时手段。

### Phase 4 当前实施约束

- **Route X 先行**：`docs/specs/2026-05-20-edits-as-native-tool.md` 是当前执行引擎主线；最小 runtime 切片、native edit prompt contract、停滞保护、参数兼容与 native observability 已完成，targeted successful-apply adoption evidence 已成立。下一步是 broader/stability evidence 与 invalid/error 收敛，而不是直接默认开启。
- **双轨可回退**：第一版 `apply_patch` 工具通道不得物理删除 content-XML 协议；迁移率和退役条件必须由 A/B benchmark 决定，且 benchmark 必须区分"flag 暴露"与"native tool_call 实际采用"。
- **不以系统代写业务代码作为能力证据**：repair 收敛必须回到编排、上下文、工具通道、prompt、轮次策略和验证反馈，不得恢复默认 code-result deterministic repair。

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
| **无临时手段** | 开发阶段没有时间压力；所有修复必须面向长期正确性，不能用临时关闭、fixture 特判、硬编码或 prompt 特判替代根因修复 |

---

## 5. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-02 | v1.0 | 初始蓝图：产品形态、5 个维度演进路线、7 阶段划分 |
| 2026-05-05 | v1.1 | Phase 2 退出条件追加「长期跟踪事项复审」checkbox；新增 §3.1 Phase 退出复审协议（依据 CONSTITUTION v1.1 原则 8） |
| 2026-05-18 | v1.2 | Phase 3 退出条件 B 改为「hard-fail / high-variance fixture 经复审分流」，与 §2.5 高方差方法论对齐：复审后落入 25%–75% 区间的 fixture 标注为 high-variance 并单独报告，不作单 fixture 硬门禁；Phase 3 退出以聚合 `testsPassed >60%` 为准 |
| 2026-05-21 | v1.3 | 架构原则摘录同步 CONSTITUTION v1.3 原则 9「无临时手段」 |
| 2026-06-09 | v1.4 | 同步 2026-05-22 Phase 3 退出事实与 Phase 4 实施期状态；Phase 3 退出条件改为已满足，新增 Phase 4 当前实施约束 |
| 2026-06-09 | v1.5 | 同步 Route X flag-exposure A/B:开启工具暴露不退化但 native `apply_patch` tool_calls=0；Phase 4 下一步改为 native tool adoption evidence |
| 2026-06-09 | v1.6 | 同步 native edit prompt contract 与停滞保护：flag-on patch prompt 要求 `apply_patch`，探索停滞后仅保留编辑工具；证据仍待 targeted A/B 重跑 |
| 2026-06-09 | v1.7 | 同步 post-prompt A/B：native attempts 已出现但 9 轮均 invalid，flag-on 17/18 vs baseline 18/18；补参数兼容与 native observability，默认仍 off，等待复验 |
| 2026-06-10 | v1.8 | 同步 post-compat targeted A/B：baseline 与 flag-on 均 17/18，flag-on 72 次 `apply_patch` tool call、68 条 successful native apply、content XML 为 0；默认仍 off，下一步 broader/stability |
| 2026-06-10 | v1.9 | 同步 post-build telemetry rerun：flag-on `260610153758` 为 18/18，76 次 `apply_patch` tool call、67 条 successful native apply、5 个 invalid native rounds 且参数形态可审；默认仍 off |
| 2026-06-11 | v1.10 | 同步 residual error-class slice：native apply 失败返回 `error_class` / hint，`DONE` tool-call 识别为完成意图；本地 scan 通过，DeepSeek targeted 复跑待外部数据传输风险授权 |
| 2026-06-11 | v1.11 | 同步 targeted residual run `260611121509`：Card ON 9/9、Card OFF 7/9，native apply error 9 -> 3、invalid native rounds 5 -> 2，provider-dedup Card OFF 仍有 2 个 repair_exhausted；默认仍 off |
