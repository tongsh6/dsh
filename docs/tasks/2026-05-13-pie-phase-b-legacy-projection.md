---
id: pie-phase-b-legacy-projection
status: in_review
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

- **范围扩张说明（2026-05-13 实施时）**：因 `generateRepoContext` 签名变更（plan Step 5）必然破坏下游 typecheck，本 task 顺手切换了 5 处 `detectTechStack` 生产调用点（plan §Step 6 的 detectTechStack 部分提前完成）。task C 剩余范围：(a) `cli/init.ts` 的 `detectVerifyCommands` 调用切换到 `pickVerifyPlan` + pkg.scripts fallback（Step 7）；(b) `scanner.ts` 物理删除（Step 8）。
- scanner.ts 在本 task 结束时仍存在但已大幅瘦身：删除了 VerifyCommands/RepoContext 类型、generateRepoContext 系，仅保留 detectTechStack（无生产调用点）+ detectVerifyCommands（cli/init 仍调）+ 其 helper。
- `toLegacyTechStack` 加 cwd 参数：lock-file 探测（pnpm/yarn/npm/bun/poetry/pipenv/pip）必须 fs.exists 检查，不能纯反推 facts。签名变更影响 1 处 cli/init + 1 处 benchmark-runner（已切换）。
