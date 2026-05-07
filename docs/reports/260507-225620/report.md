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
| PATCH | 1 | 1 | 100% |
| SEARCH_REPLACE | 0 | 0 | N/A |
| INSERT | 0 | 0 | N/A |
| DELETE | 0 | 0 | N/A |
| RENAME | 0 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 1/1 |
| 工具调用总轮次 | 8 |
| 工具调用总次数 | 10 |
| 调用成功率 | 50% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| read_file | 4 | 100% |
| exec_shell | 6 | 17% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 1/1 |
| 平均 patch round 数 | 9.0 |
| 平均 change 块数 | 1.0 |
| 平均 invalid 轮数 | 0.0 |
| 工具调用 action 数 | 8 |
| done 主动终止率 | 0% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| rh-mixed-dashboard-generated-at-backend | 9 | 1 | 0 | 8 | ✗ |

## 逐任务详情

### rh-mixed-dashboard-generated-at-backend (feature) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/dashboard/DashboardController.java, backend/releasehub-application/src/main/java/io/releasehub/application/dashboard/DashboardAppService.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 8 轮, 10 次 |
| Patch Loop | 9 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(4), exec_shell(6) (50% 成功) |
| 耗时 | 152.0s |

## 失败分析

- **rh-mixed-dashboard-generated-at-backend**: 修复耗尽
