# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 6/6 (100%) |
| 均分 | 79.8 |
| 修复成功率 | 0/3 |
| 平均修复轮数 | 2.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 0 | 1 | 100% |
| PATCH | 2 | 1 | 100% |
| SEARCH_REPLACE | 0 | 1 | 100% |
| INSERT | 1 | 0 | N/A |
| DELETE | 2 | 3 | 100% |
| RENAME | 2 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 6/6 |
| 工具调用总轮次 | 79 |
| 工具调用总次数 | 94 |
| 调用成功率 | 61% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| grep_files | 10 | 100% |
| read_file | 24 | 100% |
| exec_shell | 60 | 38% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 6/6 |
| 平均 patch round 数 | 15.8 |
| 平均 change 块数 | 1.3 |
| 平均 invalid 轮数 | 0.7 |
| 工具调用 action 数 | 79 |
| done 主动终止率 | 67% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| rh-mixed-dashboard-generated-at-backend | 14 | 2 | 0 | 12 | ✗ |
| rh-mixed-dashboard-generated-at-frontend | 6 | 0 | 3 | 3 | ✗ |
| rh-mixed-remove-starter-ping-demo-backend | 12 | 2 | 0 | 9 | ✓ |
| rh-mixed-remove-starter-ping-demo-frontend | 14 | 2 | 1 | 10 | ✓ |
| rh-mixed-rename-entity-dialog-frontend | 27 | 0 | 0 | 26 | ✓ |
| rh-mixed-rename-settings-controller-backend | 22 | 2 | 0 | 19 | ✓ |

## 逐任务详情

### rh-mixed-dashboard-generated-at-backend (feature) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-application/src/main/java/io/releasehub/application/dashboard/DashboardAppService.java, backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/dashboard/DashboardController.java |
| 预期文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/dashboard/DashboardController.java, backend/releasehub-application/src/main/java/io/releasehub/application/dashboard/DashboardAppService.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 12 轮, 15 次 |
| Patch Loop | 14 rounds, 2 changes, DONE=✗ |
| 工具详情 | grep_files(2), read_file(6), exec_shell(7) (73% 成功) |
| 耗时 | 188.1s |

### rh-mixed-dashboard-generated-at-frontend (feature) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | frontend/src/api/dashboardApi.ts, frontend/src/views/dashboard/Dashboard.vue |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 3 轮, 4 次 |
| Patch Loop | 6 rounds, 0 changes, DONE=✗ |
| 工具详情 | read_file(2), exec_shell(2) (50% 成功) |
| 耗时 | 112.7s |

### rh-mixed-remove-starter-ping-demo-backend (refactor) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/rest/PingController.java, backend/releasehub-bootstrap/src/test/java/io/releasehub/bootstrap/api/PingApiTest.java |
| 预期文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/rest/PingController.java, backend/releasehub-bootstrap/src/test/java/io/releasehub/bootstrap/api/PingApiTest.java |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 9 轮, 12 次 |
| Patch Loop | 12 rounds, 2 changes, DONE=✓ |
| 工具详情 | grep_files(2), read_file(3), exec_shell(7) (42% 成功) |
| 耗时 | 114.8s |

### rh-mixed-remove-starter-ping-demo-frontend (refactor) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | frontend/src/components/HelloWorld.vue, frontend/src/components/__tests__/HelloWorld.spec.ts |
| 预期文件 | frontend/src/components/HelloWorld.vue, frontend/src/components/__tests__/HelloWorld.spec.ts |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 10 轮, 11 次 |
| Patch Loop | 14 rounds, 2 changes, DONE=✓ |
| 工具详情 | grep_files(1), read_file(1), exec_shell(9) (36% 成功) |
| 耗时 | 78.2s |

### rh-mixed-rename-entity-dialog-frontend (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | frontend/src/components/common/CrudEntityDialog.vue |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 26 轮, 33 次 |
| Patch Loop | 27 rounds, 0 changes, DONE=✓ |
| 工具详情 | read_file(8), grep_files(4), exec_shell(21) (76% 成功) |
| 耗时 | 185.5s |

### rh-mixed-rename-settings-controller-backend (refactor) — 分数: 89/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/settings/SettingsController.java, backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/settings/SystemSettingsController.java |
| 预期文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/settings/SystemSettingsController.java |
| 范围越界 | ✗ (额外: backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/settings/SettingsController.java) |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 19 轮, 19 次 |
| Patch Loop | 22 rounds, 2 changes, DONE=✓ |
| 工具详情 | read_file(4), grep_files(1), exec_shell(14) (53% 成功) |
| 耗时 | 130.7s |

## 失败分析

- **rh-mixed-dashboard-generated-at-backend**: 修复耗尽
- **rh-mixed-dashboard-generated-at-frontend**: 修复耗尽
- **rh-mixed-rename-entity-dialog-frontend**: 修复耗尽
