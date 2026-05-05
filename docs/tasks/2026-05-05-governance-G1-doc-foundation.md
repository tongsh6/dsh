---
id: "governance-g1-doc-foundation"
status: in_review
priority: p1
type: docs
spec_ref: "docs/specs/2026-05-05-tracked-items-governance.md"
plan_ref: "docs/plans/2026-05-05-tracked-items-governance.md"
dependencies: []
created: "2026-05-05"
updated: "2026-05-05"
assignee: "ai"
---

# G1：跟踪事项治理 — 文档基础

## Objective
建立长期跟踪事项治理的文档骨架：CONSTITUTION 原则 8、ledger §8 章节（含本期迁移条目）、BLUEPRINT 每 Phase 退出复审 checkbox。完成后任何后续 spec 都能引用规范、新会话 AI 都能从 ledger 读到全部跟踪事项。

## Context
- Spec: `docs/specs/2026-05-05-tracked-items-governance.md` §3.3 / §3.4 / §3.5
- Plan: `docs/plans/2026-05-05-tracked-items-governance.md` Phase G1
- 这是 patch-loop spec → plan/task 的硬阻塞（Plan §「依赖关系」）

## Acceptance Criteria
- [ ] `CONSTITUTION.md` 含「原则 8：长期跟踪事项可追溯」全文（spec §3.3）
- [ ] `CONSTITUTION.md` 修订历史新增 v1.1 行
- [ ] `BLUEPRINT.md` Phase 2 退出条件追加「长期跟踪事项复审」checkbox（spec §3.5）
- [ ] `BLUEPRINT.md` §3 后插入「Phase 退出复审协议」小节
- [ ] `docs/project-ledger.md` §8 章节存在（spec §3.4 schema）
- [ ] §8 表格至少含 7 条本期迁移条目（plan G1.2 列举）
- [ ] grep 自检全部通过（plan G1.4）
- [ ] 现有 386 测试无影响（仅文档变更，自动通过）

## Steps

### Step 1: CONSTITUTION 加原则 8（plan G1.1）
文本来源：spec §3.3。位置：第三章「技术原则」之后、第四章「修订程序」之前。修订历史 + 顶部日期更新。

### Step 2: ledger §8 章节 + 迁移条目（plan G1.2）
文件末尾追加章节。表头与字段顺序：`type | id | source | title | trigger | prio | status | last_reviewed`。
迁移 7 条条目（清单见 plan G1.2）。

### Step 3: BLUEPRINT phase 退出 checkbox（plan G1.3）
追加 checkbox 文本来自 spec §3.5。新增「Phase 退出复审协议」小节说明执行流程。

### Step 4: 自检（plan G1.4）
跑 grep 验证三个文件改对了。

## Notes
- 不动代码，仅文档变更
- 不引入新依赖
- 完成 → 解锁 G2 启动
