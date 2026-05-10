# Task: 剥离 Benchmark Runner 的保姆动作 (dsh-autonomous-env-p1)

> 状态: Ready | 议题: PHASE-3-A | 负责人: dsh-agent

## 1. 任务背景

目前 `run-benchmark.ts` 在运行 Release Hub 相关任务前，会主动执行 `mvn install`。这虽然保证了环境可用，但违反了 Phase 3 关于 Agent 自主权的原则。我们需要剥离这些动作，让 `dsh` 在遇到编译错误时自主解决。

## 2. 目标

1.  清理 `run-benchmark.ts` 中的 Release Hub 硬编码初始化逻辑。
2.  确保 `dsh` 在没有预装依赖的情况下启动。
3.  验证 `dsh` 是否能通过 `exec_shell` 自主发现并运行 `mvn install`。

## 3. 验收标准

- [ ] `run-benchmark.ts` 不再包含特定于 release-hub 的 `mvn install` 调用。
- [ ] 在全新的 worktree 中运行 `rh-*` 任务，`dsh` 能看到依赖缺失报错。
- [ ] `dsh` 成功调用 `mvn install` 或类似的修复动作。
- [ ] 最终 `testsPassed` 结果不低于环境清理前的水平（允许短期波动）。

## 4. 实施步骤

1.  **代码清理**：移除 `run-benchmark.ts` 中用于 Release Hub 的初始化逻辑。
2.  **Prompt 增强**：在系统提示词中增加关于项目构建与依赖修复的元认知指令。
3.  **Benchmark 验证**：针对 `rh-bugfix-csv-export` 跑单例验证。
