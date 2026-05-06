# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 5/5 (100%) |
| 均分 | 64.0 |
| 修复成功率 | 0/5 |
| 平均修复轮数 | 1.8 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 3 | 0 | N/A |
| PATCH | 3 | 0 | N/A |
| SEARCH_REPLACE | 0 | 0 | N/A |
| INSERT | 0 | 0 | N/A |
| DELETE | 0 | 0 | N/A |
| RENAME | 0 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 5/5 |
| 工具调用总轮次 | 25 |
| 工具调用总次数 | 60 |
| 调用成功率 | 75% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| read_file | 32 | 100% |
| grep_files | 11 | 100% |
| exec_shell | 17 | 12% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 5/5 |
| 平均 patch round 数 | 5.0 |
| 平均 change 块数 | 0.0 |
| 平均 invalid 轮数 | 0.0 |
| 工具调用 action 数 | 25 |
| done 主动终止率 | 0% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| loam-bugfix-cli-error-handling | 5 | 0 | 0 | 5 | ✗ |
| loam-docs-provider-readme | 5 | 0 | 0 | 5 | ✗ |
| loam-refactor-provider-dedup | 5 | 0 | 0 | 5 | ✗ |
| loam-test-distill-engine | 5 | 0 | 0 | 5 | ✗ |
| loam-test-distill-state | 5 | 0 | 0 | 5 | ✗ |

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
| 工具调用 | 5 轮, 15 次 |
| Patch Loop | 5 rounds, 0 changes, DONE=✗ |
| 工具详情 | read_file(8), grep_files(5), exec_shell(2) (93% 成功) |
| 耗时 | 245.7s |

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
| 工具调用 | 5 轮, 14 次 |
| Patch Loop | 5 rounds, 0 changes, DONE=✗ |
| 工具详情 | read_file(8), grep_files(3), exec_shell(3) (86% 成功) |
| 耗时 | 140.5s |

### loam-refactor-provider-dedup (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | packages/distill/src/providers/shared.ts, packages/distill/src/providers/openai.ts, packages/distill/src/providers/deepseek.ts, packages/distill/src/providers/anthropic.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 5 轮, 9 次 |
| Patch Loop | 5 rounds, 0 changes, DONE=✗ |
| 工具详情 | read_file(5), exec_shell(4) (56% 成功) |
| 耗时 | 524.7s |

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
| 工具调用 | 5 轮, 13 次 |
| Patch Loop | 5 rounds, 0 changes, DONE=✗ |
| 工具详情 | exec_shell(5), read_file(7), grep_files(1) (62% 成功) |
| 耗时 | 127.4s |

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
| 工具调用 | 5 轮, 9 次 |
| Patch Loop | 5 rounds, 0 changes, DONE=✗ |
| 工具详情 | read_file(4), grep_files(2), exec_shell(3) (67% 成功) |
| 耗时 | 130.0s |

## 失败分析

- **loam-bugfix-cli-error-handling**: 修复耗尽
- **loam-docs-provider-readme**: 修复耗尽
- **loam-refactor-provider-dedup**: 修复耗尽
- **loam-test-distill-engine**: 修复耗尽
- **loam-test-distill-state**: 修复耗尽
