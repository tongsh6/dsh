---
id: "static-topn-tests"
status: ready
priority: p1
type: test
spec_ref: "docs/superpowers/specs/2026-05-02-static-topn-scoring.md"
plan_ref: "docs/superpowers/plans/2026-05-02-static-topn-scoring.md"
dependencies: ["static-topn-core"]
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# static-topn 单元测试

## Objective
为 6 维评分管道编写完整测试覆盖。

## Context
评分逻辑是纯函数，非常适合单元测试。每个维度需要覆盖最大值+零值，需要覆盖排序稳定性+配置解析+边界条件。

## Acceptance Criteria
- [ ] 每个维度：最大值和零值情况各 1 个用例
- [ ] 权重设为 0 时维度禁用（得分为 0）
- [ ] 排序确定性：相同总分时稳定顺序
- [ ] scannerOrder tiebreaker 校验
- [ ] `resolveTopNConfig`：空 config → 默认值 / 部分配置 / 完整配置
- [ ] `buildReason`：单维度 / 多维度 / 全维度零值
- [ ] `formatScoredFindings`：非空 / 空数组
- [ ] 与现有 static-scanner 测试兼容（无回归）
- [ ] `pnpm --filter @dsh/core test` 全部通过（含 204 现有 + ~10 新增）
