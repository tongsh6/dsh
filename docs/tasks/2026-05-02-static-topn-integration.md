---
id: "static-topn-integration"
status: ready
priority: p1
type: feature
spec_ref: "docs/specs/2026-05-02-static-topn-scoring.md"
plan_ref: "docs/plans/2026-05-02-static-topn-scoring.md"
dependencies: ["static-topn-core"]
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# 集成 static-topn 到 static-scanner

## Objective
替换 `static-scanner.ts` 中的简化版 `selectTopFindings` 和 `buildTopNReasoning`，接入新评分模块。

## Context
`static-scanner.ts` 约 355 行，`selectTopFindings` 和 `buildTopNReasoning` 是内部函数。需要改为调用 `static-topn.ts` 导出版本。`resolveStaticScanConfig` 需扩展以解析 `selection.weights`。

## Acceptance Criteria
- [ ] `selectTopFindings` 和 `buildTopNReasoning` 内部函数替换为 static-topn 调用
- [ ] `resolveStaticScanConfig` 扩展解析 `selection.weights` 段
- [ ] `runStaticScan` 传入 config 参数
- [ ] `repairStaticScanTopN` 中的 formatFindings 不改
- [ ] `packages/core/src/index.ts` 导出新类型和函数
- [ ] 现有 static-scanner 测试全部通过（无回归）
- [ ] `pnpm -r run typecheck` 通过
