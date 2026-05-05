---
id: "patchloop-p5-benchmark-adapt"
status: backlog
priority: p1
type: feature
spec_ref: "docs/specs/2026-05-05-patch-loop-architecture.md"
plan_ref: "docs/plans/2026-05-05-patch-loop-architecture.md"
dependencies: ["patchloop-p1-state-schema", "patchloop-p4-pipeline-rewrite"]
created: "2026-05-05"
updated: "2026-05-05"
assignee: "ai"
---

# P5：benchmark-runner 适配 + scope-completeness check

## Objective
让 `packages/eval/src/benchmark-runner.ts` 读取新 `state.patch_rounds` 字段并写入 `TaskResult`；在 verify 入口前做 scope-completeness check（plan files vs actual changed files）；`formatEvaluationReport` 加 patch-loop 行为统计章节。这是 patch-loop 数据可观测的关键，没有 P5 数据 P6 验证就跑不起来。

## Context
- Spec: `docs/specs/2026-05-05-patch-loop-architecture.md` §3.7 + §「§D 必选项」（scope-completeness）
- Plan: `docs/plans/2026-05-05-patch-loop-architecture.md` Phase P5
- 依赖 P1（schema 字段）+ P4（pipeline 写 patch_rounds）

## Acceptance Criteria
- [ ] `TaskResult` 接口新增 `patchRounds: number` + `patchRoundActions: { round: number; action: string }[]`
- [ ] try 路径与 catch 路径**都**赋值（catch 路径用 readTaskState fallback，复用 Bug A 修复模式）
- [ ] `runVerify` 入口或 benchmark-runner verify 调用前，做 scope-completeness check：plan.files 中存在但 patches.files_changed 缺失的文件 → status 强制设为 verification_failed
- [ ] scope-completeness 实现位置在 pipeline.ts（优先），保证它是 pipeline 行为而非 benchmark 行为
- [ ] `formatEvaluationReport` 新增 `## Patch Loop 行为` 章节含：平均 patch round 数、平均 change 块数、平均 invalid 轮数、done 主动终止率
- [ ] 现有 24 eval 测试不退化
- [ ] `benchmark-runner.test.ts` 新增 ≥3 测试：patch_rounds 字段读取、scope-completeness 触发、formatEvaluationReport 含新章节
- [ ] `pnpm --filter @dsh/eval run typecheck` + `test` 通过
- [ ] `pnpm run scan` 全套通过

## Steps

### Step 1: TaskResult 字段扩展（plan P5.1）
加 `patchRounds` + `patchRoundActions`。

### Step 2: try / catch 双路径赋值（plan P5.1）
基于本 session 修过的 Bug A 模式：catch 块里 `readTaskState(repoPath)` 后从 disk 读字段。

### Step 3: scope-completeness check（plan P5.2）
在 pipeline.ts 的 `runVerify` 入口（**不是** benchmark-runner 一侧）加：plan.files vs patches 累计 files_changed 落差非零 → 强制 verification_failed。理由：scope check 是 pipeline 治理行为，所有调用方（benchmark / CLI）都应受益。

### Step 4: 报告章节（plan P5.3）
`formatEvaluationReport` 加 patch-loop 章节。聚合 results 中的 patchRoundActions，统计 4 类 action 占比。

### Step 5: 测试（plan P5.4）
≥3 测试。

### Step 6: 自检
```bash
pnpm run scan
./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts
```

## Notes
- scope-completeness check 应区分 partial_ok（部分应用成功）和 patch_failed（全失败）：partial_ok 进 verification_failed → repair；patch_failed 也进 repair（更激进，因 patch loop 已用满 30 轮还不行）
- 旧 v0.3 报告（260504-* 系列）字段缺失，formatEvaluationReport 容错处理（patchRounds 为 undefined → 显示 N/A）
- benchmark-runner 已经有 toolRounds / toolCalls 字段（P5 要兼容 P4 后这些字段语义略变：patch loop 内的 tool 调用累计在原 toolRounds 字段）
