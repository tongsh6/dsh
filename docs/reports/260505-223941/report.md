# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 5/5 (100%) |
| 均分 | 80.0 |
| 修复成功率 | 0/2 |
| 平均修复轮数 | 2.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 3 | 2 | 100% |
| PATCH | 3 | 0 | N/A |
| SEARCH_REPLACE | 0 | 3 | 100% |
| INSERT | 0 | 0 | N/A |
| DELETE | 0 | 0 | N/A |
| RENAME | 0 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 0/5 |
| 工具调用总轮次 | 0 |
| 工具调用总次数 | 0 |
| 调用成功率 | N/A |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 5/5 |
| 平均 patch round 数 | 25.2 |
| 平均 change 块数 | 1.8 |
| 平均 invalid 轮数 | 0.2 |
| 工具调用 action 数 | 114 |
| done 主动终止率 | 40% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| loam-bugfix-cli-error-handling | 30 | 5 | 1 | 24 | ✗ |
| loam-docs-provider-readme | 7 | 0 | 0 | 6 | ✓ |
| loam-refactor-provider-dedup | 30 | 2 | 0 | 28 | ✗ |
| loam-test-distill-engine | 29 | 1 | 0 | 27 | ✓ |
| loam-test-distill-state | 30 | 1 | 0 | 29 | ✗ |

## 逐任务详情

### loam-bugfix-cli-error-handling (bugfix) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/cli/src/capture.ts, packages/cli/src/distill.ts |
| 预期文件 | packages/cli/src/capture.ts, packages/cli/src/distill.ts, packages/cli/src/daemon.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 无 |
| 耗时 | 672.1s |

### loam-docs-provider-readme (docs) — 分数: 74/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | docs/providers.md |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 无 |
| 耗时 | 91.2s |
| 错误 | verify failed: Invalid state transition: patch_failed -> verification_failed |

### loam-refactor-provider-dedup (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/distill/src/providers/shared.ts |
| 预期文件 | packages/distill/src/providers/shared.ts, packages/distill/src/providers/openai.ts, packages/distill/src/providers/deepseek.ts, packages/distill/src/providers/anthropic.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 无 |
| 耗时 | 605.6s |

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
| 工具调用 | 无 |
| 耗时 | 334.2s |

### loam-test-distill-state (test) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/distill/src/state.test.ts |
| 预期文件 | packages/distill/src/state.test.ts |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 无 |
| 耗时 | 311.9s |

## 失败分析

- **loam-bugfix-cli-error-handling**: 修复耗尽
- **loam-docs-provider-readme**: 修复耗尽
- **loam-refactor-provider-dedup**: 修复耗尽
