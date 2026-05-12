---
id: pie-phase-c-callsite-switch
status: backlog
priority: p1
type: refactor
spec_ref: docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md
plan_ref: docs/plans/2026-05-13-pie-phase2-3-scanner-retirement.md
dependencies: ["pie-phase-b-legacy-projection"]
created: 2026-05-13
updated: 2026-05-13
assignee: ai
---

# PIE Phase C：5 处调用点切换 + scanner.ts 物理删除

## Objective

把全部 5 处 `detectTechStack` / `detectVerifyCommands` 生产调用切到 `assembleIntelligence` + `toLegacyTechStack` / `pickVerifyPlan` 组合，删除 `scanner.ts` 文件，完成 scanner 整体退役。

## Context

- Spec §1.1 调用点表 + §3.5（投影函数） + §3.9（scanner.ts 删除）
- Plan §Phase C，覆盖 Step 6（4 处 detectTechStack 切换）、Step 7（1 处 detectVerifyCommands 切换）、Step 8（scanner.ts 物理删除）
- 前置：Phase B 已完成 toLegacyTechStack 完整投影 + RepoContext 拆分

## Acceptance Criteria

- [ ] `packages/core/src/pipeline.ts` line 306, 946 已切换到 `assembleIntelligence` + `toLegacyTechStack` + `generateRepoContext(cwd, pi)`
- [ ] `packages/core/src/static-scanner.ts` line 267 同上
- [ ] `packages/cli/src/commands/init.ts` line 25 同上；line 26 `detectVerifyCommands` 替换为 `pickVerifyPlan(pi)`，并保留 `pkg.scripts` fallback
- [ ] `packages/eval/src/benchmark-runner.ts` line 389 同上
- [ ] `packages/repo/src/scanner.ts` 文件不存在
- [ ] `packages/repo/src/scanner.test.ts` 文件不存在（相关测试已在 Phase B 迁出或在本 task 删除）
- [ ] `packages/repo/src/index.ts` 不再 re-export `detectTechStack` / `detectVerifyCommands`
- [ ] `grep -rn 'detectTechStack\|detectVerifyCommands' packages/ --include='*.ts' | grep -v node_modules | grep -v dist | grep -v intelligence.ts` 返回 0 行
- [ ] `dsh init` 在 4 类 fixture 上生成的 config.yml 中 verify 字段与切换前等价（语义对齐，不要求字符全等）
- [ ] `pnpm run scan` 全套通过
- [ ] 24 fixture 中至少抽 3 个（含 release-hub）跑 plan/patch 阶段烟测，确认 pipeline 不报 import / type 错误

## Steps

参 plan §Step 6–8。

## Notes

- 本 task 是"破坏性"步骤：scanner.ts 物理消失后无法回退到旧路径
- Step 6 / 7 同 commit 提交风险高 —— 建议拆两个 commit（Step 6 完成后跑 typecheck，再做 Step 7）
- Step 8（scanner.ts 删除）单独 commit；如出现 import 残留，tsc 会立刻报错，便于定位
- `cli/init.ts` 在 `pickVerifyPlan` 返回 null 字段时的 fallback 必须保留：项目早期人工调 dsh init 体验不能回退
