# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 6/6 (100%) |
| 均分 | 64.0 |
| 修复成功率 | 0/6 |
| 平均修复轮数 | 2.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 0 | 2 | 100% |
| PATCH | 2 | 1 | 100% |
| SEARCH_REPLACE | 0 | 1 | 100% |
| INSERT | 1 | 1 | 100% |
| DELETE | 2 | 2 | 100% |
| RENAME | 2 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 6/6 |
| 工具调用总轮次 | 89 |
| 工具调用总次数 | 106 |
| 调用成功率 | 52% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| read_file | 29 | 97% |
| grep_files | 10 | 100% |
| exec_shell | 66 | 26% |
| 其他无效调用 | 1 | 0% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 6/6 |
| 平均 patch round 数 | 16.5 |
| 平均 change 块数 | 1.5 |
| 平均 invalid 轮数 | 0.2 |
| 工具调用 action 数 | 89 |
| done 主动终止率 | 0% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| rh-mixed-dashboard-generated-at-backend | 13 | 2 | 0 | 11 | ✗ |
| rh-mixed-dashboard-generated-at-frontend | 8 | 2 | 0 | 6 | ✗ |
| rh-mixed-remove-starter-ping-demo-backend | 14 | 1 | 0 | 13 | ✗ |
| rh-mixed-remove-starter-ping-demo-frontend | 28 | 2 | 1 | 25 | ✗ |
| rh-mixed-rename-entity-dialog-frontend | 12 | 1 | 0 | 11 | ✗ |
| rh-mixed-rename-settings-controller-backend | 24 | 1 | 0 | 23 | ✗ |

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
| 工具调用 | 11 轮, 12 次 |
| Patch Loop | 13 rounds, 2 changes, DONE=✗ |
| 工具详情 | read_file(4), grep_files(1), exec_shell(7) (83% 成功) |
| 耗时 | 176.9s |

### rh-mixed-dashboard-generated-at-frontend (feature) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | frontend/src/api/dashboardApi.ts, frontend/src/views/dashboard/Dashboard.vue |
| 预期文件 | frontend/src/api/dashboardApi.ts, frontend/src/views/dashboard/Dashboard.vue |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 6 轮, 7 次 |
| Patch Loop | 8 rounds, 2 changes, DONE=✗ |
| 工具详情 | read_file(2), exec_shell(5) (29% 成功) |
| 耗时 | 130.6s |

### rh-mixed-remove-starter-ping-demo-backend (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/rest/PingController.java |
| 预期文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/rest/PingController.java, backend/releasehub-bootstrap/src/test/java/io/releasehub/bootstrap/api/PingApiTest.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 13 轮, 17 次 |
| Patch Loop | 14 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(4), grep_files(1), exec_shell(12) (59% 成功) |
| 耗时 | 156.4s |

### rh-mixed-remove-starter-ping-demo-frontend (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | frontend/src/components/HelloWorld.vue, frontend/src/components/__tests__/HelloWorld.spec.ts |
| 预期文件 | frontend/src/components/HelloWorld.vue, frontend/src/components/__tests__/HelloWorld.spec.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 25 轮, 29 次 |
| Patch Loop | 28 rounds, 2 changes, DONE=✗ |
| 工具详情 | exec_shell(20), grep_files(3), read_file(5) (32% 成功) |
| 耗时 | 175.4s |

### rh-mixed-rename-entity-dialog-frontend (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | frontend/src/components/common/CrudEntityDialog.vue |
| 预期文件 | frontend/src/components/common/CrudEntityDialog.vue |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 11 轮, 16 次 |
| Patch Loop | 12 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(6), grep_files(1), exec_shell(9) (56% 成功) |
| 耗时 | 187.5s |

### rh-mixed-rename-settings-controller-backend (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/settings/SystemSettingsController.java |
| 预期文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/settings/SystemSettingsController.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 23 轮, 25 次 |
| Patch Loop | 24 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(8), exec_shell(13), grep_files(4) (60% 成功) |
| 耗时 | 199.1s |

## 失败分析

- **rh-mixed-dashboard-generated-at-backend**: 修复耗尽
- **rh-mixed-dashboard-generated-at-frontend**: 修复耗尽
- **rh-mixed-remove-starter-ping-demo-backend**: 修复耗尽
- **rh-mixed-remove-starter-ping-demo-frontend**: 修复耗尽
- **rh-mixed-rename-entity-dialog-frontend**: 修复耗尽
- **rh-mixed-rename-settings-controller-backend**: 修复耗尽
