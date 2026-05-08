# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 24/24 (100%) |
| 均分 | 73.4 |
| 修复成功率 | 0/17 |
| 平均修复轮数 | 2.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 8 | 7 | 100% |
| PATCH | 10 | 4 | 100% |
| SEARCH_REPLACE | 4 | 9 | 100% |
| INSERT | 4 | 0 | N/A |
| DELETE | 4 | 3 | 100% |
| RENAME | 4 | 1 | 100% |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 24/24 |
| 工具调用总轮次 | 389 |
| 工具调用总次数 | 505 |
| 调用成功率 | 69% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| read_file | 196 | 98% |
| grep_files | 32 | 91% |
| exec_shell | 275 | 47% |
| 其他无效调用 | 2 | 0% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 24/24 |
| 平均 patch round 数 | 17.9 |
| 平均 change 块数 | 1.1 |
| 平均 invalid 轮数 | 0.3 |
| 工具调用 action 数 | 389 |
| done 主动终止率 | 25% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| loam-bugfix-cli-error-handling | 18 | 1 | 1 | 16 | ✗ |
| loam-docs-provider-readme | 8 | 1 | 0 | 6 | ✓ |
| loam-docs-readme-distill-observability | 4 | 1 | 0 | 2 | ✓ |
| loam-refactor-provider-dedup | 22 | 2 | 0 | 20 | ✗ |
| loam-refactor-rename-distill-state | 30 | 0 | 0 | 30 | ✗ |
| loam-refactor-reorganize-tests | 6 | 1 | 0 | 4 | ✓ |
| loam-test-distill-engine | 30 | 0 | 0 | 30 | ✗ |
| loam-test-distill-state | 15 | 1 | 2 | 12 | ✗ |
| pi-bugfix-count-defs | 12 | 1 | 0 | 11 | ✗ |
| pi-clean-duplicate-matching-report | 12 | 1 | 0 | 10 | ✓ |
| pi-docs-check-tools | 12 | 1 | 0 | 10 | ✓ |
| pi-docs-prune-stale-report-reference | 27 | 1 | 0 | 26 | ✗ |
| pi-refactor-read-text | 30 | 0 | 0 | 30 | ✗ |
| pi-test-aief-l3 | 13 | 2 | 2 | 8 | ✓ |
| pi-test-error-handler | 13 | 1 | 0 | 12 | ✗ |
| rh-bugfix-csv-export | 22 | 1 | 0 | 21 | ✗ |
| rh-mixed-dashboard-generated-at-backend | 15 | 4 | 1 | 10 | ✗ |
| rh-mixed-dashboard-generated-at-frontend | 11 | 1 | 0 | 10 | ✗ |
| rh-mixed-remove-starter-ping-demo-backend | 15 | 1 | 1 | 13 | ✗ |
| rh-mixed-remove-starter-ping-demo-frontend | 25 | 1 | 1 | 23 | ✗ |
| rh-mixed-rename-entity-dialog-frontend | 19 | 1 | 0 | 18 | ✗ |
| rh-mixed-rename-settings-controller-backend | 14 | 1 | 0 | 13 | ✗ |
| rh-refactor-branch-orchestrator | 27 | 2 | 0 | 25 | ✗ |
| rh-test-dashboard-version | 30 | 1 | 0 | 29 | ✗ |

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
| 工具调用 | 16 轮, 23 次 |
| Patch Loop | 18 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(14), grep_files(8), exec_shell(1) (96% 成功) |
| 耗时 | 498.4s |

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
| 工具调用 | 6 轮, 12 次 |
| Patch Loop | 8 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(9), grep_files(1), exec_shell(2) (92% 成功) |
| 验证输出 | passed: test -f docs/providers.md\n(no output) |
| 耗时 | 145.3s |

### loam-docs-readme-distill-observability (docs) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | README.md |
| 预期文件 | README.md |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 2 轮, 3 次 |
| Patch Loop | 4 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(3) (100% 成功) |
| 验证输出 | failed: section_exists\nassertion 'file_contains' failed: file 'README.md' does not contain pattern '^## Distill Observability' (regex)\npassed: section_positioned_correctly: awk '/^## Architecture/{seen=1} seen && /^## Distill Observability/{found=1} /^## Current Direction/{exit found ? 0 : 1}' REA |
| 耗时 | 252.9s |

