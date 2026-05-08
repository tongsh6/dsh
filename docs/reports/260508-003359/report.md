# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 24/24 (100%) |
| 均分 | 79.2 |
| 修复成功率 | 1/14 |
| 平均修复轮数 | 2.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 8 | 9 | 100% |
| PATCH | 10 | 5 | 100% |
| SEARCH_REPLACE | 4 | 11 | 100% |
| INSERT | 4 | 2 | 100% |
| DELETE | 4 | 4 | 100% |
| RENAME | 4 | 2 | 100% |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 24/24 |
| 工具调用总轮次 | 310 |
| 工具调用总次数 | 424 |
| 调用成功率 | 68% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| read_file | 160 | 98% |
| grep_files | 58 | 100% |
| exec_shell | 195 | 39% |
| 其他无效调用 | 11 | 0% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 24/24 |
| 平均 patch round 数 | 15.5 |
| 平均 change 块数 | 1.7 |
| 平均 invalid 轮数 | 0.6 |
| 工具调用 action 数 | 310 |
| done 主动终止率 | 33% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| loam-bugfix-cli-error-handling | 29 | 2 | 2 | 25 | ✗ |
| loam-docs-provider-readme | 17 | 1 | 0 | 15 | ✓ |
| loam-docs-readme-distill-observability | 5 | 1 | 0 | 3 | ✓ |
| loam-refactor-provider-dedup | 20 | 5 | 0 | 15 | ✗ |
| loam-refactor-rename-distill-state | 12 | 1 | 0 | 11 | ✗ |
| loam-refactor-reorganize-tests | 11 | 1 | 1 | 9 | ✗ |
| loam-test-distill-engine | 16 | 1 | 1 | 13 | ✓ |
| loam-test-distill-state | 16 | 1 | 0 | 15 | ✗ |
| pi-bugfix-count-defs | 11 | 2 | 0 | 9 | ✗ |
| pi-clean-duplicate-matching-report | 4 | 1 | 0 | 2 | ✓ |
| pi-docs-check-tools | 8 | 1 | 0 | 6 | ✓ |
| pi-docs-prune-stale-report-reference | 14 | 2 | 1 | 10 | ✓ |
| pi-refactor-read-text | 12 | 2 | 0 | 10 | ✗ |
| pi-test-aief-l3 | 23 | 1 | 3 | 19 | ✗ |
| pi-test-error-handler | 6 | 1 | 0 | 4 | ✓ |
| rh-bugfix-csv-export | 18 | 1 | 1 | 16 | ✗ |
| rh-mixed-dashboard-generated-at-backend | 20 | 2 | 4 | 14 | ✗ |
| rh-mixed-dashboard-generated-at-frontend | 13 | 2 | 0 | 11 | ✗ |
| rh-mixed-remove-starter-ping-demo-backend | 9 | 2 | 0 | 7 | ✗ |
| rh-mixed-remove-starter-ping-demo-frontend | 8 | 2 | 0 | 5 | ✓ |
| rh-mixed-rename-entity-dialog-frontend | 30 | 2 | 0 | 28 | ✗ |
| rh-mixed-rename-settings-controller-backend | 11 | 1 | 1 | 9 | ✗ |
| rh-refactor-branch-orchestrator | 30 | 3 | 0 | 27 | ✗ |
| rh-test-dashboard-version | 30 | 2 | 1 | 27 | ✗ |

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
| 工具调用 | 25 轮, 31 次 |
| Patch Loop | 29 rounds, 2 changes, DONE=✗ |
| 工具详情 | read_file(13), grep_files(8), exec_shell(10) (68% 成功) |
| 耗时 | 474.6s |

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
| 工具调用 | 15 轮, 19 次 |
| Patch Loop | 17 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(6), grep_files(4), exec_shell(9) (58% 成功) |
| 验证输出 | passed: test -f docs/providers.md\n(no output) |
| 耗时 | 215.4s |

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
| 工具调用 | 3 轮, 3 次 |
| Patch Loop | 5 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(3) (100% 成功) |
| 验证输出 | passed: grep -q '^## Distill Observability' README.md\n(no output)\npassed: awk '/^## Architecture/{seen=1} seen && /^## Distill Observability/{found=1} /^## Current Direction/{exit found ? 0 : 1}' README.md\n(no output) |
| 耗时 | 106.3s |

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
| 工具调用 | 15 轮, 21 次 |
| Patch Loop | 20 rounds, 5 changes, DONE=✗ |
| 工具详情 | read_file(15), exec_shell(6) (71% 成功) |
| 耗时 | 534.9s |

