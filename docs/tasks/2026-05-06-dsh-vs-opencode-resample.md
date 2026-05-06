---
id: "dsh-vs-oc-resample"
status: in_progress
priority: p2
type: test
plan_ref: "docs/reports/phase-2-exit-review.md"
dependencies: []
created: "2026-05-06"
updated: "2026-05-06"
assignee: "ai"
---

# DSH vs OpenCode 对比重跑

## Objective
用相同的 13 fixture（pi-, loam-, rh-）在 OpenCode 上跑一次 benchmark，与 DSH 的最新全量 benchmark（260506-004042）做逐件对比。解决 ledger §8 中 `evidence dsh-vs-oc-resample` 的「5 fixture 样本量不足」问题。

## Context
- Ledger §8: `evidence dsh-vs-oc-resample` → status=ready（Phase 2 退出复审时 promote）
- 基线: `docs/reports/260506-004042`（DSH 13 fixture 全量 benchmark）
- 旧对比: `docs/reports/compare-20260502-120419`（仅 5 fixture，当时 DSH 完成率 60%）
- 工具: OpenCode CLI（DeepSeek 模型，与 DSH 相同的 `deepseek-v4-pro` 或最新模型）

## Acceptance Criteria
- [ ] OpenCode 在 13 fixture 上全部跑完
- [ ] 对比报告产出（`docs/reports/<run_id>/opencode-comparison.md`）
- [ ] 对比维度：完成率、测试通过率、均分、平均修复轮数、协议操作触发、工具使用
- [ ] 报告含逐 fixture 对比表
- [ ] 报告结论明确：DSH 领先、OpenCode 领先、或持平
- [ ] 如果对比结果有统计意义，更新 ledger §8 `dsh-vs-oc-resample` 为 resolved
- [ ] 如果对比结果不足以结论，更新 last_reviewed 并注明需要补充的 fixture 或 run 数

## Steps

### Step 1: 检查环境
确认 OpenCode 是否已安装、DeepSeek API Key 是否能被 OpenCode 使用。

### Step 2: 跑 OpenCode benchmark
对每个 fixture 的 repo，用 OpenCode 执行相同的 task prompt。

### Step 3: 生成对比报告
与 DSH 基准数据对比。写入对比报告。

### Step 4: 更新 ledger
根据对比结论更新 `dsh-vs-oc-resample` 的 status。

## Notes
- 需要 OpenCode CLI + DeepSeek API 访问
- 建议用 `--model deepseek/deepseek-v4-pro`（与 DSH 一致的模型）
- OpenCode 不需要单独构建，可直接用 task prompt 字符串