### loam-refactor-provider-dedup (refactor) — 分数: 54/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/distill/src/providers/shared.ts, packages/distill/src/providers/openai-compatible.ts |
| 预期文件 | packages/distill/src/providers/shared.ts, packages/distill/src/providers/openai.ts, packages/distill/src/providers/deepseek.ts, packages/distill/src/providers/anthropic.ts |
| 范围越界 | ✗ (额外: packages/distill/src/providers/openai-compatible.ts) |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 20 轮, 23 次 |
| Patch Loop | 22 rounds, 2 changes, DONE=✗ |
| 工具详情 | exec_shell(14), read_file(9) (61% 成功) |
| 耗时 | 560.0s |

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
| 工具调用 | 30 轮, 32 次 |
| Patch Loop | 30 rounds, 0 changes, DONE=✗ |
| 工具详情 | grep_files(1), read_file(23), exec_shell(8) (81% 成功) |
| 耗时 | 316.9s |

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
| 工具调用 | 4 轮, 7 次 |
| Patch Loop | 6 rounds, 1 changes, DONE=✓ |
| 工具详情 | exec_shell(3), read_file(4) (29% 成功) |
| 验证输出 | passed: test -f packages/distill/src/distill-dag-runner.test.ts\n(no output)\npassed: ! test -f packages/distill/src/dag-runner.test.ts\n(no output)\npassed: git show HEAD:packages/distill/src/dag-runner.test.ts | cmp - packages/distill/src/distill-dag-runner.test.ts\n(no output)\npassed: pnpm test\ |
| 耗时 | 64.9s |

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
| 工具调用 | 30 轮, 41 次 |
| Patch Loop | 30 rounds, 0 changes, DONE=✗ |
| 工具详情 | read_file(15), grep_files(3), exec_shell(22) (70% 成功) |
| 耗时 | 893.6s |

### loam-test-distill-state (test) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/distill/src/state.test.ts |
| 预期文件 | packages/distill/src/state.test.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 12 轮, 20 次 |
| Patch Loop | 15 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(10), exec_shell(7), grep_files(3) (90% 成功) |
| 耗时 | 259.3s |

### pi-bugfix-count-defs (bugfix) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | tools/check_v2_constraints.py |
| 预期文件 | tools/check_v2_constraints.py |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 11 轮, 11 次 |
| Patch Loop | 12 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(2), exec_shell(8), grep_files(1) (82% 成功) |
| 验证输出 | passed: python3 -m pytest tests/unit/domain/test_check_v2_constraints.py -v\n============================= test session starts ==============================\nplatform darwin -- Python 3.14.3, pytest-9.0.3, pluggy-1.6.0 -- /opt/homebrew/opt/python@3.14/bin/python3.14\ncachedir: .pytest_cache\nrootdi |
| 耗时 | 92.1s |

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
| 工具调用 | 10 轮, 11 次 |
| Patch Loop | 12 rounds, 1 changes, DONE=✓ |
| 工具详情 | grep_files(2), read_file(1), exec_shell(8) (45% 成功) |
| 验证输出 | passed: ! test -f matching_reports/mr-20260227235900.yaml\n(no output)\npassed: python3 -m pytest tests/ -q\n........................................................................ [ 25%]\n........................................................................ [ 51%]\n............................. |
| 耗时 | 71.3s |

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
| Patch Loop | 12 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(4), grep_files(1), exec_shell(4) (89% 成功) |
| 验证输出 | passed: python3 tools/check_v2_constraints.py --root .\nPASS v2 constraints |
| 耗时 | 120.6s |

### pi-docs-prune-stale-report-reference (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | README.md |
| 预期文件 | matching_reports/mr-20260228000000.yaml, README.md |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 26 轮, 30 次 |
| Patch Loop | 27 rounds, 1 changes, DONE=✗ |
| 工具详情 | exec_shell(24), grep_files(3), read_file(3) (47% 成功) |
| 耗时 | 213.8s |

### pi-refactor-read-text (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | tools/extract_evidence.py, tools/extract_evidence_llm.py, tools/infra/file_io.py |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 30 轮, 30 次 |
| Patch Loop | 30 rounds, 0 changes, DONE=✗ |
| 工具详情 | read_file(1), exec_shell(29) (73% 成功) |
| 耗时 | 337.7s |

### pi-test-aief-l3 (test) — 分数: 89/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | tests/unit/domain/test_check_aief_l3.py, tools/check_aief_l3.py |
| 预期文件 | tests/unit/domain/test_check_aief_l3.py |
| 范围越界 | ✗ (额外: tools/check_aief_l3.py) |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 8 轮, 9 次 |
| Patch Loop | 13 rounds, 2 changes, DONE=✓ |
| 工具详情 | read_file(4), exec_shell(5) (89% 成功) |
| 验证输出 | passed: python3 -m pytest tests/unit/domain/test_check_aief_l3.py -v\n============================= test session starts ==============================\nplatform darwin -- Python 3.14.3, pytest-9.0.3, pluggy-1.6.0 -- /opt/homebrew/opt/python@3.14/bin/python3.14\ncachedir: .pytest_cache\nrootdir: /Use |
| 耗时 | 102.8s |

### pi-test-error-handler (test) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | tests/unit/domain/test_error_handler.py |
| 预期文件 | tests/unit/domain/test_error_handler.py |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 12 轮, 14 次 |
| Patch Loop | 13 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(4), exec_shell(10) (86% 成功) |
| 耗时 | 125.7s |

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
| 工具调用 | 21 轮, 29 次 |
| Patch Loop | 22 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(12), exec_shell(17) (66% 成功) |
| 耗时 | 209.0s |

