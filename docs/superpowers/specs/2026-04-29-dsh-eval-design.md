# DSH Phase 5-6 Eval System Design v0.1

> 状态: draft | 日期: 2026-04-29 | 依赖: [dsh-design](./2026-04-29-dsh-design.md)

## 1. 目标

实现 dsh 评测系统的端到端能力，使得可以针对真实代码仓库执行自动化 benchmark，产出可对比的评分报告。

## 2. 非目标

- 不支持多 repo 并行测试（Phase 1 单 repo 串行）
- 不实现 OpenCode/Claude Code 的自动化调用（对比数据手工收集或下一阶段）

## 3. 核心变更

### 3.1 新增 `pipeline.ts` — Programmatic API

将 CLI 命令中的核心逻辑抽取到 `packages/core/src/pipeline.ts`，暴露可复用的函数：

```
runPlan(params)    → Promise<TaskState>
runPatch(params)   → Promise<TaskState>
runVerify(params)  → Promise<TaskState>
runRepair(params)  → Promise<TaskState>
runHandoff(params) → Promise<string>

runFullPipeline(params) → Promise<TaskState>
  // 依次调用 Plan → Patch → Verify → (if failed) Repair → Handoff
```

CLI 命令文件重构为薄层：解析参数 → 初始化 DeepSeekClient → 调用 pipeline 函数 → 打印结果。CLI 和 benchmark runner 共用同一套 API。

### 3.2 Benchmark Runner

`packages/eval/src/benchmark-runner.ts` 新增：

**runTask(fixture, repoPath, client):**

```
1. git checkout main
2. git branch -D dsh-bench-{taskId} (清理上次)
3. git checkout -b dsh-bench-{taskId}
4. dsh init (生成 .dsh/config.yml)
5. dsh plan "{taskPrompt}" --type {category}   → 记录结果
6. dsh patch --auto                              → 记录结果
7. dsh verify --all                              → 记录结果
8. if 验证失败: dsh repair --rounds {maxRepairRounds} → 记录修复历史
9. dsh handoff                                   → 记录 handoff 质量
10. 汇总 TaskResult (10 维评分)
```

**runAll(fixtures[], repoPath, client):**

```
for each fixture:
  runTask(fixture, repoPath, client)
  git reset --hard && git checkout main  // 重置环境
汇总 → 评分 → ComparisonReport
```

每个 task 在独立 git branch 上执行，完成后切回 main 重置，同一本地仓库即复用的隔离方式。

### 3.3 Fixture 设计

使用 `https://github.com/tongsh6/pi-proof-forge` 作为测试仓库，从 main 检出新分支执行。

5 个 fixture：

| # | ID | 类型 | 任务 | 关键文件 | 验证命令 |
|---|-----|------|------|---------|---------|
| 1 | pi-bugfix-count-defs | bugfix | `check_v2_constraints.py` 的 `count_definitions()` 使用 `str.count()` 朴素子串匹配，会错误匹配注释/docstring/字符串字面量中的函数签名。改为 `re.findall(r'^def signature\(', text, re.MULTILINE)` 精确匹配 | tools/check_v2_constraints.py | `python3 -m pytest tests/unit/domain/test_check_v2_constraints.py` |
| 2 | pi-test-error-handler | test | `tests/unit/domain/test_error_handler.py` 只有 2 个测试，缺少 `PolicyError`（被 20+ 处使用）和 `FabricationGuardError` 的测试覆盖。补充缺失的分支覆盖 | tests/unit/domain/test_error_handler.py | `python3 -m pytest tests/unit/domain/test_error_handler.py -v` |
| 3 | pi-refactor-read-text | refactor | `extract_evidence.py` 和 `extract_evidence_llm.py` 各自实现了完全相同的 `read_text()` 函数。提取到 `tools/infra/file_io.py`，两边改为 import | tools/extract_evidence.py, tools/extract_evidence_llm.py, tools/infra/file_io.py(new) | `python3 -m pytest tests/unit/domain/test_evidence_engines.py -v` |
| 4 | pi-test-aief-l3 | test | `tools/check_aief_l3.py` 完全没有任何测试。创建 `tests/unit/domain/test_check_aief_l3.py`，用 tmp_path fixture 验证 `check_exists`、`check_contains`、`check_min_files` 三个函数 | tests/unit/domain/test_check_aief_l3.py(new) | `python3 -m pytest tests/unit/domain/test_check_aief_l3.py -v` |
| 5 | pi-docs-check-tools | docs | `tools/README.md` 缺少 `check_v2_constraints.py` 和 `check_submission_readiness.py` 的使用说明。补充参数说明和示例 | tools/README.md | `python3 tools/check_v2_constraints.py --root .` 或 `python3 tools/check_submission_readiness.py --help` |

