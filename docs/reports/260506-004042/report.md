# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 13/13 (100%) |
| 均分 | 82.8 |
| 修复成功率 | 0/6 |
| 平均修复轮数 | 1.8 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 7 | 5 | 100% |
| PATCH | 9 | 2 | 100% |
| SEARCH_REPLACE | 1 | 7 | 100% |
| INSERT | 0 | 2 | 100% |
| DELETE | 0 | 0 | N/A |
| RENAME | 0 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 13/13 |
| 工具调用总轮次 | 271 |
| 工具调用总次数 | 359 |
| 调用成功率 | 65% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| exec_shell | 170 | 34% |
| read_file | 140 | 99% |
| grep_files | 41 | 93% |
| insert | 1 | 0% |
| create | 3 | 0% |
| CREATE | 2 | 0% |
| PATCH | 2 | 0% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 13/13 |
| 平均 patch round 数 | 23.6 |
| 平均 change 块数 | 1.7 |
| 平均 invalid 轮数 | 0.8 |
| 工具调用 action 数 | 271 |
| done 主动终止率 | 31% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| loam-bugfix-cli-error-handling | 30 | 4 | 0 | 26 | ✗ |
| loam-docs-provider-readme | 10 | 1 | 0 | 8 | ✓ |
| loam-refactor-provider-dedup | 30 | 1 | 1 | 28 | ✗ |
| loam-test-distill-engine | 30 | 1 | 0 | 29 | ✗ |
| loam-test-distill-state | 30 | 0 | 0 | 30 | ✗ |
| pi-bugfix-count-defs | 30 | 2 | 5 | 23 | ✗ |
| pi-docs-check-tools | 5 | 1 | 0 | 3 | ✓ |
| pi-refactor-read-text | 30 | 3 | 0 | 27 | ✗ |
| pi-test-aief-l3 | 17 | 1 | 1 | 14 | ✓ |
| pi-test-error-handler | 5 | 1 | 0 | 3 | ✓ |
| rh-bugfix-csv-export | 30 | 3 | 1 | 26 | ✗ |
| rh-refactor-branch-orchestrator | 30 | 3 | 2 | 25 | ✗ |
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
| 工具调用 | 26 轮, 28 次 |
| Patch Loop | 30 rounds, 4 changes, DONE=✗ |
| 工具详情 | exec_shell(14), read_file(11), grep_files(3) (71% 成功) |
| 耗时 | 763.2s |

### loam-docs-provider-readme (docs) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | docs/providers.md |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 1 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 8 轮, 15 次 |
| Patch Loop | 10 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(10), grep_files(1), exec_shell(4) (80% 成功) |
| 耗时 | 150.6s |

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
| 工具调用 | 28 轮, 33 次 |
| Patch Loop | 30 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(10), grep_files(4), exec_shell(19) (61% 成功) |
| 耗时 | 403.7s |

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
| 工具调用 | 29 轮, 41 次 |
| Patch Loop | 30 rounds, 1 changes, DONE=✗ |
| 工具详情 | exec_shell(23), read_file(15), grep_files(3) (51% 成功) |
| 耗时 | 292.3s |

### loam-test-distill-state (test) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | (无) |
| 预期文件 | packages/distill/src/state.test.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 30 轮, 34 次 |
| Patch Loop | 30 rounds, 0 changes, DONE=✗ |
| 工具详情 | read_file(5), exec_shell(28), grep_files(1) (41% 成功) |
| 耗时 | 227.0s |

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
| 工具调用 | 23 轮, 31 次 |
| Patch Loop | 30 rounds, 2 changes, DONE=✗ |
| 工具详情 | read_file(9), exec_shell(18), grep_files(4) (52% 成功) |
| 耗时 | 197.1s |

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
| 工具调用 | 3 轮, 3 次 |
| Patch Loop | 5 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(2), insert(1) (67% 成功) |
| 耗时 | 78.8s |

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
| 工具调用 | 27 轮, 27 次 |
| Patch Loop | 30 rounds, 3 changes, DONE=✗ |
| 工具详情 | read_file(7), exec_shell(19), grep_files(1) (81% 成功) |
| 耗时 | 343.3s |

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
| 工具调用 | 14 轮, 15 次 |
| Patch Loop | 17 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(3), exec_shell(10), create(2) (47% 成功) |
| 耗时 | 147.1s |

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
| 工具调用 | 3 轮, 5 次 |
| Patch Loop | 5 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(3), grep_files(1), exec_shell(1) (100% 成功) |
| 耗时 | 50.5s |

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
| 工具调用 | 26 轮, 33 次 |
| Patch Loop | 30 rounds, 3 changes, DONE=✗ |
| 工具详情 | read_file(20), grep_files(2), exec_shell(11) (73% 成功) |
| 耗时 | 226.9s |

### rh-refactor-branch-orchestrator (refactor) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-application/src/main/java/io/releasehub/application/release/BranchOperationOrchestrator.java, backend/releasehub-application/src/main/java/io/releasehub/application/release/CodeMergeService.java, backend/releasehub-application/src/main/java/io/releasehub/application/release/ReleaseBranchService.java |
| 预期文件 | backend/releasehub-application/src/main/java/io/releasehub/application/release/BranchOperationOrchestrator.java, backend/releasehub-application/src/main/java/io/releasehub/application/release/CodeMergeService.java, backend/releasehub-application/src/main/java/io/releasehub/application/release/ReleaseBranchService.java, backend/releasehub-application/src/main/java/io/releasehub/application/window/AttachAppService.java, backend/releasehub-application/src/test/java/io/releasehub/application/release/BranchOperationOrchestratorTest.java |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 25 轮, 43 次 |
| Patch Loop | 30 rounds, 3 changes, DONE=✗ |
| 工具详情 | exec_shell(11), grep_files(10), read_file(21), create(1) (77% 成功) |
| 耗时 | 673.7s |

### rh-test-dashboard-version (test) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | backend/releasehub-application/src/test/java/io/releasehub/application/dashboard/DashboardAppServiceTest.java |
| 预期文件 | backend/releasehub-application/src/test/java/io/releasehub/application/dashboard/DashboardAppServiceTest.java, backend/releasehub-application/src/test/java/io/releasehub/application/version/VersionUpdateAppServiceTest.java |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 29 轮, 51 次 |
| Patch Loop | 30 rounds, 1 changes, DONE=✗ |
| 工具详情 | grep_files(11), read_file(24), exec_shell(12), CREATE(2), PATCH(2) (75% 成功) |
| 耗时 | 222.6s |

## 失败分析

- **loam-bugfix-cli-error-handling**: 修复耗尽
- **loam-docs-provider-readme**: 修复耗尽
- **loam-refactor-provider-dedup**: 修复耗尽
- **loam-test-distill-state**: 修复耗尽
- **rh-bugfix-csv-export**: 修复耗尽
- **rh-refactor-branch-orchestrator**: 修复耗尽
