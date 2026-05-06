# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 5/5 (100%) |
| 均分 | 69.0 |
| 修复成功率 | 0/4 |
| 平均修复轮数 | 2.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 3 | 0 | N/A |
| PATCH | 3 | 2 | 100% |
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
| 平均 patch round 数 | 28.8 |
| 平均 change 块数 | 1.2 |
| 平均 invalid 轮数 | 0.0 |
| 工具调用 action 数 | 137 |
| done 主动终止率 | 20% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| loam-bugfix-cli-error-handling | 30 | 2 | 0 | 28 | ✗ |
| loam-docs-provider-readme | 30 | 1 | 0 | 29 | ✗ |
| loam-refactor-provider-dedup | 30 | 3 | 0 | 27 | ✗ |
| loam-test-distill-engine | 24 | 0 | 0 | 23 | ✓ |
| loam-test-distill-state | 30 | 0 | 0 | 30 | ✗ |

## 逐任务详情

### loam-bugfix-cli-error-handling (bugfix) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/cli/src/capture.ts |
| 预期文件 | packages/cli/src/capture.ts, packages/cli/src/distill.ts, packages/cli/src/daemon.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 无 |
| 耗时 | 482.4s |

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
| 工具调用 | 无 |
| 耗时 | 405.0s |

### loam-refactor-provider-dedup (refactor) — 分数: 54/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/distill/src/providers/shared.ts, packages/distill/src/providers/openai-compatible.ts |
| 预期文件 | packages/distill/src/providers/shared.ts, packages/distill/src/providers/openai.ts, packages/distill/src/providers/deepseek.ts, packages/distill/src/providers/anthropic.ts |
| 范围越界 | ✗ (额外: packages/distill/src/providers/openai-compatible.ts) |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 无 |
| 耗时 | 537.8s |

### loam-test-distill-engine (test) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | packages/distill/src/engine.test.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 无 |
| 耗时 | 261.1s |

### loam-test-distill-state (test) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | packages/distill/src/state.test.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 无 |
| 耗时 | 232.2s |

## 失败分析

- **loam-bugfix-cli-error-handling**: 修复耗尽
- **loam-refactor-provider-dedup**: 范围越界; 修复耗尽
- **loam-test-distill-engine**: 修复耗尽
- **loam-test-distill-state**: 修复耗尽
