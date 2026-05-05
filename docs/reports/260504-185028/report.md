# DSH 评测报告

## 概览

| 指标 | 数值 |
|--------|-------|
| 任务完成率 | 0/1 (0%) |
| 均分 | 20.0 |
| 修复成功率 | 0/N/A |
| 平均修复轮数 | 0.0 |
| 平均人工介入 | 0.0 |

## 协议操作覆盖

| 操作 | 预期（fixture 标注） | 实际触发 | 成功率 |
|-----------|---------------------|---------------------|--------------|
| CREATE | 0 | 0 | N/A |
| PATCH | 1 | 0 | N/A |
| SEARCH_REPLACE | 0 | 0 | N/A |
| INSERT | 0 | 0 | N/A |
| DELETE | 0 | 0 | N/A |
| RENAME | 0 | 0 | N/A |
## 工具使用

| 指标 | 数值 |
|--------|-------|
| 使用工具的 fixture | 1/1 |
| 工具调用总轮次 | 5 |
| 工具调用总次数 | 12 |
| 调用成功率 | 83% |

| 工具 | 调用次数 | 成功率 |
|--------|-----------|--------|
| read_file | 5 | 100% |
| grep_files | 5 | 100% |
| exec_shell | 2 | 0% |

## 逐任务详情

### loam-bugfix-cli-error-handling (bugfix) — 分数: 20/100

| 维度 | 结果 |
|-----------|--------|
| 完成 | ✗ |
| 修改文件 | (无) |
| 预期文件 | packages/cli/src/capture.ts, packages/cli/src/distill.ts, packages/cli/src/daemon.ts |
| 范围越界 | ✓ |
| 测试通过 | ✗ |
| 修复轮数 | 0 |
| 修复成功 | ✗ |
| 规则违规 | 0 |
| 交接质量 | 0/3 |
| 工具调用 | 5 轮, 12 次 |
| 工具详情 | read_file(✓), read_file(✓), read_file(✓), grep_files(✓), grep_files(✓), read_file(✓), grep_files(✓), read_file(✓), grep_files(✓), exec_shell(✗), exec_shell(✗), grep_files(✓) |
| 耗时 | 182.8s |
| 错误 | 变更应用失败 — parse failed |

## 失败分析

- **loam-bugfix-cli-error-handling**: 任务未完成; 修复耗尽
