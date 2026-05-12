---
id: pie-phase-b-legacy-projection
status: backlog
priority: p1
type: refactor
spec_ref: docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md
plan_ref: docs/plans/2026-05-13-pie-phase2-3-scanner-retirement.md
dependencies: ["pie-phase-a-facts-expansion"]
created: 2026-05-13
updated: 2026-05-13
assignee: ai
---

# PIE Phase B：`toLegacyTechStack` 完整投影 + RepoContext 拆分

## Objective

让 `toLegacyTechStack` 输出与原 `scanner.detectTechStack` 字段对等（含 `modules` / `framework`），把 RepoContext 装配能力从 scanner.ts 拆到独立文件，为 Phase C 切换调用点做好契约层准备。

## Context

- Spec §3.5 / §3.9（toLegacyTechStack 扩展 + scanner.ts 拆分）
- Plan §Phase B，覆盖 Step 4（toLegacyTechStack 扩展）、Step 5（repo-context.ts 拆分 + RepoContext 新增 intelligence 字段）
- 前置：Phase A 已为 toLegacyTechStack 提供新 Facts 与 `submodule.*` / `framework.*` 命名空间

## Acceptance Criteria

- [ ] `toLegacyTechStack(pi)` 填充 `modules: SubModule[]`，每个 submodule 一条，含其 language / packageManager / framework
- [ ] `toLegacyTechStack(pi).framework` 在顶层 pom 含 spring-boot 时返回 `"spring-boot"`；顶层无、submodule 有时挂载 submodule 的 framework
- [ ] Parity test：4 类 fixture（typescript / python / java-maven 单包 / java+vue 混合）下 `toLegacyTechStack(assembleIntelligence(tmp))` 与 `detectTechStack(tmp)` 字段一致
- [ ] `packages/repo/src/repo-context.ts` 新建，迁入 `generateRepoContext` / `generateDirectoryTree` / `findKeyFiles` / `getRecentGitLog`
- [ ] `RepoContext` 类型新增 `intelligence: ProjectIntelligence` 字段
- [ ] `generateRepoContext` 签名改为 `(cwd, pi: ProjectIntelligence)`，内部 `toLegacyTechStack(pi)` 投影 `techStack` 字段
- [ ] `packages/repo/src/scanner.ts` 中 `generateRepoContext` / `generateDirectoryTree` / `findKeyFiles` / `getRecentGitLog` 已删除（保留 `detectTechStack` / `detectVerifyCommands` 待 Phase C 切换后 Step 8 删除）
- [ ] `packages/repo/src/index.ts` 中 `RepoContext` / `VerifyCommands` re-export 改自 `./repo-context.js`
- [ ] `pnpm -r run typecheck` 通过（下游通过 `@dsh/repo` re-export 不感知路径变化）
- [ ] `pnpm -F @dsh/repo run test` 通过

## Steps

参 plan §Step 4–5。

## Notes

- 本 task 不切换调用点。Phase C 才会让 4 处 detectTechStack 调用切到 assembleIntelligence + toLegacyTechStack 组合
- scanner.ts 在本 task 结束时仍存在但已瘦身（只剩 detectTechStack / detectVerifyCommands 系）
- generateRepoContext 签名变化是契约破坏 —— 4 处生产调用点会在 Step 6 顺手适配（同 commit 内）
