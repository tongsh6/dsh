---
id: "search-replace-deterministic-apply"
status: in_review
priority: p2
type: bug
spec_ref: "docs/specs/2026-05-05-patch-loop-architecture.md"
dependencies: []
created: "2026-05-18"
updated: "2026-05-18"
assignee: "ai"
---

# SEARCH/REPLACE 确定性应用

## Objective
收紧 SEARCH/REPLACE 的应用语义，避免不完整或重复的 SEARCH 块被静默应用到第一个相似位置。

## Context
台账 `patchloop-search-replace-risk-realized` 记录了 SEARCH/REPLACE 行号错位风险。当前实现包含大小写不敏感、关键词锚点、80% 行匹配等兜底，失败时容易把模型的不精确 SEARCH 块变成看似成功的错误修改。

## Acceptance Criteria
- [x] SEARCH 块为空时拒绝应用。
- [x] SEARCH 块匹配多个位置时拒绝应用，并要求扩大上下文。
- [x] 不再用关键词锚点猜测替换区域。
- [x] 保留唯一精确匹配和唯一全行 trim-agnostic 匹配。
- [x] 新增回归测试覆盖歧义匹配、关键词猜测、缩进差异匹配。
- [x] `pnpm run scan` 通过。
