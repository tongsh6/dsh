# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 3/3 (100%) |
| 均分 | 67.3 |
| 修复成功率 | 0/2 |
| 平均修复轮数 | 2.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 1 | 0 | N/A |
| PATCH | 2 | 1 | 100% |
| SEARCH_REPLACE | 1 | 2 | 100% |
| INSERT | 0 | 0 | N/A |
| DELETE | 0 | 0 | N/A |
| RENAME | 0 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 0/3 |
| 工具调用总轮次 | 0 |
| 工具调用总次数 | 0 |
| 调用成功率 | N/A |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 3/3 |
| 平均 patch round 数 | 28.3 |
| 平均 change 块数 | 2.0 |
| 平均 invalid 轮数 | 0.3 |
| 工具调用 action 数 | 77 |
| done 主动终止率 | 33% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| loam-bugfix-cli-error-handling | 30 | 2 | 0 | 28 | ✗ |
| pi-bugfix-count-defs | 30 | 4 | 1 | 25 | ✗ |
| loam-test-distill-engine | 25 | 0 | 0 | 24 | ✓ |

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
| 耗时 | 824.4s |

### pi-bugfix-count-defs (bugfix) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | tools/check_v2_constraints.py |
| 预期文件 | tools/check_v2_constraints.py |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 无 |
| 耗时 | 373.9s |

### loam-test-distill-engine (test) — 分数: 74/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | packages/distill/src/engine.test.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 无 |
| 耗时 | 228.8s |
| 错误 | verify failed: Invalid state transition: patch_failed -> verification_failed |

## 失败分析

- **loam-bugfix-cli-error-handling**: 修复耗尽
- **pi-bugfix-count-defs**: 修复耗尽
- **loam-test-distill-engine**: 修复耗尽
