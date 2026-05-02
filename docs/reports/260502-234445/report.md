# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 6/8 (75%) |
| 均分 | 67.4 |
| 修复成功率 | 0/2 |
| 平均修复轮数 | 2.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 3 | 1 | 100% |
| PATCH | 7 | 0 | N/A |
| SEARCH_REPLACE | 1 | 5 | 100% |
| INSERT | 0 | 0 | N/A |
| DELETE | 0 | 0 | N/A |
| RENAME | 0 | 0 | N/A |

## 逐任务详情

### dsh-bugfix-scanner-ts (bugfix) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/repo/src/scanner.test.ts, packages/repo/src/scanner.ts |
| 预期文件 | packages/repo/src/scanner.ts, packages/repo/src/scanner.test.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 耗时 | 411.0s |

### dsh-refactor-config (refactor) — 分数: 20/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✗ |
| 修改文件 | (无) |
| 预期文件 | packages/repo/src/config-loader.ts, packages/cli/src/utils/config.ts, packages/core/src/pipeline.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 0/3 |
| 耗时 | 422.8s |
| 错误 | 变更应用失败 — parse failed |

### dsh-test-scanner (test) — 分数: 74/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | packages/repo/src/scanner.test.ts, packages/repo/src/scanner.test.ts |
| 预期文件 | packages/repo/src/scanner.test.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 耗时 | 705.1s |
| 错误 | repair failed: Request timed out |

### pi-bugfix-count-defs (bugfix) — 分数: 64/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | tools/check_v2_constraints.py, tools/check_v2_constraints.py |
| 预期文件 | tools/check_v2_constraints.py |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 2 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 耗时 | 317.3s |

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
| 耗时 | 66.0s |

### pi-refactor-read-text (refactor) — 分数: 99/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✓ |
| 修改文件 | tools/extract_evidence.py, tools/extract_evidence_llm.py, tools/extract_evidence.py, tools/extract_evidence_llm.py |
| 预期文件 | tools/extract_evidence.py, tools/extract_evidence_llm.py, tools/infra/file_io.py |
| 范围越界 | ✓ |
| 测试通过 | ✓ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 2/3 |
| 耗时 | 214.2s |

### pi-test-aief-l3 (test) — 分数: 20/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✗ |
| 修改文件 | (无) |
| 预期文件 | tests/unit/domain/test_check_aief_l3.py |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 0/3 |
| 耗时 | 212.3s |
| 错误 | 变更应用失败 — CREATE rejected: tests/unit/domain/test_check_aief_l3.py already exists. Use <PATCH> or <PATCH type="search"> to modify existing files. |

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
| 耗时 | 47.0s |

## 失败分析

- **dsh-bugfix-scanner-ts**: 修复耗尽
- **dsh-refactor-config**: 任务未完成; 修复耗尽
- **dsh-test-scanner**: 修复耗尽
- **pi-bugfix-count-defs**: 修复耗尽
- **pi-test-aief-l3**: 任务未完成; 修复耗尽
