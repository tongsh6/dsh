---
id: "patchloop-auto-termination"
status: in_review
priority: p1
type: feature
plan_ref: "docs/plans/2026-05-06-pipeline-auto-termination.md"
dependencies: []
created: "2026-05-06"
updated: "2026-05-06"
assignee: "ai"
---

# Pipeline 自动终止 + 安全网（P1+P2）

## Objective
在 v0.4 patch loop 中增加两层代码控制的终止机制，不再依赖模型判断"是否完成"。

## Context
- Plan: `docs/plans/2026-05-06-pipeline-auto-termination.md`
- 根因：13 fixture 全量 benchmark 显示 DONE 率仅 38%；自我终止是 LLM 不擅长的元认知任务
- 方向：不是调 prompt，而是把终止决策从模型移到代码

## Acceptance Criteria
- [ ] MAX_CONSECUTIVE_TOOLS_ONLY=5 guard 已实现（P2）
- [ ] 连续 5 轮 tools 无 change → loop auto break
- [ ] change 反馈消息包含 plan.files 覆盖进度信息（P1）
- [ ] `pnpm run scan` 全部通过
- [ ] 代码已 commit + push

## Notes
- 不涉及 spec 变更（在 v0.4 范围内）
- 不涉及 prompt/parser 变更
- 行为验证需跑 benchmark 看 round 数是否下降
