---
id: "governance-g3-ci-script"
status: backlog
priority: p1
type: feature
spec_ref: "docs/specs/2026-05-05-tracked-items-governance.md"
plan_ref: "docs/plans/2026-05-05-tracked-items-governance.md"
dependencies: ["governance-g1-doc-foundation", "governance-g2-spec-template"]
created: "2026-05-05"
updated: "2026-05-05"
assignee: "ai"
---

# G3：跟踪事项治理 — CI 脚本

## Objective
实现 `scripts/check-tracked-items.ts` —— 扫描 spec/report 中的跟踪事项标记 vs ledger §8 索引，差集非空时退出非零。配套单元测试。完成后 G4 可接入 GitHub Actions 兜底机制。

## Context
- Spec: `docs/specs/2026-05-05-tracked-items-governance.md` §3.7
- Plan: `docs/plans/2026-05-05-tracked-items-governance.md` Phase G3
- 依赖 G1（ledger §8 schema）+ G2（spec §「跟踪事项」标准章节）

## Acceptance Criteria
- [ ] `scripts/check-tracked-items.ts` 实现 spec §3.7 全部 5 项校验
- [ ] 脚本支持 `--json` flag（机器可读输出）
- [ ] `scripts/check-tracked-items.test.ts` 含 ≥6 个测试用例（见 Steps Step 2）
- [ ] 所有测试通过（`tsx --test scripts/check-tracked-items.test.ts`）
- [ ] 在当前真实仓库上跑 `tsx scripts/check-tracked-items.ts` 退出码 0
- [ ] 退出码契约清晰：0=ok / 1=校验失败 / 不使用其它码
- [ ] 无新依赖（仅 node 内置 + 项目已有 zod / yaml）

## Steps

### Step 1: 脚本实现（plan G3.1）
- 解析 `docs/specs/*.md` 创建日期 ≥ 2026-05-05 的 spec 的「跟踪事项」章节（宽松正则匹配标题）
- 解析 `docs/reports/**/analysis.md` 同样的章节（如存在）
- 解析 `docs/project-ledger.md` §8 表格
- 比对 spec/report 条目 vs ledger 条目（按 type+id 联合主键）
- 比对 ledger 条目的 source 路径（`spec:...` / `report:...` / `code:...:line`）解析后是否存在
- last_reviewed 超 90 天 → console.warn（不阻断）
- 输出格式：默认 markdown 报告 + 退出码；`--json` 输出 `{ ok: bool, errors: [...], warnings: [...] }`

### Step 2: 单元测试（plan G3.2）
用 fixture 目录（脚本运行时通过参数指定 root，测试时传 fixture 路径）测试 ≥6 个用例：
1. happy path — 所有 spec 条目都在 ledger，所有 source 路径存在 → exit 0
2. spec 条目缺登记 → exit 1，error 列出缺的 type+id
3. ledger 条目 source 路径不存在 → exit 1，error 列出哪条
4. ledger 表格字段数不对 → exit 1
5. last_reviewed 超 90 天 → exit 0 + warn 列出哪条
6. 历史 spec（创建日期 < 2026-05-05）→ 跳过扫描，不影响结果

测试框架：node:test + node:assert/strict。

### Step 3: 自检（plan G3.3）
```bash
./packages/core/node_modules/.bin/tsx --test scripts/check-tracked-items.test.ts
./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts
```

## Notes
- 不依赖外部 markdown AST 库；用最简正则解析表格
- 不写跨平台 shell 脚本（仅 ts，由 tsx 跑）
- 退出码契约严格：0/1，避免引入歧义
- 不修复任何已发现的不一致（修复是 G4 红绿验证步骤的事）
- 完成 → 解锁 G4
