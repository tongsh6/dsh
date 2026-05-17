---
id: "phase3-exit-benchmark-evidence"
status: blocked
priority: p0
type: test
spec_ref: "BLUEPRINT.md"
dependencies: ["fixture-metadata-audit", "failure-matrix-governance-invariants"]
created: "2026-05-18"
updated: "2026-05-18"
assignee: "ai"
---

# Phase 3 最新 N=3 replicated benchmark 退出证据

## Objective
跑一轮符合 BLUEPRINT §2.5 方法论的 Phase 3 退出 benchmark，并归档可审计报告，判断 Project Card on 是否仍满足 Phase 3 `testsPassed >60%` 目标。

## Context
当前 Phase 3 剩余退出 blocker 是 benchmark 证据闭环，不是 fixture contamination、legacy scanner 或 ProjectIntelligence wiring。`benchmark-fixture-contamination-audit` 已收口；本任务必须保留 failure matrix 的 `evidencePolicy` 标签，避免历史污染 evidence 或 scope-reshaping fixture 被错误纳入退出判断。

## Acceptance Criteria
- [ ] 使用 N>=3 replicated benchmark，记录 seed、样本量、配置、随机化方式和 hard cleanup 策略。
- [ ] 报告包含 `failureMatrixSummary` 和本轮涉及的 `failureMatrixFixtures`，并明确 `label_required` / `exclude_from_phase3_exit` 的处理方式。
- [ ] Project Card on 聚合 `testsPassed >60%`。
- [ ] Project Card on 相对 off 保持正向；如果不正向，报告必须给出 fixture 级归因和 Phase 3 是否可退出的结论。
- [ ] `rh-refactor-branch-orchestrator-*` 拆分 fixture 的 N=3 结果单独标注，不作为原 monolith 的等价恢复。
- [ ] high-variance fixture 单独报告，不作单 fixture 硬门禁。
- [ ] 归档报告到 `docs/reports/knowledge/<YYYYMMDD>-phase3-exit-benchmark.md`。
- [ ] 更新 `docs/project-ledger.md` §1、§3、§4、§6 中的 Phase 3 退出证据状态。
- [ ] `pnpm run scan` 通过，或报告中明确非本轮引入的失败证据。

## Steps

### Step 1: 运行 replicated benchmark
- 使用当前 `scripts/benchmark-pie-replicated.ts` 入口。
- 保留 hard cleanup，避免 `.dsh`、构建产物或 fixture 残留污染。
- 如使用 lane 并发，报告中记录 `--lanes-per-repo` 与 Maven repo 串行限制。

### Step 2: 归档报告
- 从 runlog metadata 和 results 生成知识库报告。
- 报告必须引用 baseline、runlog、failure matrix governance 和 Phase 3 退出判定。

### Step 3: 更新台账
- 只在报告完成后更新 Phase 3 退出条件 checkbox。
- AI 不得把相关 task 自行置为 done；完成后停在 `in_review` 等人类 review。

## Notes
- Blocked until `fixture-metadata-audit` and `failure-matrix-governance-invariants` pass human review or are otherwise approved for use as Phase 3 exit evidence prerequisites.
- 需要可用 `DEEPSEEK_API_KEY` 和可接受的 benchmark 成本/耗时。
- 不允许为了提升单 fixture 通过率添加 fixture-specific answer hints 或 harness-side prompt scraping。