### loam-refactor-rename-distill-state (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/distill/src/distill-state.ts |
| 预期文件 | packages/distill/src/distill-state.ts, packages/distill/src/engine.ts, packages/distill/src/index.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 11 轮, 15 次 |
| Patch Loop | 12 rounds, 1 changes, DONE=✗ |
| 工具详情 | grep_files(2), read_file(5), exec_shell(8) (80% 成功) |
| 耗时 | 288.6s |

### loam-refactor-reorganize-tests (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/distill/src/dag-runner.test.ts -> packages/distill/src/distill-dag-runner.test.ts |
| 预期文件 | packages/distill/src/distill-dag-runner.test.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 9 轮, 9 次 |
| Patch Loop | 11 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(1), exec_shell(8) (44% 成功) |
| 耗时 | 166.6s |

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
| 工具调用 | 13 轮, 25 次 |
| Patch Loop | 16 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(11), grep_files(4), exec_shell(9) (92% 成功) |
| 验证输出 | passed: pnpm --filter @loamlog/distill test\n(no output) |
| 耗时 | 453.4s |

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
| 工具调用 | 15 轮, 18 次 |
| Patch Loop | 16 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(6), grep_files(2), exec_shell(10) (39% 成功) |
| 耗时 | 230.1s |

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
| 工具调用 | 9 轮, 9 次 |
| Patch Loop | 11 rounds, 2 changes, DONE=✗ |
| 工具详情 | read_file(3), exec_shell(6) (33% 成功) |
| 验证输出 | failed: python3 -m pytest tests/unit/domain/test_check_v2_constraints.py -v\n============================= test session starts ==============================\nplatform darwin -- Python 3.14.3, pytest-9.0.3, pluggy-1.6.0 -- /opt/homebrew/opt/python@3.14/bin/python3.14\ncachedir: .pytest_cache\nrootdi |
| 耗时 | 184.4s |

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
| 工具调用 | 2 轮, 3 次 |
| Patch Loop | 4 rounds, 1 changes, DONE=✓ |
| 工具详情 | grep_files(2), read_file(1) (100% 成功) |
| 验证输出 | passed: ! test -f matching_reports/mr-20260227235900.yaml\n(no output)\npassed: python3 -m pytest tests/ -q\n........................................................................ [ 25%]\n........................................................................ [ 51%]\n............................. |
| 耗时 | 42.8s |

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
| 工具调用 | 6 轮, 6 次 |
| Patch Loop | 8 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(3), exec_shell(3) (100% 成功) |
| 验证输出 | passed: python3 tools/check_v2_constraints.py --root .\nPASS v2 constraints |
| 耗时 | 63.9s |

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
| 工具调用 | 10 轮, 14 次 |
| Patch Loop | 14 rounds, 2 changes, DONE=✓ |
| 工具详情 | grep_files(4), read_file(5), exec_shell(4) (77% 成功) |
| 验证输出 | passed: ! test -f matching_reports/mr-20260228000000.yaml\n(no output)\npassed: grep -q 'matching report 不再随仓库保存为固定样例' README.md\n(no output)\npassed: python3 -m pytest tests/ -q\n........................................................................ [ 25%]\n....................................... |
| 耗时 | 94.7s |

### pi-refactor-read-text (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | tools/infra/file_io.py, tools/extract_evidence.py |
| 预期文件 | tools/extract_evidence.py, tools/extract_evidence_llm.py, tools/infra/file_io.py |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 10 轮, 12 次 |
| Patch Loop | 12 rounds, 2 changes, DONE=✗ |
| 工具详情 | read_file(5), exec_shell(6) (91% 成功) |
| 耗时 | 204.0s |

