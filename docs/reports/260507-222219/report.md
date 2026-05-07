# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 1/1 (100%) |
| 均分 | 99.0 |
| 修复成功率 | 0/N/A |
| 平均修复轮数 | 0.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 0 | 0 | N/A |
| PATCH | 1 | 1 | 100% |
| SEARCH_REPLACE | 0 | 1 | 100% |
| INSERT | 1 | 0 | N/A |
| DELETE | 0 | 0 | N/A |
| RENAME | 0 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 1/1 |
| 工具调用总轮次 | 6 |
| 工具调用总次数 | 8 |
| 调用成功率 | 63% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| read_file | 4 | 100% |
| exec_shell | 4 | 25% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 1/1 |
| 平均 patch round 数 | 8.0 |
| 平均 change 块数 | 2.0 |
| 平均 invalid 轮数 | 0.0 |
| 工具调用 action 数 | 6 |
| done 主动终止率 | 0% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| rh-mixed-dashboard-generated-at-frontend | 8 | 2 | 0 | 6 | ✗ |

## 逐任务详情

### rh-mixed-dashboard-generated-at-frontend (feature) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | frontend/src/api/dashboardApi.ts, frontend/src/views/dashboard/Dashboard.vue |
| 预期文件 | frontend/src/api/dashboardApi.ts, frontend/src/views/dashboard/Dashboard.vue |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 6 轮, 8 次 |
| Patch Loop | 8 rounds, 2 changes, DONE=✗ |
| 工具详情 | read_file(4), exec_shell(4) (63% 成功) |
| 耗时 | 81.2s |