### rh-mixed-dashboard-generated-at-backend (feature) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-application/src/main/java/io/releasehub/application/dashboard/DashboardAppService.java, backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/dashboard/DashboardController.java |
| 预期文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/dashboard/DashboardController.java, backend/releasehub-application/src/main/java/io/releasehub/application/dashboard/DashboardAppService.java |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 10 轮, 13 次 |
| Patch Loop | 15 rounds, 4 changes, DONE=✗ |
| 工具详情 | exec_shell(5), grep_files(2), read_file(6) (62% 成功) |
| 验证输出 | passed: controller_has_generatedAt\n(pattern found)\npassed: maven_test_passes: cd backend && mvn test -pl releasehub-interfaces -am -q\n(no output) |
| 耗时 | 127.6s |

### rh-mixed-dashboard-generated-at-frontend (feature) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | frontend/src/api/dashboardApi.ts |
| 预期文件 | frontend/src/api/dashboardApi.ts, frontend/src/views/dashboard/Dashboard.vue |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 10 轮, 11 次 |
| Patch Loop | 11 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(4), exec_shell(7) (64% 成功) |
| 耗时 | 128.3s |

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
| Patch Loop | 15 rounds, 1 changes, DONE=✗ |
| 工具详情 | grep_files(3), read_file(5), exec_shell(9) (53% 成功) |
| 耗时 | 148.2s |

### rh-mixed-remove-starter-ping-demo-frontend (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | frontend/src/components/HelloWorld.vue |
| 预期文件 | frontend/src/components/HelloWorld.vue, frontend/src/components/__tests__/HelloWorld.spec.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 23 轮, 25 次 |
| Patch Loop | 25 rounds, 1 changes, DONE=✗ |
| 工具详情 | grep_files(1), exec_shell(22), read_file(2) (48% 成功) |
| 耗时 | 144.6s |

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
| 工具调用 | 18 轮, 27 次 |
| Patch Loop | 19 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(13), grep_files(2), exec_shell(12) (59% 成功) |
| 耗时 | 233.7s |

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
| 工具调用 | 13 轮, 14 次 |
| Patch Loop | 14 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(2), exec_shell(11), grep_files(1) (50% 成功) |
| 耗时 | 167.7s |

### rh-refactor-branch-orchestrator (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-application/src/main/java/io/releasehub/application/release/BranchOperationOrchestrator.java, backend/releasehub-application/src/main/java/io/releasehub/application/release/CodeMergeService.java |
| 预期文件 | backend/releasehub-application/src/main/java/io/releasehub/application/release/BranchOperationOrchestrator.java, backend/releasehub-application/src/main/java/io/releasehub/application/release/CodeMergeService.java, backend/releasehub-application/src/main/java/io/releasehub/application/release/ReleaseBranchService.java, backend/releasehub-application/src/main/java/io/releasehub/application/window/AttachAppService.java, backend/releasehub-application/src/test/java/io/releasehub/application/release/BranchOperationOrchestratorTest.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 25 轮, 43 次 |
| Patch Loop | 27 rounds, 2 changes, DONE=✗ |
| 工具详情 | exec_shell(26), read_file(17) (65% 成功) |
| 验证输出 | failed: cd backend && mvn test -pl releasehub-application -q\n[ERROR] COMPILATION ERROR : \n[ERROR] /Users/loong/dsh-bench/repos/release-hub/backend/releasehub-application/src/main/java/io/releasehub/application/release/CodeMergeService.java:[38,12] 未命名类 是预览功能，默认情况下禁用。\n  （请使用 --enable-preview 以启用 未 |
| 耗时 | 387.4s |

### rh-test-dashboard-version (test) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-application/src/test/java/io/releasehub/application/dashboard/DashboardAppServiceTest.java |
| 预期文件 | backend/releasehub-application/src/test/java/io/releasehub/application/dashboard/DashboardAppServiceTest.java, backend/releasehub-application/src/test/java/io/releasehub/application/version/VersionUpdateAppServiceTest.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 29 轮, 50 次 |
| Patch Loop | 30 rounds, 1 changes, DONE=✗ |
| 工具详情 | exec_shell(21), read_file(29) (84% 成功) |
| 耗时 | 366.5s |

## 失败分析

- **loam-bugfix-cli-error-handling**: 修复耗尽
- **loam-docs-readme-distill-observability**: 修复耗尽
- **loam-refactor-provider-dedup**: 范围越界; 修复耗尽
- **loam-refactor-rename-distill-state**: 修复耗尽
- **loam-test-distill-engine**: 修复耗尽
- **loam-test-distill-state**: 修复耗尽
- **pi-docs-prune-stale-report-reference**: 修复耗尽
- **pi-refactor-read-text**: 修复耗尽
- **pi-test-error-handler**: 修复耗尽
- **rh-bugfix-csv-export**: 修复耗尽
- **rh-mixed-dashboard-generated-at-frontend**: 修复耗尽
- **rh-mixed-remove-starter-ping-demo-backend**: 修复耗尽
- **rh-mixed-remove-starter-ping-demo-frontend**: 修复耗尽
- **rh-mixed-rename-entity-dialog-frontend**: 修复耗尽
- **rh-mixed-rename-settings-controller-backend**: 修复耗尽
- **rh-refactor-branch-orchestrator**: 修复耗尽
- **rh-test-dashboard-version**: 修复耗尽
