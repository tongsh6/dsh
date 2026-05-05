---
id: "patchloop-p6-e2e-validation"
status: backlog
priority: p1
type: test
spec_ref: "docs/specs/2026-05-05-patch-loop-architecture.md"
plan_ref: "docs/plans/2026-05-05-patch-loop-architecture.md"
dependencies: ["patchloop-p5-benchmark-adapt"]
created: "2026-05-05"
updated: "2026-05-05"
assignee: "ai"
---

# P6：端到端验证 + benchmark 对比 + ship/回退决策

## Objective
在真实 DeepSeek API 上跑 v0.4 patch loop，对比 v0.3 batch 基线数据。决定 ship 或触发 spec §7.2 回退。验收 spec §5 全部成功标准。完成后转 ledger §8 中相关条目状态。

## Context
- Spec: `docs/specs/2026-05-05-patch-loop-architecture.md` §5 / §7.2
- Plan: `docs/plans/2026-05-05-patch-loop-architecture.md` Phase P6
- 依赖 P5 完成（benchmark-runner 能产出 patch_rounds 数据）

## Acceptance Criteria
- [ ] 在 dsh 自身仓库自托管端到端跑通 ≥1 任务，产出 task-state.json 含合理 patch_rounds 数组
- [ ] 跑 ≥3 fixtures × 3 次（含多文件 `loam-bugfix-cli-error-handling`）
- [ ] 数据汇总到 `docs/reports/<run_id>/patchloop-vs-batch.md`
- [ ] 行为指标对比满足 spec §5.2：
  - 多文件任务完成率 ≥ 67%
  - 单文件任务完成率 ≥ 95%
  - 平均工具调用轮数 ≤ v0.3 基线 + 50%
  - 单 fixture API 调用 ≤ 30 轮
  - partial_ok 案例 verify 阶段确实进入 repair（不再静默失败）
- [ ] 性能指标满足 spec §5.3：
  - 总耗时 ≤ v0.3 基线 × 2.5
  - token 总成本 ≤ v0.3 × 3
- [ ] **决策**：ship 或回退
  - 满足全部上述 → ship；ledger §8 标 `bug multi-file-patch-output-incomplete` → resolved，`evidence patchloop-vs-batch-baseline` → resolved
  - 不满足 → 触发 spec §7.2 回退（git revert P3+P4 commits + env flag），开新 spec 分析；ledger §8 上述条目 last_reviewed 更新但保留 waiting

## Steps

### Step 1: 自托管验证（plan P6.1）
在 dsh 仓库选 1 个真实任务（推荐 `dsh-test-scanner` 或类似），跑 `runFullPipeline` 端到端。手动 cat .dsh/task-state.json 观测 patch_rounds 结构合理。

### Step 2: 多 fixture × 3 次跑（plan P6.2）
```bash
for i in 1 2 3; do
  ./packages/core/node_modules/.bin/tsx run-benchmark.ts --filter=loam-
done
```
（或单独跑 3 个具名 fixtures）

### Step 3: 数据汇总（plan P6.3）
写 `patchloop-vs-batch.md`：表格对比每个 fixture × 每次 run 的指标 vs 260504-183633 / 260504-185028 基线。

### Step 4: ship/回退决策
按 AC 逐条核对，明确给出结论。

### Step 5: 跟踪事项 status 更新（plan P6.4）
基于决策更新 ledger §8 对应条目；同步 patch-loop spec §9 status。
跑 `./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts` 确保 governance check 仍绿。

### Step 6: BLUEPRINT Phase 2 退出条件复审
按 BLUEPRINT v1.1 §3.1 「Phase 退出复审协议」遍历 ledger §8 全部 status=waiting 条目，记录到 `docs/reports/phase-2-exit-review.md`。这是 BLUEPRINT Phase 2 退出的首个条件勾选机会。

## Notes
- P6 是 patch-loop 整个 spec 的实证终点。无数据则无 ship。
- 若 P6 数据显示 v0.4 失败，**不要** 立即修补 P4（避免补丁式工作流）；按 spec §7.2 回退后开新 spec 分析根因
- 跑 benchmark 涉及外部 DeepSeek API 成本（3 fixtures × 3 次 ≈ 30-60 分钟、若干美刀 token）。先与 owner 确认再跑
- benchmark 结果中如果发现新 bug / debt，**立即** 登记到 ledger §8（CONSTITUTION 原则 8）；不要等 P6 全部跑完再补
