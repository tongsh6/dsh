# Task: 弱化验证指令的显式引导 (goal-driven-verify-p1)

> 状态: Ready | 议题: PHASE-3-B | 负责人: dsh-agent

## 1. 任务背景

为了实现目标驱动验证，第一步是停止向 Agent 直接提供“喂饭式”的验证指令。我们需要修改代码，将原本注入系统的 `verify.commands` 隐藏，转而提示 Agent 自行发现。

## 2. 目标

1.  修改 `pipeline.ts`，在构建 Patch/Repair 阶段的 Prompt 时，不再包含从配置文件读取的显式验证命令。
2.  调整 Prompt 引导词，鼓励 Agent 利用 `exec_shell` 和项目文件（如 `package.json`, `pom.xml`）自主探索验证方式。
3.  保持系统底层 `runVerify` 逻辑不变（用于客观打分），但切断其与 Agent 的上下文联系。

## 3. 验收标准

- [ ] Agent 在 Patch Loop 中不再通过“上帝视角”知道完美的 `mvn test` 命令。
- [ ] 观察到 Agent 出现 `ls` 或 `read_file(package.json)` 来推导测试命令的行为。
- [ ] 针对一个 loam 任务跑测试，确认 Agent 能自主跑起 `pnpm test`。

## 4. 实施步骤

1.  **Context 剥离**：修改 `buildMessages` 或相关 Context Builder，确保 `config.verify.commands` 不进入 Prompt。
2.  **引导词注入**：在系统提示词中加入：“You are responsible for determining how to verify your code. Inspect the project structure to find the appropriate test commands.”
3.  **单例验证**：运行 `loam-docs-readme-distill-observability`。
