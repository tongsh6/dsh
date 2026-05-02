---
id: "config-write-migration"
status: ready
priority: p0
type: refactor
spec_ref: "docs/superpowers/specs/2026-05-02-config-architecture.md"
plan_ref: "docs/superpowers/plans/2026-05-02-config-architecture.md"
dependencies: ["config-loader-rewrite"]
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# 写路径迁移 — init + benchmark-runner 改用 writeDshConfig

## Objective
将 2 个写路径从"凭空生成+覆盖写入"改为 `writeDshConfig` 的 merge 语义。

## Context
`dsh init` 生成完整 config 后 `writeFileSync` 覆盖。benchmark runner 同理。两处都改为只传需要修改的字段，依赖 merge 语义保护旧值。

## Acceptance Criteria
- [ ] `init.ts`：`yaml.dump + writeFileSync` → `writeDshConfig`，只传 init 探测的字段
- [ ] `benchmark-runner.ts`：`yaml.dump + writeFileSync` → `writeDshConfig`，删除 `readExistingApiKey`
- [ ] `init --force` 不覆盖已有 `api_key`
- [ ] benchmark runner 写目标仓库不覆盖已有的 `api_key` 或其他字段
- [ ] `pnpm -r run typecheck` 通过
- [ ] 现有测试无回归
