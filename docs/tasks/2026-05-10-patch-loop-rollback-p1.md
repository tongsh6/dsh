# Task: 实现基于 Git Stash 的事务级回滚基础设施 (patch-loop-rollback-p1)

> 状态: Completed | 议题: PHASE-3-D | 负责人: dsh-agent

## 1. 任务背景

目前 Agent 在修复过程中一旦引入 Regression（通过 Delta Tracker 识别），系统只能给出文字建议要求其回滚。但模型由于 Context 压力，很难精准执行物理回滚。我们需要在底层实现自动化的、物理级别的“事务撤销”。

## 2. 目标

1.  在 `pipeline.ts` 的 Patch Loop 中，每轮代码修改前自动执行 Checkpoint（Stash 保存）。
2.  实现 `rollbackLastPatch` 逻辑，能够安全地将工作区恢复到上一个稳定状态。
3.  在 `repair-loop.ts` 中集成：当检测到 `Regression`（报错增量 > 0）时，自动执行物理回滚并通知 Agent。

## 3. 验收标准

- [x] 每一轮产生 change 的 round，都会在 Git 中产生一个对应的临时 stash。
- [x] 调用回滚函数后，工作区文件内容物理恢复，`git diff` 为空。
- [x] 单元测试验证：模拟一个导致 Regression 的修改，确认系统能自动撤销该修改并进入下一轮修复。

## 4. 实施步骤

1.  **Git 操作封装**: 在 `@dsh/repo` 中增加 `createCheckpoint` 和 `applyRollback` 工具函数。
2.  **Pipeline 集成**: 修改 `runPatch` 和 `runRepairLoop`，在 `applyChanges` 之前执行 `stash`。
3.  **触发逻辑**: 更新 `repair-loop.ts`，捕获 `Regression` 信号后调用回滚。
4.  **测试**: 编写测试用例验证 Stash 栈的正确性。

## 5. 验证记录

- 2026-05-12: `pnpm --filter @dsh/repo test` 通过；新增 checkpoint 回归测试覆盖 dirty worktree 不丢失、clean checkpoint 后失败变更可回滚。
- 2026-05-12: `pnpm --filter @dsh/core test` 通过；事务回滚测试覆盖 repair regression rollback。
- 2026-05-13: `pnpm run test`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run build` 通过；当前全量本地测试为 536 tests。
- 2026-05-12: loam smoke benchmark `docs/reports/runlogs/260512-225408/` 通过；`loam-docs-provider-readme` completed 1/1，testsPassed 1/1，score 99。
- 2026-05-12: rh smoke benchmark `docs/reports/runlogs/260512-230044/` 为 PARTIAL；`rh-bugfix-csv-export` completed 1/1，testsPassed 0/1，repairSuccess 0/1。已暴露两个后续 blocker：只改到测试文件未覆盖 `ExportAppService.java`；Maven `-Dtest=ExportAppServiceTest` 在无匹配测试模块触发 false fail。
- 2026-05-13: rh smoke blocker 系统性修复后重跑 `docs/reports/runlogs/260513-000650/` 仍为 PARTIAL，但问题已推进：`ExportAppService.java` 与 `ExportAppServiceTest.java` 均存在，结构化 Maven 验证运行；剩余失败为 `ExportAppService.java:[35,18] 需要';'` 编译错误，repairSuccess 仍为 0/1。
- 2026-05-13: 增强 repair 诊断链路：编译错误会注入失败文件行号附近源码上下文；Java 标识符搜索保持大小写并覆盖 `*.java`；benchmark `results.json` 保留完整 verify 输出与 patch 记录；repair prompt 禁止失败后无变更 `<DONE/>`。
- 2026-05-13: rh smoke `docs/reports/runlogs/260513-004744/` 仍为 PARTIAL；filesChanged 已正确覆盖 `ExportAppService.java` 与 `ExportAppServiceTest.java`，为后续完整诊断保留了基线。
- 2026-05-13: rh smoke `docs/reports/runlogs/260513-005751/` 仍为 PARTIAL；新增 diagnostics 显示真实失败为 `ExportAppServiceTest.java` 引用不存在的 `RunType.MERGE`，说明 repair 需要 Java enum/常量上下文。
- 2026-05-13: rh smoke `docs/reports/runlogs/260513-010904/` 仍为 PARTIAL；repair 已读取 `RunType.java`，但仍生成不存在的 `RunType.ORCHESTRATE`，说明需要禁止无效 no-op 终止并继续推动补丁收敛。
- 2026-05-13: rh smoke `docs/reports/runlogs/260513-011828/` 仍为 PARTIAL，但阶段性推进明显：patch loop DONE=✓，实际协议操作含 CREATE/PATCH/SEARCH_REPLACE，Maven 编译通过并进入测试运行；剩余失败为 `ExportAppServiceTest.createRunItem` 触发 `RunItem.rehydrate` / `BaseEntity` NPE，repairSuccess 仍为 0/1。
- 2026-05-13: 针对最新缺口增加 Java stacktrace frame 源码上下文注入测试与实现，覆盖 `at ...ExportAppServiceTest.createRunItem(ExportAppServiceTest.java:43)` 这类运行期失败定位。
- 2026-05-13: rh smoke `docs/reports/runlogs/260513-013656/` 通过；`rh-bugfix-csv-export` completed 1/1，testsPassed 1/1，repairSuccess 1/1，score 99。首轮结构化 Maven verify 暴露 `ExportAppServiceTest.shouldOutputEmptyFieldWhenFinalResultIsNull` 的 `ArrayIndexOutOfBoundsException`，repair 追加 `split(",", -1)` 测试补丁后第二轮 Maven verify 通过。
- Benchmark 全量验证待执行：rh blocker 已处理，下一步跑 24 fixture 全量确认 `testsPassed` / `repairSuccess` 净效应。
