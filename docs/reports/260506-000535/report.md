# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 5/5 (100%) |
| 均分 | 76.0 |
| 修复成功率 | 0/3 |
| 平均修复轮数 | 2.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 3 | 2 | 100% |
| PATCH | 3 | 3 | 100% |
| SEARCH_REPLACE | 0 | 2 | 100% |
| INSERT | 0 | 0 | N/A |
| DELETE | 0 | 0 | N/A |
| RENAME | 0 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 5/5 |
| 工具调用总轮次 | 108 |
| 工具调用总次数 | 135 |
| 调用成功率 | 71% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| read_file | 70 | 100% |
| grep_files | 10 | 100% |
| exec_shell | 55 | 29% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 5/5 |
| 平均 patch round 数 | 25.2 |
| 平均 change 块数 | 2.6 |
| 平均 invalid 轮数 | 0.6 |
| 工具调用 action 数 | 108 |
| done 主动终止率 | 40% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| loam-bugfix-cli-error-handling | 30 | 6 | 1 | 23 | ✗ |
| loam-docs-provider-readme | 10 | 2 | 0 | 7 | ✓ |
| loam-refactor-provider-dedup | 30 | 3 | 1 | 26 | ✗ |
| loam-test-distill-engine | 30 | 2 | 1 | 27 | ✗ |
| loam-test-distill-state | 26 | 0 | 0 | 25 | ✓ |

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
| 工具调用 | 23 轮, 29 次 |
| Patch Loop | 30 rounds, 6 changes, DONE=✗ |
| 工具详情 | read_file(19), grep_files(7), exec_shell(3) (93% 成功) |
| 耗时 | 581.0s |

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
| 工具调用 | 7 轮, 14 次 |
| Patch Loop | 10 rounds, 2 changes, DONE=✓ |
| 工具详情 | read_file(10), grep_files(3), exec_shell(1) (93% 成功) |
| 耗时 | 140.3s |

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
| 工具调用 | 26 轮, 29 次 |
| Patch Loop | 30 rounds, 3 changes, DONE=✗ |
| 工具详情 | read_file(22), exec_shell(7) (76% 成功) |
| 耗时 | 514.8s |

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
| 工具调用 | 27 轮, 35 次 |
| Patch Loop | 30 rounds, 2 changes, DONE=✗ |
| 工具详情 | exec_shell(20), read_file(15) (60% 成功) |
| 耗时 | 311.7s |

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
| 工具调用 | 25 轮, 28 次 |
| Patch Loop | 26 rounds, 0 changes, DONE=✓ |
| 工具详情 | read_file(4), exec_shell(24) (46% 成功) |
| 耗时 | 195.8s |

## 失败分析

- **loam-bugfix-cli-error-handling**: 修复耗尽
- **loam-refactor-provider-dedup**: 范围越界; 修复耗尽
- **loam-test-distill-state**: 修复耗尽
