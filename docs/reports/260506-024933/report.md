# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 5/5 (100%) |
| 均分 | 62.0 |
| 修复成功率 | 0/5 |
| 平均修复轮数 | 1.8 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 3 | 1 | 100% |
| PATCH | 3 | 1 | 100% |
| SEARCH_REPLACE | 0 | 1 | 100% |
| INSERT | 0 | 0 | N/A |
| DELETE | 0 | 0 | N/A |
| RENAME | 0 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 5/5 |
| 工具调用总轮次 | 87 |
| 工具调用总次数 | 110 |
| 调用成功率 | 62% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| read_file | 43 | 100% |
| grep_files | 19 | 95% |
| exec_shell | 48 | 15% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 5/5 |
| 平均 patch round 数 | 19.4 |
| 平均 change 块数 | 1.0 |
| 平均 invalid 轮数 | 0.6 |
| 工具调用 action 数 | 87 |
| done 主动终止率 | 40% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| loam-bugfix-cli-error-handling | 13 | 0 | 3 | 10 | ✗ |
| loam-docs-provider-readme | 13 | 1 | 0 | 11 | ✓ |
| loam-refactor-provider-dedup | 18 | 4 | 0 | 14 | ✗ |
| loam-test-distill-engine | 23 | 0 | 0 | 22 | ✓ |
| loam-test-distill-state | 30 | 0 | 0 | 30 | ✗ |

## 逐任务详情

### loam-bugfix-cli-error-handling (bugfix) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | packages/cli/src/capture.ts, packages/cli/src/distill.ts, packages/cli/src/daemon.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 10 轮, 16 次 |
| Patch Loop | 13 rounds, 0 changes, DONE=✗ |
| 工具详情 | read_file(6), grep_files(9), exec_shell(1) (88% 成功) |
| 耗时 | 243.0s |

### loam-docs-provider-readme (docs) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | docs/providers.md |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 1 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 11 轮, 15 次 |
| Patch Loop | 13 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(7), grep_files(5), exec_shell(3) (80% 成功) |
| 耗时 | 171.8s |

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
| 工具调用 | 14 轮, 16 次 |
| Patch Loop | 18 rounds, 4 changes, DONE=✗ |
| 工具详情 | read_file(11), exec_shell(5) (69% 成功) |
| 耗时 | 554.7s |

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
| 工具调用 | 22 轮, 32 次 |
| Patch Loop | 23 rounds, 0 changes, DONE=✓ |
| 工具详情 | read_file(13), exec_shell(14), grep_files(5) (63% 成功) |
| 耗时 | 227.0s |

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
| 工具调用 | 30 轮, 31 次 |
| Patch Loop | 30 rounds, 0 changes, DONE=✗ |
| 工具详情 | read_file(6), exec_shell(25) (35% 成功) |
| 耗时 | 178.1s |

## 失败分析

- **loam-bugfix-cli-error-handling**: 修复耗尽
- **loam-docs-provider-readme**: 修复耗尽
- **loam-refactor-provider-dedup**: 范围越界; 修复耗尽
- **loam-test-distill-engine**: 修复耗尽
- **loam-test-distill-state**: 修复耗尽
