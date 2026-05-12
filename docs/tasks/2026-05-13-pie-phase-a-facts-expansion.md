---
id: pie-phase-a-facts-expansion
status: in_review
priority: p1
type: refactor
spec_ref: docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md
plan_ref: docs/plans/2026-05-13-pie-phase2-3-scanner-retirement.md
dependencies: []
created: 2026-05-13
updated: 2026-05-13
assignee: ai
---

# PIE Phase A：Intelligence Facts 扩展 + project.yml 人工确认层

## Objective

把 `intelligence.collectFacts` 扩展为可发现子模块、framework、`.dsh/project.yml` 人工锁定，为后续 scanner 退役做好数据模型准备。

## Context

- Spec §3.2 / §3.3 / §3.4 / §3.7（Facts 新命名空间 + capabilities lint key + project.yml schema）
- Plan §Phase A，覆盖 Step 1（facts 扩展 + capabilities lint）、Step 2（pickVerifyPlan + moduleRoots 投影）、Step 3（.dsh/project.yml schema + override 集成）
- 前置：无（本 task 是依赖链起点）

## Acceptance Criteria

- [ ] `collectFacts` 在测试 fixture（顶层无 pom + `backend/pom.xml` + `frontend/package.json`）下产出 `submodule.backend.maven` / `submodule.backend.lang.java` / `submodule.frontend.npm` / `submodule.frontend.lang.typescript` 等 Facts
- [ ] `collectFacts` 在 pom 含 `spring-boot` 时产出 `framework.spring-boot` Fact，携带 source.path
- [ ] `deriveCapabilities` 输出含 `lint` key，覆盖 maven/gradle/ts/python/go/rust 各一种命令
- [ ] `pickVerifyPlan(pi)` 返回的 `VerifyCommands` 在 4 类 fixture 上与原 `detectVerifyCommands` 输出语义一致（capabilities=`unavailable` 时该字段 null）
- [ ] `moduleRoots(pi)` 在混合仓库下返回非空数组（含 submodule paths + layout hints + `.`）
- [ ] `packages/repo/src/project-yml.ts` 新建：zod schema `ProjectYml`，全字段可选；`readProjectYml` / `writeProjectYml` / `renderProjectYml` 三函数
- [ ] `.dsh/project.yml` 锁定 `buildSystem: gradle` 时，`assembleIntelligence` 在含 pom.xml 的 cwd 仍返回 `buildSystem.selected = "gradle"`，evidence 含 "manual override"
- [ ] 新增 ≥8 个测试 case 覆盖上述行为
- [ ] `pnpm -F @dsh/repo run test` + `pnpm -r run typecheck` 通过

## Steps

参 plan §Step 1–3。

## Notes

- 本 task 不切换调用点；scanner.ts 仍然存在并工作。Step 4 (Phase B) 才会让 toLegacyTechStack 投影使用本 task 新加的 Facts
- `intelligence.ts` 现有 `LANG_SIGNALS` / `BUILD_SIGNALS` 不要破坏；submodule 信号是**新增** candidate evidence，不是替换
- `.dsh/project.yml` schema 应允许"部分锁定"：用户只锁 `framework`，其它字段沿用推断
