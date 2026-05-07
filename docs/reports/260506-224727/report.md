# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 13/13 (100%) |
| 均分 | 82.8 |
| 修复成功率 | 0/6 |
| 平均修复轮数 | 2.2 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 8 | 6 | 100% |
| PATCH | 8 | 2 | 100% |
| SEARCH_REPLACE | 3 | 4 | 100% |
| INSERT | 1 | 1 | 100% |
| DELETE | 0 | 0 | N/A |
| RENAME | 0 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 13/13 |
| 工具调用总轮次 | 222 |
| 工具调用总次数 | 319 |
| 调用成功率 | 68% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| read_file | 111 | 97% |
| grep_files | 49 | 88% |
| exec_shell | 147 | 44% |
| 其他无效调用 | 12 | 0% |

## Patch Loop 行为

| 指标 | 数值 |
|--------|-------|
| 使用 patch loop 的 fixture | 13/13 |
| 平均 patch round 数 | 18.7 |
| 平均 change 块数 | 1.2 |
| 平均 invalid 轮数 | 0.1 |
| 工具调用 action 数 | 222 |
| done 主动终止率 | 31% |

| Fixture | Rounds | Changes | Invalid | Tools | Done |
|----------|--------|---------|---------|-------|------|
| loam-bugfix-cli-error-handling | 27 | 2 | 0 | 25 | ✗ |
| loam-docs-provider-readme | 8 | 1 | 0 | 6 | ✓ |
| loam-refactor-provider-dedup | 14 | 1 | 0 | 13 | ✗ |
| loam-test-distill-engine | 30 | 1 | 0 | 29 | ✗ |
| loam-test-distill-state | 20 | 1 | 1 | 17 | ✓ |
| pi-bugfix-count-defs | 12 | 2 | 0 | 10 | ✗ |
| pi-docs-check-tools | 25 | 1 | 0 | 23 | ✓ |
| pi-refactor-read-text | 13 | 3 | 0 | 10 | ✗ |
| pi-test-aief-l3 | 16 | 1 | 0 | 15 | ✗ |
| pi-test-error-handler | 5 | 1 | 0 | 3 | ✓ |
| rh-bugfix-csv-export | 22 | 1 | 0 | 21 | ✗ |
| rh-refactor-branch-orchestrator | 30 | 0 | 0 | 30 | ✗ |
| rh-test-dashboard-version | 21 | 1 | 0 | 20 | ✗ |

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
| 工具调用 | 25 轮, 31 次 |
| Patch Loop | 27 rounds, 2 changes, DONE=✗ |
| 工具详情 | read_file(7), grep_files(6), exec_shell(14) (93% 成功) |
| 耗时 | 556.5s |

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
| 工具调用 | 6 轮, 15 次 |
| Patch Loop | 8 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(11), grep_files(4) (100% 成功) |
| 耗时 | 147.7s |

### loam-refactor-provider-dedup (refactor) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/distill/src/providers/shared.ts |
| 预期文件 | packages/distill/src/providers/shared.ts, packages/distill/src/providers/openai.ts, packages/distill/src/providers/deepseek.ts, packages/distill/src/providers/anthropic.ts |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 13 轮, 18 次 |
| Patch Loop | 14 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(5), exec_shell(12), grep_files(1) (89% 成功) |
| 耗时 | 298.1s |

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
| 工具详情 | read_file(14), grep_files(3), exec_shell(24) (59% 成功) |
| 耗时 | 526.7s |

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
| 工具调用 | 17 轮, 25 次 |
| Patch Loop | 20 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(6), grep_files(2), exec_shell(17) (60% 成功) |
| 耗时 | 266.0s |

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
| 工具调用 | 10 轮, 12 次 |
| Patch Loop | 12 rounds, 2 changes, DONE=✗ |
| 工具详情 | read_file(3), exec_shell(6), grep_files(3) (58% 成功) |
| 耗时 | 150.2s |

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
| 工具调用 | 23 轮, 23 次 |
| Patch Loop | 25 rounds, 1 changes, DONE=✓ |
| 工具详情 | read_file(4), exec_shell(19) (74% 成功) |
| 耗时 | 167.7s |

### pi-refactor-read-text (refactor) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | tools/infra/file_io.py, tools/extract_evidence.py, tools/extract_evidence_llm.py |
| 预期文件 | tools/extract_evidence.py, tools/extract_evidence_llm.py, tools/infra/file_io.py |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 工具调用 | 10 轮, 14 次 |
| Patch Loop | 13 rounds, 3 changes, DONE=✗ |
| 工具详情 | read_file(7), exec_shell(3), grep_files(4) (64% 成功) |
| 耗时 | 74.5s |

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
| 工具调用 | 15 轮, 16 次 |
| Patch Loop | 16 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(5), exec_shell(10), grep_files(1) (56% 成功) |
| 耗时 | 283.7s |

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
| 工具详情 | read_file(4), exec_shell(1) (100% 成功) |
| 耗时 | 65.8s |

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
| 工具调用 | 21 轮, 32 次 |
| Patch Loop | 22 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(8), exec_shell(13), grep_files(11) (69% 成功) |
| 耗时 | 206.3s |

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
| 工具调用 | 30 轮, 47 次 |
| Patch Loop | 30 rounds, 0 changes, DONE=✗ |
| 工具详情 | exec_shell(22), read_file(14), grep_files(11) (62% 成功) |
| 耗时 | 592.6s |

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
| 工具调用 | 20 轮, 40 次 |
| Patch Loop | 21 rounds, 1 changes, DONE=✗ |
| 工具详情 | read_file(23), exec_shell(6), grep_files(3) (72% 成功) |
| 耗时 | 616.3s |

## 失败分析

- **loam-bugfix-cli-error-handling**: 修复耗尽
- **pi-bugfix-count-defs**: 修复耗尽
- **pi-test-aief-l3**: 修复耗尽
- **rh-bugfix-csv-export**: 修复耗尽
- **rh-refactor-branch-orchestrator**: 修复耗尽
- **rh-test-dashboard-version**: 修复耗尽
