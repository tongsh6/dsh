---
id: "governance-g4-ci-integration"
status: in_review
priority: p1
type: infra
spec_ref: "docs/specs/2026-05-05-tracked-items-governance.md"
plan_ref: "docs/plans/2026-05-05-tracked-items-governance.md"
dependencies: ["governance-g3-ci-script"]
created: "2026-05-05"
updated: "2026-05-05"
assignee: "ai"
---

# G4：跟踪事项治理 — CI 集成 + 红绿验证

## Objective
把 `scripts/check-tracked-items.ts` 接入 `.github/workflows/scan.yml`；通过手动制造不一致 → 验证 CI 红、修复 → 验证绿。完成后任何后续 PR 漏登记跟踪事项都会被 CI 阻断。

## Context
- Spec: `docs/specs/2026-05-05-tracked-items-governance.md` §3.7 + §5.2
- Plan: `docs/plans/2026-05-05-tracked-items-governance.md` Phase G4
- 依赖 G3（CI 脚本就位）

## Acceptance Criteria
- [ ] `.github/workflows/scan.yml` 在现有 lint/typecheck/test 步骤之后追加 `Check tracked items` 步骤
- [ ] 步骤复用 G3 脚本，通过 tsx 调用
- [ ] 在干净仓库上 `pnpm run scan` + 新步骤模拟运行 → 全绿
- [ ] 手动制造不一致（删 ledger §8 一行）→ 本地脚本 exit 1 + 人类可读报告（不提交，仅验证）
- [ ] 恢复后再跑 → exit 0（验证脚本可恢复）
- [ ] `docs/project-ledger.md` §7 关键证据索引追加脚本路径与作用说明（plan G4.3）

## Steps

### Step 1: 接入 scan workflow（plan G4.1）
在 `.github/workflows/scan.yml` 添加 step：
```yaml
- name: Check tracked items
  run: ./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts
```
位置：现有 lint/typecheck/test 之后。

### Step 2: 手动红绿验证（plan G4.2，不提交代码）
- 临时编辑 ledger §8 删一行 → 跑脚本验证 exit 1 + 报告点出哪条 spec 条目失败
- 恢复 ledger
- 再跑 → exit 0

### Step 3: 文档化 CI 行为（plan G4.3）
更新 `docs/project-ledger.md` §7 关键证据索引追加：「`scripts/check-tracked-items.ts` —— 跟踪事项治理 CI 脚本，CONSTITUTION 原则 8 兜底」

## Notes
- Step 2 是验证步骤，**不要**提交 ledger 删除版本
- 完成 → 治理体系上线，与 patch-loop 实施可并行
- 完成后把 governance-g1/g2/g3/g4 全部转为 `done`（人类确认 review 通过后）
