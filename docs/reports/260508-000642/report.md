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
| 工具调用总轮次 | 12 |
| 工具调用总次数 | 14 |
| 调用成功率 | 64% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| grep_files | 2 | 100% |
| read_file | 6 | 100% |
| exec_shell | 6 | 17% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 1/1 |
| 平均 patch round 数 | 13.0 |
| 平均 change 块数 | 1.0 |
| 平均 invalid 轮数 | 0.0 |
| 工具调用 action 数 | 12 |
| done 主动终止率 | 0% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| rh-mixed-dashboard-generated-at-backend | 13 | 1 | 0 | 12 | ✗ |

## 逐任务详情

### rh-mixed-dashboard-generated-at-backend (feature) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-application/src/main/java/io/releasehub/application/dashboard/DashboardAppService.java |
| 预期文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/dashboard/DashboardController.java, backend/releasehub-application/src/main/java/io/releasehub/application/dashboard/DashboardAppService.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 12 轮, 14 次 |
| Patch Loop | 13 rounds, 1 changes, DONE=✗ |
| 工具详情 | grep_files(2), read_file(6), exec_shell(6) (64% 成功) |
| 验证输出 | failed: grep -q 'generatedAt' backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/dashboard/DashboardController.java\n\n\nfailed: (cd backend && mvn test -pl releasehub-interfaces -am -q)\n[ERROR] COMPILATION ERROR : \n[ERROR] /Users/loong/dsh-bench/repos/release-hub/backend/rel |
| 耗时 | 173.5s |

## 失败分析

- **rh-mixed-dashboard-generated-at-backend**: 修复耗尽