**Fixture 格式**（与现有 YAML schema 保持兼容）：

```yaml
id: pi-bugfix-count-defs
description: 修复 check_v2_constraints.py 中 count_definitions 的朴素子串匹配
category: bugfix
taskPrompt: |
  tools/check_v2_constraints.py 中的 count_definitions() 函数...
expectedFiles:
  - tools/check_v2_constraints.py
expectPass: true
verificationCommands:
  - python3 -m pytest tests/unit/domain/test_check_v2_constraints.py -v
architectureRules:
  - 不修改 def 签名，只改匹配逻辑
  - 保持 check_v2_constraints.py 的现有退出码约定
maxRepairRounds: 2
```

### 3.4 评测报告

新增 `formatEvaluationReport(results: TaskResult[])` 生成结构化 markdown 报告：

```
# DSH Evaluation Report
## Overview (汇总表: 完成率/均分/修复成功率/平均修复轮数/人工介入)
## Per-Task Detail (每个 task 的 10 维得分 + 详细结果)
## Failure Analysis (失败原因分类: hallucinated-api/patch-drift/overconfidence)
## Comparison (dsh vs 基线对比表)
```

## 4. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/core/src/pipeline.ts` | 新增 | Programmatic API：runPlan/runPatch/runVerify/runRepair/runHandoff/runFullPipeline |
| `packages/core/src/index.ts` | 修改 | 导出 pipeline 函数和类型 |
| `packages/cli/src/commands/plan.ts` | 重构 | 改为调用 pipeline.runPlan() |
| `packages/cli/src/commands/patch.ts` | 重构 | 改为调用 pipeline.runPatch() |
| `packages/cli/src/commands/verify.ts` | 重构 | 改为调用 pipeline.runVerify() |
| `packages/cli/src/commands/repair.ts` | 重构 | 改为调用 pipeline.runRepair() |
| `packages/cli/src/commands/handoff.ts` | 重构 | 改为调用 pipeline.runHandoff() |
| `packages/eval/src/benchmark-runner.ts` | 重写 | 新增 runTask/runAll/formatEvaluationReport，保留现有评分函数 |
| `packages/eval/src/fixtures/pi-bugfix-count-defs.yaml` | 新增 | Fixture 1 |
| `packages/eval/src/fixtures/pi-test-error-handler.yaml` | 新增 | Fixture 2 |
| `packages/eval/src/fixtures/pi-refactor-read-text.yaml` | 新增 | Fixture 3 |
| `packages/eval/src/fixtures/pi-test-aief-l3.yaml` | 新增 | Fixture 4 |
| `packages/eval/src/fixtures/pi-docs-check-tools.yaml` | 新增 | Fixture 5 |

## 5. 测试策略

- `pipeline.ts` 每个函数有单元测试（mock DeepSeekClient）
- CLI 命令重构后现有测试仍然通过
- `runTask()` 的单元测试：mock pipeline + mock git，模拟 fixture 执行流程
- 5 个 fixture 的集成验证：真实 pi-proof-forge + 真实 DeepSeek API

## 6. 成功标准

- phase 5-6 结束后 typecheck + 全部单元测试通过
- 5 个 fixture 至少 3 个一次通过（完成率 >= 60%）
- 至少 1 个 fixture 验证 repair loop 有效性
- 产出第一份 dsh 评测报告
