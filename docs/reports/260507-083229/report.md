# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 1/1 (100%) |
| 均分 | 64.0 |
| 修复成功率 | 0/1 |
| 平均修复轮数 | 2.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 0 | 0 | N/A |
| PATCH | 0 | 0 | N/A |
| SEARCH_REPLACE | 1 | 0 | N/A |
| INSERT | 0 | 0 | N/A |
| DELETE | 0 | 0 | N/A |
| RENAME | 1 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 1/1 |
| 工具调用总轮次 | 30 |
| 工具调用总次数 | 35 |
| 调用成功率 | 71% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| grep_files | 4 | 75% |
| read_file | 4 | 100% |
| exec_shell | 27 | 67% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 1/1 |
| 平均 patch round 数 | 30.0 |
| 平均 change 块数 | 0.0 |
| 平均 invalid 轮数 | 0.0 |
| 工具调用 action 数 | 30 |
| done 主动终止率 | 0% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| loam-refactor-rename-distill-state | 30 | 0 | 0 | 30 | ✗ |

## 逐任务详情

### loam-refactor-rename-distill-state (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | packages/distill/src/distill-state.ts, packages/distill/src/engine.ts, packages/distill/src/index.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 30 轮, 35 次 |
| Patch Loop | 30 rounds, 0 changes, DONE=✗ |
| 工具详情 | grep_files(4), read_file(4), exec_shell(27) (71% 成功) |
| 耗时 | 309.4s |

## 失败分析

- **loam-refactor-rename-distill-state**: 修复耗尽
