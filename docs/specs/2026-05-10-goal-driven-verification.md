# Spec: 目标驱动的自主验证策略 (Goal-Driven Verification)

> 状态: Draft | 日期: 2026-05-10 | 议题编号: PHASE-3-B

## 1. 背景与动机

目前 `dsh` 的验证高度依赖于 Fixture 中硬编码的 `verificationCommands`。Benchmark Runner 就像一个“报姆”，替 Agent 选好了最完美的测试指令（如 `mvn test -pl module -am`）。在真实场景中，这种预判是不存在的。

我们需要让 `dsh` 具备根据“验证目标”自主推导并修正“验证指令”的能力。

## 2. 核心设计

### 2.1 从指令到目标的协议演进
Fixture 协议将发生以下变化：

*   **废弃 (Deprecated)**: `verificationCommands` (硬编码 shell 数组)。
*   **新增 (New)**: `verificationGoal` (自然语言描述的目标)。
*   **新增 (New)**: `verificationCriteria` (结构化断言，用于最终评分，不对 Agent 公开)。

### 2.2 项目情报引擎 (Project Intelligence)
`dsh` 内部引入 Intelligence 模块，通过扫描根目录识别：
*   **Build Tool**: Maven, Gradle, NPM, PNPM, Pip.
*   **Test Runner**: JUnit, Vitest, Pytest, Jest.
*   **Path Mapping**: 识别源代码与测试代码的对应关系。

### 2.3 自主验证生命周期 (The Autonomous Loop)

1.  **推导 (Synthesize)**: Agent 根据 `verificationGoal` 和项目情报，自主生成第一版验证指令。
2.  **执行 (Execute)**: 运行指令。
3.  **诊断 (Diagnose)**: 
    *   如果是“环境类错误”（如找不到命令、依赖缺失），Agent 必须先执行修复动作（如 `mvn install`）。
    *   如果是“路径类错误”（如找不到测试类），Agent 必须通过 `find` 或 `grep` 修正指令。
4.  **收敛 (Converge)**: 只有当指令成功运行（无论测试通过与否）时，才认为验证策略成功。

## 3. 剥离计划

### Phase 1: 弱化指令引导
*   修改 `pipeline.ts`，不再将 `config.verify.commands` 直接喂给 Agent。
*   Prompt 调整：要求 Agent “通过查看项目文件自主决定如何验证你的修改”。

### Phase 2: 目标注入
*   在 `task-state` 中记录 `verificationGoal`。
*   Agent 在 `plan` 阶段必须输出 `<VERIFY_STRATEGY>` 块，描述它打算如何验证。

### Phase 3: Runner 彻底退役
*   Runner 仅负责将 Agent 丢入工作树。
*   配置文件中不再包含任何硬编码指令。

## 4. 风险评估
*   **Token 消耗**: Agent 可能会为了寻找正确的测试指令而进行多轮 `ls` 和 `grep`。
*   **评分挑战**: 如果 Agent 跑了错误的测试导致全绿通过，如何客观评测？（解法：Runner 依然在后台保留一套独立的、不可见的 `verificationCriteria` 用于客观打分）。