### pi-test-aief-l3 (test) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | tests/unit/domain/test_check_aief_l3.py |
| 预期文件 | tests/unit/domain/test_check_aief_l3.py |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 3 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 19 轮, 22 次 |
| Patch Loop | 23 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(3), exec_shell(19) (64% 成功) |
| 耗时 | 212.6s |

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
| 验证输出 | passed: python3 -m pytest tests/unit/domain/test_error_handler.py -v\n============================= test session starts ==============================\nplatform darwin -- Python 3.14.3, pytest-9.0.3, pluggy-1.6.0 -- /opt/homebrew/opt/python@3.14/bin/python3.14\ncachedir: .pytest_cache\nrootdir: /Use |
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
| 工具调用 | 16 轮, 26 次 |
| Patch Loop | 18 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(11), exec_shell(15) (65% 成功) |
| 耗时 | 168.7s |

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
| 工具调用 | 14 轮, 19 次 |
| Patch Loop | 20 rounds, 2 changes, DONE=✗ |
| 工具详情 | grep_files(6), read_file(7), exec_shell(6) (68% 成功) |
| 耗时 | 253.7s |

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
| 工具调用 | 11 轮, 14 次 |
| Patch Loop | 13 rounds, 2 changes, DONE=✗ |
| 工具详情 | read_file(7), exec_shell(4), grep_files(3) (79% 成功) |
| 验证输出 | passed: grep -q 'generatedAt' frontend/src/api/dashboardApi.ts\n(no output)\npassed: grep -q 'generatedAt' frontend/src/views/dashboard/Dashboard.vue\n(no output)\npassed: (cd frontend && pnpm typecheck)\n> release-hub-web@0.0.0 typecheck /Users/loong/dsh-bench/repos/release-hub/frontend\n> vue-tsc  |
| 耗时 | 69.7s |

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
| 工具调用 | 7 轮, 11 次 |
| Patch Loop | 9 rounds, 2 changes, DONE=✗ |
| 工具详情 | grep_files(3), read_file(2), exec_shell(6) (45% 成功) |
| 验证输出 | passed: ! test -f backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/rest/PingController.java\n(no output)\npassed: ! test -f backend/releasehub-bootstrap/src/test/java/io/releasehub/bootstrap/api/PingApiTest.java\n(no output)\npassed: (cd backend && mvn test -pl releasehub-interfa |
| 耗时 | 81.2s |

### rh-mixed-remove-starter-ping-demo-frontend (refactor) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | frontend/src/components/__tests__/HelloWorld.spec.ts, frontend/src/components/HelloWorld.vue |
| 预期文件 | frontend/src/components/HelloWorld.vue, frontend/src/components/__tests__/HelloWorld.spec.ts |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 5 轮, 8 次 |
| Patch Loop | 8 rounds, 2 changes, DONE=✓ |
| 工具详情 | exec_shell(5), grep_files(1), read_file(2) (63% 成功) |
| 验证输出 | passed: ! test -f frontend/src/components/HelloWorld.vue\n(no output)\npassed: ! test -f frontend/src/components/__tests__/HelloWorld.spec.ts\n(no output)\npassed: (cd frontend && pnpm typecheck)\n> release-hub-web@0.0.0 typecheck /Users/loong/dsh-bench/repos/release-hub/frontend\n> vue-tsc --noEmit |
| 耗时 | 53.4s |

### rh-mixed-rename-entity-dialog-frontend (refactor) — 分数: 54/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | frontend/src/components/common/EntityDialog.vue -> frontend/src/components/common/CrudEntityDialog.vue, frontend/src/views/group/GroupDialog.vue |
| 预期文件 | frontend/src/components/common/CrudEntityDialog.vue |
| 范围越界 | ✗ (额外: frontend/src/views/group/GroupDialog.vue) |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 28 轮, 35 次 |
| Patch Loop | 30 rounds, 2 changes, DONE=✗ |
| 工具详情 | exec_shell(26), grep_files(2), read_file(7) (60% 成功) |
| 耗时 | 186.3s |

### rh-mixed-rename-settings-controller-backend (refactor) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/settings/SystemSettingsController.java |
| 预期文件 | backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/settings/SystemSettingsController.java |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 1 |
| 修复成功 | ✓ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 9 轮, 9 次 |
| Patch Loop | 11 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(1), grep_files(1), exec_shell(6) (25% 成功) |
| 耗时 | 161.0s |

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
| 工具调用 | 27 轮, 40 次 |
| Patch Loop | 30 rounds, 3 changes, DONE=✗ |
| 工具详情 | read_file(17), grep_files(9), exec_shell(8) (85% 成功) |
| 耗时 | 565.4s |

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
| 工具调用 | 27 轮, 49 次 |
| Patch Loop | 30 rounds, 2 changes, DONE=✗ |
| 工具详情 | exec_shell(19), read_file(22), grep_files(7) (83% 成功) |
| 耗时 | 264.6s |

## 失败分析

- **loam-bugfix-cli-error-handling**: 修复耗尽
- **loam-refactor-provider-dedup**: 范围越界; 修复耗尽
- **loam-refactor-rename-distill-state**: 修复耗尽
- **loam-refactor-reorganize-tests**: 修复耗尽
- **loam-test-distill-state**: 修复耗尽
- **pi-bugfix-count-defs**: 修复耗尽
- **pi-refactor-read-text**: 修复耗尽
- **pi-test-aief-l3**: 修复耗尽
- **rh-bugfix-csv-export**: 修复耗尽
- **rh-mixed-dashboard-generated-at-backend**: 修复耗尽
- **rh-mixed-rename-entity-dialog-frontend**: 范围越界; 修复耗尽
- **rh-refactor-branch-orchestrator**: 修复耗尽
- **rh-test-dashboard-version**: 修复耗尽
