# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 20/21 (95%) |
| 均分 | 79.8 |
| 修复成功率 | 0/9 |
| 平均修复轮数 | 2.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 8 | 6 | 100% |
| PATCH | 9 | 3 | 100% |
| SEARCH_REPLACE | 6 | 9 | 100% |
| INSERT | 4 | 1 | 100% |
| DELETE | 3 | 3 | 100% |
| RENAME | 3 | 1 | 100% |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 20/21 |
| 工具调用总轮次 | 286 |
| 工具调用总次数 | 408 |
| 调用成功率 | 71% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| exec_shell | 161 | 35% |
| read_file | 179 | 93% |
| grep_files | 65 | 100% |
| 其他无效调用 | 3 | 0% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 20/21 |
| 平均 patch round 数 | 15.9 |
| 平均 change 块数 | 1.4 |
| 平均 invalid 轮数 | 0.0 |
| 工具调用 action 数 | 286 |
| done 主动终止率 | 30% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| loam-bugfix-cli-error-handling | 30 | 2 | 0 | 28 | ✗ |
| loam-docs-provider-readme | 9 | 1 | 0 | 7 | ✓ |
| loam-docs-readme-distill-observability | 11 | 1 | 0 | 10 | ✗ |
| loam-refactor-provider-dedup | 14 | 3 | 0 | 11 | ✗ |
| loam-refactor-reorganize-tests | 11 | 1 | 0 | 10 | ✗ |
| loam-test-distill-engine | 24 | 1 | 0 | 23 | ✗ |
| loam-test-distill-state | 22 | 1 | 0 | 21 | ✗ |
| pi-bugfix-count-defs | 4 | 1 | 0 | 2 | ✓ |
| pi-clean-duplicate-matching-report | 9 | 2 | 0 | 6 | ✓ |
| pi-docs-check-tools | 11 | 1 | 0 | 10 | ✗ |
| pi-docs-prune-stale-report-reference | 11 | 2 | 0 | 8 | ✓ |
| pi-refactor-read-text | 14 | 2 | 0 | 12 | ✗ |
| pi-test-aief-l3 | 9 | 1 | 0 | 7 | ✓ |
| pi-test-error-handler | 6 | 1 | 0 | 4 | ✓ |
| rh-bugfix-csv-export | 26 | 2 | 0 | 24 | ✗ |
| rh-mixed-dashboard-generated-at | 16 | 2 | 0 | 14 | ✗ |
| rh-mixed-remove-starter-ping-demo | 21 | 1 | 0 | 20 | ✗ |
| rh-mixed-rename-common-dialog-and-settings-controller | 11 | 2 | 0 | 9 | ✗ |
| rh-refactor-branch-orchestrator | 30 | 0 | 0 | 30 | ✗ |
| rh-test-dashboard-version | 30 | 0 | 0 | 30 | ✗ |

## 逐任务详情

### loam-bugfix-cli-error-handling (bugfix) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/cli/src/capture.ts |
| 预期文件 | packages/cli/src/capture.ts, packages/cli/src/distill.ts, packages/cli/src/daemon.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 28 轮, 41 次 |
| Patch Loop | 30 rounds, 2 changes, DONE=✗ |
| 工具详情 | exec_shell(16), read_file(17), grep_files(8) (61% 成功) |
| 耗时 | 645.2s |

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
| 工具调用 | 7 轮, 11 次 |
| Patch Loop | 9 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(7), grep_files(1), exec_shell(2) (70% 成功) |
| 耗时 | 237.8s |

### loam-docs-readme-distill-observability (docs) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | README.md |
| 预期文件 | README.md |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 10 轮, 10 次 |
| Patch Loop | 11 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(2), exec_shell(8) (100% 成功) |
| 耗时 | 115.5s |

### loam-refactor-provider-dedup (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/distill/src/providers/shared.ts |
| 预期文件 | packages/distill/src/providers/shared.ts, packages/distill/src/providers/openai.ts, packages/distill/src/providers/deepseek.ts, packages/distill/src/providers/anthropic.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 11 轮, 15 次 |
| Patch Loop | 14 rounds, 3 changes, DONE=✗ |
| 工具详情 | read_file(9), exec_shell(6) (100% 成功) |
| 耗时 | 553.0s |

