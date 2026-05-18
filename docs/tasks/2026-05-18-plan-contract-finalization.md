---
id: "plan-contract-finalization"
status: in_review
priority: p0
type: bug
spec_ref: "docs/specs/2026-05-18-plan-contract-finalization.md"
dependencies: ["benchmark-failure-classification"]
created: "2026-05-18"
updated: "2026-05-18"
assignee: "ai"
---

# PLAN 契约 finalize 能力修复

## Objective
把 PLAN 阶段从“工具探索后靠普通提示输出 XML”升级为可审计、可验证、可恢复的 explore/finalize/validate 流程，降低通用 `<FILES>` 协议失败。

## Context
`260517183641-pie-replicated` 中，`DeepSeek 未返回有效的 FILES 块` 27 次全部发生在 plan 阶段 5 轮只读工具后。根因不是单一 fixture，而是 DSH 从探索态切换到机器契约态的协议结构不稳。

## Acceptance Criteria
- [x] PLAN 失败 diagnostics/sidecar 记录最终 assistant 输出类别与摘要。
- [x] `runPlan` 拆出 finalize 阶段，finalize 请求禁用 tools。
- [x] `<FILES>` 作为唯一机器文件契约；不能把 `<PLAN>` 内自然语言文件列表静默当作通过。
- [x] protocol repair 最多一次，且只基于模型上一轮输出，不读取 fixture expectedFiles / benchmark metadata。
- [x] benchmark result 记录 protocol recovery 统计。
- [x] `pnpm run scan` 通过。
- [x] targeted smoke benchmark 验证 PLAN contract：`pi-bugfix-count-defs` / reps=1，finalizeAttempts=1，repairAttempts=0，无 `missing_files`。
- [ ] targeted N=3 显示 `model_protocol_plan_invalid` 下降。

## Notes
- 不做 fixture-specific hint。
- 不改变 `testsPassed` 口径。
- Project Card lift 回归分析依赖本任务先稳定 PLAN contract。

## Implementation Notes
- Added strict plan contract validation with `<FILES>` as the only machine-readable file contract.
- Split PLAN into explore / no-tools finalize / validate / one-shot protocol repair.
- Added structured plan diagnostics in task state and `.dsh/plan-contract-diagnostics.json`.
- Updated benchmark classification/reporting to use structured plan diagnostics instead of localized error strings.
- Added configurable PLAN stage routing so explore can use Flash by default while finalize and protocol repair stay on Pro unless overridden.

## Validation Log
- `pnpm --filter @dsh/core test`: PASS.
- `pnpm --filter @dsh/eval test`: PASS.
- `pnpm --filter @dsh/provider test`: PASS.
- `pnpm --filter @dsh/cli test`: PASS.
- `pnpm run scan`: PASS.
- targeted benchmark smoke: PASS for PLAN contract; final card_on failure was post-PLAN patch/repair scope, not plan protocol invalid.
