# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 3/3 (100%) |
| 均分 | 64.0 |
| 修复成功率 | 0/3 |
| 平均修复轮数 | 2.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 0 | 1 | 100% |
| PATCH | 1 | 0 | N/A |
| SEARCH_REPLACE | 2 | 1 | 100% |
| INSERT | 1 | 0 | N/A |
| DELETE | 1 | 1 | 100% |
| RENAME | 1 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 3/3 |
| 工具调用总轮次 | 29 |
| 工具调用总次数 | 42 |
| 调用成功率 | 67% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| read_file | 16 | 100% |
| grep_files | 5 | 100% |
| exec_shell | 17 | 41% |
| 其他无效调用 | 4 | 0% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 3/3 |
| 平均 patch round 数 | 10.7 |
| 平均 change 块数 | 1.0 |
| 平均 invalid 轮数 | 0.0 |
| 工具调用 action 数 | 29 |
| done 主动终止率 | 0% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| rh-mixed-dashboard-generated-at | 11 | 1 | 0 | 10 | ✗ |
| rh-mixed-remove-starter-ping-demo | 11 | 1 | 0 | 10 | ✗ |
| rh-mixed-rename-common-dialog-and-settings-controller | 10 | 1 | 0 | 9 | ✗ |

## 逐任务详情

### rh-mixed-dashboard-generated-at (feature) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-application/src/main/java/io/releasehub/application/dashboard/DashboardAppService.java |
| 预期文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/dashboard/DashboardController.java, backend/releasehub-application/src/main/java/io/releasehub/application/dashboard/DashboardAppService.java, frontend/src/api/dashboardApi.ts, frontend/src/views/dashboard/Dashboard.vue |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 10 轮, 12 次 |
| Patch Loop | 11 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(4), grep_files(1), exec_shell(3) (63% 成功) |
| 耗时 | 184.7s |

### rh-mixed-remove-starter-ping-demo (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | frontend/src/components/HelloWorld.vue |
| 预期文件 | frontend/src/components/HelloWorld.vue, frontend/src/components/__tests__/HelloWorld.spec.ts, backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/rest/PingController.java, backend/releasehub-bootstrap/src/test/java/io/releasehub/bootstrap/api/PingApiTest.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 10 轮, 15 次 |
| Patch Loop | 11 rounds, 1 changes, DONE=✗ |
| 工具详情 | grep_files(3), read_file(4), exec_shell(8) (87% 成功) |
| 耗时 | 187.0s |

### rh-mixed-rename-common-dialog-and-settings-controller (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | frontend/src/components/common/CrudEntityDialog.vue |
| 预期文件 | frontend/src/components/common/CrudEntityDialog.vue, backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/settings/SystemSettingsController.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 9 轮, 15 次 |
| Patch Loop | 10 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(8), grep_files(1), exec_shell(6) (67% 成功) |
| 耗时 | 220.9s |

## 失败分析

- **rh-mixed-dashboard-generated-at**: 修复耗尽
- **rh-mixed-remove-starter-ping-demo**: 修复耗尽
- **rh-mixed-rename-common-dialog-and-settings-controller**: 修复耗尽