### loam-refactor-rename-distill-state (refactor) — 分数: 20/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✗ |
| 修改文件 | (无) |
| 预期文件 | packages/distill/src/distill-state.ts, packages/distill/src/engine.ts, packages/distill/src/index.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 0/3 |
| 工具调用 | 无 |
| 耗时 | 0.1s |
| 错误 | fixture loam-refactor-rename-distill-state preflight failed: tracked file(s) missing from benchmark base: packages/distill/src/state.test.ts |

### loam-refactor-reorganize-tests (refactor) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/distill/src/dag-runner.test.ts -> packages/distill/src/distill-dag-runner.test.ts |
| 预期文件 | packages/distill/src/distill-dag-runner.test.ts |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 10 轮, 10 次 |
| Patch Loop | 11 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(3), exec_shell(6), grep_files(1) (60% 成功) |
| 耗时 | 68.3s |

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
| 工具调用 | 23 轮, 36 次 |
| Patch Loop | 24 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(16), grep_files(6), exec_shell(13) (66% 成功) |
| 耗时 | 711.1s |

### loam-test-distill-state (test) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/distill/src/state.test.ts |
| 预期文件 | packages/distill/src/state.test.ts |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 21 轮, 26 次 |
| Patch Loop | 22 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(7), exec_shell(18), grep_files(1) (58% 成功) |
| 耗时 | 246.6s |

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
| 工具调用 | 2 轮, 2 次 |
| Patch Loop | 4 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(2) (100% 成功) |
| 耗时 | 137.6s |

### pi-clean-duplicate-matching-report (bugfix) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | matching_reports/mr-20260227235900.yaml |
| 预期文件 | matching_reports/mr-20260227235900.yaml |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 6 轮, 7 次 |
| Patch Loop | 9 rounds, 2 changes, DONE=✓ |
| 工具详情 | grep_files(3), exec_shell(4) (57% 成功) |
| 耗时 | 65.5s |

### pi-docs-check-tools (docs) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | tools/README.md |
| 预期文件 | tools/README.md |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 10 轮, 10 次 |
| Patch Loop | 11 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(3), exec_shell(7) (80% 成功) |
| 耗时 | 74.1s |

### pi-docs-prune-stale-report-reference (refactor) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | matching_reports/mr-20260228000000.yaml, README.md |
| 预期文件 | matching_reports/mr-20260228000000.yaml, README.md |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 8 轮, 10 次 |
| Patch Loop | 11 rounds, 2 changes, DONE=✓ |
| 工具详情 | grep_files(2), read_file(3), exec_shell(4) (67% 成功) |
| 耗时 | 113.6s |

### pi-refactor-read-text (refactor) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | tools/infra/file_io.py, tools/extract_evidence.py |
| 预期文件 | tools/extract_evidence.py, tools/extract_evidence_llm.py, tools/infra/file_io.py |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 12 轮, 14 次 |
| Patch Loop | 14 rounds, 2 changes, DONE=✗ |
| 工具详情 | read_file(8), exec_shell(6) (57% 成功) |
| 耗时 | 84.8s |

### pi-test-aief-l3 (test) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | tests/unit/domain/test_check_aief_l3.py |
| 预期文件 | tests/unit/domain/test_check_aief_l3.py |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 7 轮, 8 次 |
| Patch Loop | 9 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(4), exec_shell(4) (75% 成功) |
| 耗时 | 88.0s |

### pi-test-error-handler (test) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | tests/unit/domain/test_error_handler.py |
| 预期文件 | tests/unit/domain/test_error_handler.py |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 4 轮, 6 次 |
| Patch Loop | 6 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(4), exec_shell(2) (100% 成功) |
| 耗时 | 55.4s |

### rh-bugfix-csv-export (bugfix) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-application/src/main/java/io/releasehub/application/export/ExportAppService.java |
| 预期文件 | backend/releasehub-application/src/main/java/io/releasehub/application/export/ExportAppService.java, backend/releasehub-application/src/test/java/io/releasehub/application/export/ExportAppServiceTest.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 24 轮, 36 次 |
| Patch Loop | 26 rounds, 2 changes, DONE=✗ |
| 工具详情 | read_file(13), exec_shell(18), grep_files(5) (67% 成功) |
| 耗时 | 198.1s |

