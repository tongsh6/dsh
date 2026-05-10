# Task: 实现基于 Git Stash 的事务级回滚基础设施 (patch-loop-rollback-p1)

> 状态: Ready | 议题: PHASE-3-D | 负责人: dsh-agent

## 1. 任务背景

目前 Agent 在修复过程中一旦引入 Regression（通过 Delta Tracker 识别），系统只能给出文字建议要求其回滚。但模型由于 Context 压力，很难精准执行物理回滚。我们需要在底层实现自动化的、物理级别的“事务撤销”。

## 2. 目标

1.  在 `pipeline.ts` 的 Patch Loop 中，每轮代码修改前自动执行 Checkpoint（Stash 保存）。
2.  实现 `rollbackLastPatch` 逻辑，能够安全地将工作区恢复到上一个稳定状态。
3.  在 `repair-loop.ts` 中集成：当检测到 `Regression`（报错增量 > 0）时，自动执行物理回滚并通知 Agent。

## 3. 验收标准

- [ ] 每一轮产生 change 的 round，都会在 Git 中产生一个对应的临时 stash。
- [ ] 调用回滚函数后，工作区文件内容物理恢复，`git diff` 为空。
- [ ] 单元测试验证：模拟一个导致 Regression 的修改，确认系统能自动撤销该修改并进入下一轮修复。

## 4. 实施步骤

1.  **Git 操作封装**: 在 `@dsh/repo` 中增加 `createCheckpoint` 和 `applyRollback` 工具函数。
2.  **Pipeline 集成**: 修改 `runPatch` 和 `runRepairLoop`，在 `applyChanges` 之前执行 `stash`。
3.  **触发逻辑**: 更新 `repair-loop.ts`，捕获 `Regression` 信号后调用回滚。
4.  **测试**: 编写测试用例验证 Stash 栈的正确性。
