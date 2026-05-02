---
id: "static-topn-core"
status: in_progress
priority: p1
type: feature
spec_ref: "docs/superpowers/specs/2026-05-02-static-topn-scoring.md"
plan_ref: "docs/superpowers/plans/2026-05-02-static-topn-scoring.md"
dependencies: []
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# 创建 static-topn.ts 核心评分模块

## Objective
实现 6 维可配置 Top N scoring pipeline：定义类型、评分逻辑、reason 生成、配置解析。

## Context
当前 `static-scanner.ts` 的 `selectTopFindings` 只有 2 维（severity + changed file），hidden reason 是硬编码字符串。需要独立出可测试的评分模块。

## Acceptance Criteria
- [ ] `TopNWeights`、`TopNConfig`、`DimensionScore`、`ScoredFinding` 类型定义
- [ ] `resolveTopNConfig(config)` — 从 config.yml 解析权重，缺项用默认值
- [ ] `scoreFindings(findings, changedFiles, weights)` — 为全部 finding 计算 6 维得分
- [ ] `selectTopFindings(findings, changedFiles, config)` — 排序 + 取 top N
- [ ] `buildReason(dimensions)` — 生成人类可读原因
- [ ] `formatScoredFindings(scored)` — 格式化输出
- [ ] `pnpm -r run typecheck` 通过
- [ ] `pnpm --filter @dsh/core test` 通过