### rh-mixed-dashboard-generated-at (feature) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-application/src/main/java/io/releasehub/application/dashboard/DashboardAppService.java, backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/dashboard/DashboardController.java |
| 预期文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/dashboard/DashboardController.java, backend/releasehub-application/src/main/java/io/releasehub/application/dashboard/DashboardAppService.java, frontend/src/api/dashboardApi.ts, frontend/src/views/dashboard/Dashboard.vue |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 14 轮, 19 次 |
| Patch Loop | 16 rounds, 2 changes, DONE=✗ |
| 工具详情 | grep_files(3), read_file(8), exec_shell(8) (63% 成功) |
| 耗时 | 203.8s |

### rh-mixed-remove-starter-ping-demo (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | frontend/src/components/__tests__/HelloWorld.spec.ts |
| 预期文件 | frontend/src/components/HelloWorld.vue, frontend/src/components/__tests__/HelloWorld.spec.ts, backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/rest/PingController.java, backend/releasehub-bootstrap/src/test/java/io/releasehub/bootstrap/api/PingApiTest.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 20 轮, 27 次 |
| Patch Loop | 21 rounds, 1 changes, DONE=✗ |
| 工具详情 | exec_shell(21), grep_files(2), read_file(4) (37% 成功) |
| 耗时 | 315.7s |

### rh-mixed-rename-common-dialog-and-settings-controller (refactor) — 分数: 54/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | frontend/src/components/common/CrudEntityDialog.vue, frontend/src/views/group/GroupDialog.vue |
| 预期文件 | frontend/src/components/common/CrudEntityDialog.vue, backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/settings/SystemSettingsController.java |
| 范围越界 | ✗ (额外: frontend/src/views/group/GroupDialog.vue) |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 9 轮, 20 次 |
| Patch Loop | 11 rounds, 2 changes, DONE=✗ |
| 工具详情 | read_file(16), grep_files(1), exec_shell(3) (80% 成功) |
| 耗时 | 243.6s |

### rh-refactor-branch-orchestrator (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | backend/releasehub-application/src/main/java/io/releasehub/application/release/BranchOperationOrchestrator.java, backend/releasehub-application/src/main/java/io/releasehub/application/release/CodeMergeService.java, backend/releasehub-application/src/main/java/io/releasehub/application/release/ReleaseBranchService.java, backend/releasehub-application/src/main/java/io/releasehub/application/window/AttachAppService.java, backend/releasehub-application/src/test/java/io/releasehub/application/release/BranchOperationOrchestratorTest.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 30 轮, 45 次 |
| Patch Loop | 30 rounds, 0 changes, DONE=✗ |
| 工具详情 | exec_shell(8), read_file(30), grep_files(7) (76% 成功) |
| 耗时 | 388.8s |

### rh-test-dashboard-version (test) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | backend/releasehub-application/src/test/java/io/releasehub/application/dashboard/DashboardAppServiceTest.java, backend/releasehub-application/src/test/java/io/releasehub/application/version/VersionUpdateAppServiceTest.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 30 轮, 55 次 |
| Patch Loop | 30 rounds, 0 changes, DONE=✗ |
| 工具详情 | grep_files(25), exec_shell(7), read_file(23) (93% 成功) |
| 耗时 | 318.3s |

## 失败分析

- **loam-bugfix-cli-error-handling**: 修复耗尽
- **loam-refactor-provider-dedup**: 修复耗尽
- **loam-refactor-rename-distill-state**: 任务未完成; 修复耗尽
- **pi-bugfix-count-defs**: 修复耗尽
- **rh-bugfix-csv-export**: 修复耗尽
- **rh-mixed-dashboard-generated-at**: 修复耗尽
- **rh-mixed-remove-starter-ping-demo**: 修复耗尽
- **rh-mixed-rename-common-dialog-and-settings-controller**: 范围越界; 修复耗尽
- **rh-refactor-branch-orchestrator**: 修复耗尽
- **rh-test-dashboard-version**: 修复耗尽
