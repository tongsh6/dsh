---
id: "config-read-unification"
status: ready
priority: p1
type: refactor
spec_ref: "docs/superpowers/specs/2026-05-02-config-architecture.md"
plan_ref: "docs/superpowers/plans/2026-05-02-config-architecture.md"
dependencies: ["config-loader-rewrite"]
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# 读路径收敛 — 删除重复实现 + provider 清理

## Objective
删除 pipeline.ts 和 cli/utils/config.ts 中的重复读逻辑，统一用 `loadDshConfig`。去掉 provider `fromEnv()` 中的文件正则读取。

## Context
3 份读实现的逻辑完全相同（readFile → yaml.load → catch → {}）。provider 用正则越界解析 YAML。全部收敛到 `repo/config-loader.ts` 的 `loadDshConfig`。

## Acceptance Criteria
- [ ] `pipeline.ts`：删除 `readLocalConfig` / `readLocalConfigStrict`，改为 `import { loadDshConfig }`
- [ ] `cli/utils/config.ts`：`readConfig` → re-export `loadDshConfig`
- [ ] `provider/client.ts`：去掉正则读取 config 的逻辑，`fromEnv()` 只查 `DEEPSEEK_API_KEY` 环境变量
- [ ] `provider/client.test.ts`：更新 to 去掉依赖 config 文件的测试
- [ ] `plan.ts` / `patch.ts` / `repair.ts`：创建 client 时显式传 key
- [ ] `run-benchmark.ts`：创建 client 时显式传 key
- [ ] `pnpm -r run typecheck` 通过
- [ ] `pnpm -r run test` 通过（无回归）
