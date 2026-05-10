# Spec: dsh 自主环境与验证管理 (Autonomous Env & Verification)

> 状态: Draft | 日期: 2026-05-10 | 议题编号: PHASE-3-A

## 1. 背景与动机

在 Phase 2 期间，Benchmark Runner 承担了大量“保姆式”的工作，包括环境初始化（`mvn install`）、依赖清理以及提供精确的验证指令。这虽然保证了基准测试的跑通，但也掩盖了 Agent 在真实开发环境中的“环境生存能力”短板。

进入 Phase 3（工具化），我们需要“剥离保姆层”，让 `dsh` 具备像真实开发者一样的自主权和鲁棒性。

## 2. 设计目标

1.  **环境自发现**：`dsh` 启动后应能识别项目类型（Maven, Pnpm, Python 等）。
2.  **环境自愈**：当验证因依赖缺失失败时，`dsh` 应能自主执行修复指令（如 `mvn install`）。
3.  **验证指令去硬编码**：Fixture 不再提供“唯一正确”的验证命令，而是提供“验证目标”，由 `dsh` 自主构造命令。
4.  **Runner 职责剥离**：Benchmark Runner 仅负责代码重置和沙箱启动。

## 3. 核心方案

### 3.1 预航检查 (Pre-flight Check)
在 `runPlan` 之后、`runPatch` 之前，引入一个新的可选阶段：`runPreflight`。
*   **动作**：Agent 被要求运行一次基础构建命令以确认环境可用。
*   **Prompt 调整**：告知模型当前工作目录的项目结构特征。

### 3.2 动态验证策略 (Dynamic Verification)
修改 `VerifyConfig` 协议，支持 `strategy` 模式：
*   **Legacy 模式**：沿用硬编码的 `commands`（用于向后兼容）。
*   **Autonomous 模式**：
    *   Fixture 只给出 `goal`（例如："Ensure that the circular dependency is broken"）。
    *   `dsh` 根据项目类型自动推导 `pnpm test` 或 `mvn test`。
    *   Agent 可以在 `repair-loop` 中根据输出自主添加 `-am` 或 `-pl` 等参数。

### 3.3 环境错误修复逻辑 (Env Repair)
在 `failure-detector.ts` 中新增环境故障模式识别：
*   **DEPENDENCY_MISSING**：识别到 `Could not resolve dependencies` 或 `Module not found`。
*   **修复引导**：在 Repair Hint 中明确建议执行 `install` 动作，并允许该动作不计入“代码修改”次数限制。

## 4. 实施路线图

### Task A-1: 剥离 Runner 的保姆动作
*   清理 `run-benchmark.ts` 中的 `mvn install` 等硬编码初始化动作。
*   Runner 仅负责 `git reset --hard`。

### Task A-2: 增强 Agent 的“环境生存”提示词
*   更新 `prompt-v04`，加入对 Maven/Pnpm 环境报错的常见处理知识。

### Task A-3: 实现 Pre-flight 状态机
*   在 `pipeline.ts` 中增加 `preflighting` 状态。
*   如果 Pre-flight 失败，允许 Agent 先进行环境补全。

## 5. 预期影响
*   **短期**：Benchmark 分数可能会因 Agent 无法适应“野外生存”而出现暂时性下跌。
*   **长期**：Agent 的通用性和对真实私有仓库的适应能力将大幅提升。
