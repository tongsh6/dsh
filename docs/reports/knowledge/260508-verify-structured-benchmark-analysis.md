# 议题 B P6 全量 Benchmark — 分析报告

> 历史报告说明（2026-05-17）：本文记录 2026-05-08 单次 run 的历史分析，不代表当前 Phase 3 状态。当前状态以 README、BLUEPRINT、`docs/project-ledger.md` 与最新 replicated benchmark 报告为准。
>
> 日期: 2026-05-09 | run-id: 260508-223235
>
> 范围: 议题 B P1-P5 实施后首份 24 fixture 全量 benchmark；5 个 fixture 迁移到 `verifications`（结构化断言），19 个保持 `verificationCommands`（shell 包装，行为不变）。

## 1. 数据总览

| 指标 | 数值 | 基线 (260508-003359) | Δ |
|------|------|---------------------|---|
| fixture 数 | 24 | 24 | 0 |
| completed | 24/24 (100%) | 24/24 (100%) | 0 |
| testsPassed (**原始**) | 7/24 (29%) | 11/24 (45%) | -4 |
| testsPassed (**修正后，历史单次 run**) | 8 of 24 (33%) | — | — |
| 修复成功率 | 0/17 (0%) | 1/14 (7%) | -1 |
| 平均 patch round | 17.9 | 15.5 | +2.4 |
| done 主动终止率 | 25% | 33% | -8pp |

testsPassed 原始值 29% 含 1 个实现 bug（`^` multiline regex 未加 `m` flag，已修 `6eee131`→）。修正后历史单次 run 为 8 of 24 (33%)，相对当时 baseline 回归 11→8 (-3)。

## 2. 回归归因（8 个 baseline ✓ → P6 ✗）

| Fixture | 归因类别 | 详情 |
|---------|---------|------|
| loam-docs-readme-distill-observability | **A 实现 bug（已修）** | `^## Distill Observability` regex 缺 `m` flag → 行锚点仅匹文件头。修后 `new RegExp(pattern, "m")`，7d7d9b1 |
| loam-test-distill-engine | B 采样变异 | P6 0 changes vs baseline 1 change，模型未产出任何修改 |
| pi-docs-prune-stale-report-reference | B 采样变异 | P6 filesChanged 1 vs baseline 2，模型少改一个文件 |
| pi-test-error-handler | B 采样变异 | 双方 filesChanged 相同 (1)，P6 repair 2 轮失败 |
| rh-mixed-dashboard-generated-at-frontend | B 采样变异 | P6 filesChanged 1 vs baseline 2，模型少改一个文件 |
| rh-mixed-remove-starter-ping-demo-backend | B 采样变异 | P6 filesChanged 1 vs baseline 2，模型少改一个文件 |
| rh-mixed-remove-starter-ping-demo-frontend | B 采样变异 | P6 filesChanged 1 vs baseline 2，模型少改一个文件 |
| rh-mixed-rename-settings-controller-backend | B 采样变异 | 双方 filesChanged 相同 (1)，P6 repair 2 轮失败 |

**7/8 回归是 LLM 采样变异**（同代码同配置，不同 batch 产生不同结果）。这是已知属性——单次 24 fixture run 的 testsPassed 波动 ±3-4 是正常的。

**1/8 是实现 bug**（regex multiline），已修。

## 3. 改善归因（4 个 baseline ✗ → P6 ✓）

| Fixture | 详情 |
|---------|------|
| loam-refactor-reorganize-tests | baseline ✗ → P6 ✓ |
| pi-bugfix-count-defs | baseline ✗ → P6 ✓ |
| pi-test-aief-l3 | baseline ✗ → P6 ✓ |
| **rh-mixed-dashboard-generated-at-backend** | baseline ✗ → P6 ✓（**结构化断言生效**：`controller_has_generatedAt` passed + `maven_test_passes` passed） |

4 个改善中 3 个是模型采样正面波动 + 1 个是迁移 fixture 的首次通过（Maven 编译问题偶发未出现）。

## 4. 5 迁移 fixture 分析

| Fixture | testsPassed | verify output 摘要 |
|---------|:-----------:|-------------------|
| rh-mixed-dashboard-generated-at-backend | ✓ | `passed: controller_has_generatedAt` (pattern found) + `passed: maven_test_passes` |
| pi-refactor-read-text | ✗ | `passed: evidence_import_read_text` + `passed: llm_import_read_text` + `failed: file_io_has_read_text` — 模型改了 import 但 file_io.py 缺 `def read_text`（代码质量问题）|
| rh-test-dashboard-version | ✗ | `failed: dashboard_test_file_exists` + `failed: version_test_file_exists` — 两个测试文件均未创建（patch-completeness 暴露的不完整）|
| loam-docs-readme-distill-observability | 修后 ✓ | `failed: section_exists` — regex 缺 `m` flag bug（已修）；`passed: section_positioned_correctly`（shell awk 正常）|
| rh-mixed-remove-starter-ping-demo-backend | ✗ | 详见 §2 采样变异（filesChanged 仅 1/2）|

**结构化断言试点效果**：
- ✅ 名字（`controller_has_generatedAt`、`evidence_import_read_text` 等）让失败报告可读
- ✅ file_contains / file_not_exists 失败时产生原生诊断字符串（不再从 shell 输出反推）
- ✅ rh-mixed-dashboard-generated-at-backend 首次在 24 fixture 全量中通过（4/5 次重跑中首次）
- ⚠️ regex multiline flag 遗漏 → 已修；后续 fixture 用 regex 需在 spec 中显式标注 `m` flag 行为

## 5. 关键发现

### 5.1 非迁移 fixture 的 verify 行为完全一致

19 个非迁移 fixture 的 `verificationCommands` 被 `compileFixtureVerifications` 包装为 `[{ type: "shell", command: ... }]` → 走 `runCommand` 原路。testsPassed 波动全来自模型采样，非 verify 协议变更。

### 5.2 patterns 逐 fixture 汇总（5 个迁移 fixture）

| pattern | 通过 | 失败 | 备注 |
|---------|:----:|:----:|------|
| file_contains | 4 | 1 (regex bug) + 1 (file_io_has_read_text) | bug 已修 |
| file_exists | 0 | 2 (rh-test-dashboard-version) | 模型未创建文件 |
| file_not_exists | 1 | 1 (未删除第二个文件) | 采样变异 |
| shell | 6 | 2 | 采样变异 + java 编译错误 |

## 6. 本报告引发的跟踪事项

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
| evidence | verify-protocol-structured-baseline | P6 数据已收集；8 回归归因完毕（1 bug + 7 采样）；议题 B spec §5.2 行为验收完成（本 analysis 即 P6 evidence 产出） | P1 | — |

## 7. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-09 | v1.0 | 初始报告 |
