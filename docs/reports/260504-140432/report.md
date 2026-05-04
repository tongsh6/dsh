# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 4/5 (80%) |
| 均分 | 67.2 |
| 修复成功率 | 0/2 |
| 平均修复轮数 | 2.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 3 | 0 | N/A |
| PATCH | 3 | 0 | N/A |
| SEARCH_REPLACE | 0 | 1 | 100% |
| INSERT | 0 | 0 | N/A |
| DELETE | 0 | 0 | N/A |
| RENAME | 0 | 0 | N/A |

## 逐任务详情

### loam-bugfix-cli-error-handling (bugfix) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/cli/src/capture.ts, packages/cli/src/distill.ts, packages/cli/src/capture.ts, packages/cli/src/distill.ts, packages/cli/src/distill.ts, packages/cli/src/distill.ts, packages/cli/src/daemon.ts, packages/cli/src/daemon.ts |
| 预期文件 | packages/cli/src/capture.ts, packages/cli/src/distill.ts, packages/cli/src/daemon.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 耗时 | 1283.4s |

### loam-docs-provider-readme (docs) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | docs/providers.md |
| 预期文件 | docs/providers.md |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 耗时 | 160.5s |

### loam-refactor-provider-dedup (refactor) — 分数: 54/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/distill/src/providers/shared.ts, packages/distill/src/providers/openai-compatible.ts, packages/distill/src/providers/openai-compatible.ts, packages/distill/src/providers/anthropic.ts, packages/distill/src/providers/anthropic.ts |
| 预期文件 | packages/distill/src/providers/shared.ts, packages/distill/src/providers/openai.ts, packages/distill/src/providers/deepseek.ts, packages/distill/src/providers/anthropic.ts |
| 范围越界 | ✗ (额外: packages/distill/src/providers/openai-compatible.ts, packages/distill/src/providers/openai-compatible.ts) |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 耗时 | 507.8s |

### loam-test-distill-engine (test) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/distill/src/engine.test.ts |
| 预期文件 | packages/distill/src/engine.test.ts |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 耗时 | 462.8s |

### loam-test-distill-state (test) — 分数: 20/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✗ |
| 修改文件 | (无) |
| 预期文件 | packages/distill/src/state.test.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 0/3 |
| 耗时 | 268.9s |
| 错误 | 变更应用失败 — parse failed |

## 失败分析

- **loam-bugfix-cli-error-handling**: 修复耗尽
- **loam-refactor-provider-dedup**: 范围越界; 修复耗尽
- **loam-test-distill-state**: 任务未完成; 修复耗尽
