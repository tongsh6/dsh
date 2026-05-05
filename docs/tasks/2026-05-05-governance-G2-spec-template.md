---
id: "governance-g2-spec-template"
status: in_review
priority: p1
type: docs
spec_ref: "docs/specs/2026-05-05-tracked-items-governance.md"
plan_ref: "docs/plans/2026-05-05-tracked-items-governance.md"
dependencies: ["governance-g1-doc-foundation"]
created: "2026-05-05"
updated: "2026-05-05"
assignee: "ai"
---

# G2：跟踪事项治理 — spec 模板 + 回填 patch-loop

## Objective
新建 `docs/specs/_template.md` 标准 spec 模板（含「跟踪事项」标准章节）；把 patch-loop spec §2.2 / §6 / §8 中的延期事项抽到新章节并同步登记到 ledger §8。完成后 patch-loop spec 满足原则 8、可启动 plan/task 拆分。

## Context
- Spec: `docs/specs/2026-05-05-tracked-items-governance.md` §3.6
- Plan: `docs/plans/2026-05-05-tracked-items-governance.md` Phase G2
- 依赖 G1（CONSTITUTION 原则 8 + ledger §8 章节就位）

## Acceptance Criteria
- [ ] `docs/specs/_template.md` 存在并含完整 10 章节结构（spec §3.6 + plan G2.1）
- [ ] 模板 §9「本 spec 引发的跟踪事项」章节有占位表格 + 字段约定提示
- [ ] `docs/specs/2026-05-05-patch-loop-architecture.md` 末尾新增「§9 本 spec 引发的跟踪事项」章节，原 §9 修订历史顺延为 §10
- [ ] patch-loop §「跟踪事项」中至少 5 条条目（plan G2.2 列举）
- [ ] 上述条目同步登记到 ledger §8，source 字段填 `spec:docs/specs/2026-05-05-patch-loop-architecture.md`
- [ ] grep 自检：模板 + patch-loop spec 中「跟踪事项」章节标题各 1 次
- [ ] patch-loop spec §「跟踪事项」条目数 == ledger §8 中 `source=patch-loop` 的条目数

## Steps

### Step 1: spec 模板（plan G2.1）
新建 `docs/specs/_template.md`。结构：1 问题定义 / 2 目标与非目标 / 3 设计 / 4 数据模型 / 5 成功标准 / 6 风险 / 7 实施策略 / 8 不在本 spec 范围 / **9 本 spec 引发的跟踪事项** / 10 修订历史。
§9 占位表格按 spec §3.6 + 一行注释提示「PR 提交时同步登记到 ledger §8」。

### Step 2: patch-loop spec 回填 §9（plan G2.2）
从 §2.2 / §6 / §8 抽延期事项形成条目。候选清单见 plan。不动 §2.2 / §6 / §8 原文（保留信息冗余）。

### Step 3: 同步登记到 ledger §8（plan G2.3）
把 Step 2 的条目逐条加到 ledger §8 表格末尾。每条 source 字段统一填 patch-loop spec 路径。

### Step 4: 自检（plan G2.4）
grep 章节标题 + 数 spec/ledger 条目数对应。

## Notes
- 不动代码
- patch-loop spec 自身的 §9 编号修正后，文档内若有交叉引用 §9 修订历史的，需要更新到 §10
- 完成 → 解锁 patch-loop plan/task 起草
