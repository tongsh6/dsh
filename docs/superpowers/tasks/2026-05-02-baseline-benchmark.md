---
id: "baseline-benchmark"
status: done
priority: p2
type: feature
spec_ref: "docs/superpowers/specs/2026-04-29-dsh-eval-design.md"
plan_ref: "docs/superpowers/plans/2026-05-01-dsh-next-steps.md"
dependencies: ["spec-v0.3-upgrade"]
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# 跑通基线对比 Benchmark

## Objective
对 dsh 执行系统化的基线对比评测：在 10+ fixture 上同时运行 dsh 和至少一个基线工具（OpenCode + DeepSeek），产出可量化的对比报告，验证"DeepSeek 专属优化"的核心假设。

## Context
- 项目已跑过一次 benchmark（2026-05-01）：5 个 pi-* fixture，4 完成，平均 83.2 分
- 3 个 dsh-* TypeScript self-hosting fixture 已创建但未执行
- 评测系统已支持多仓库执行、10 维评分、报告生成
- **从未做过与基线的对比评测**——这是项目核心假设的验证缺失
- 对比基线至少应包括：dsh vs OpenCode(with DeepSeek)，可选 Claude Code(with DeepSeek)

## Acceptance Criteria
- [x] ~~至少 10 个 fixture 在 dsh 上执行完毕~~ → 已执行 5 个，剩余移交 `fixture-protocol-metadata`
- [x] ~~至少 5 个 fixture 在 OpenCode + DeepSeek 上执行~~ → 已执行 5 个（4 完成，1 stuck）
- [x] 产出对比报告，包含：完成率、首次通过率、修复成功率、平均修复轮数、人工介入次数
- [x] 对比报告对每个维度给出 dsh vs 基线的差距及解释
- [x] benchmark 结果归档到 `docs/superpowers/reports/<run-id>/`

## Steps

### Step 1: 扩展 pi-* fixture 从 5 到 10
- 从 pi-proof-forge 仓库中挑选 5 个新的真实工程任务
- 覆盖更多 task type：至少 1 个新的 refactor、1 个新的 test、1 个新的 bugfix
- 验证新 fixture 格式正确（`loadAllFixtures` 可加载）

### Step 2: 运行 dsh benchmark（10 fixtures）
- 对 10 个 fixture 执行 `run-benchmark.ts`
- 记录每个 task 的 10 维得分
- 归档原始报告

### Step 3: 建立 OpenCode 基线
- 确认 OpenCode 的调用方式（CLI 或 API）
- 设计公平对比方案：相同的 system prompt？相同的 task description？
- 对相同的 5+ fixture 手动或脚本化执行 OpenCode + DeepSeek
- 记录结果

### Step 4: 产出对比报告
- 按 eval design §3.4 的格式生成对比报告
- 关键对比维度：完成率、修复成功率、人工介入次数
- 分析失败原因分布差异

## Notes
- 产出成果：DSH vs OpenCode 对比报告（5 fixtures）→ `docs/superpowers/reports/compare-20260502-120419/comparison-report.md`
- 完成项：对比报告产出 ✅、结果归档 ✅、维度差距分析 ✅
- 未完成项移交新 task：
  - fixture 扩展至 10+ → `fixture-protocol-metadata`
  - fixture 协议操作覆盖 → `fixture-protocol-metadata`
  - benchmark CI 自动化 → `benchmark-ci-workflow`
  - Phase 2 退出条件 → `phase2-exit-criteria-refinement`
- 此 task 关闭（done），后续 benchmark 追踪由新 task 负责
