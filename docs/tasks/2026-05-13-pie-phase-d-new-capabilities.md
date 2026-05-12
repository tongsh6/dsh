---
id: pie-phase-d-new-capabilities
status: backlog
priority: p1
type: feature
spec_ref: docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md
plan_ref: docs/plans/2026-05-13-pie-phase2-3-scanner-retirement.md
dependencies: ["pie-phase-c-callsite-switch"]
created: 2026-05-13
updated: 2026-05-13
assignee: ai
---

# PIE Phase D：dsh doctor + Project Card 注入 + ctxDirs 重构

## Objective

交付三项面向用户与模型的新能力：`dsh doctor` 诊断命令、Project Card 注入 LLM prompt、`repair-loop` + `failure-detector` 的 ctxDirs 字面量消除（消费 Intelligence 的 moduleRoots）。

## Context

- Spec §3.6（dsh doctor + Project Card 注入） + §3.8（ctxDirs 重构）
- Plan §Phase D，覆盖 Step 9（dsh doctor 命令）、Step 10（Project Card 注入 + DSH_INJECT_PROJECT_CARD feature flag）、Step 11（ctxDirs 重构）
- 前置：Phase C 完成（scanner 已退役，intelligence 是项目识别唯一入口）

## Acceptance Criteria

- [ ] `packages/cli/src/commands/doctor.ts` 新建；`packages/cli/src/main.ts` 注册 `dsh doctor [--write]` 子命令
- [ ] `dsh doctor` 在 4 类 fixture 上输出非空 Project Card（含 `## Project Card` / `**Capabilities**` 章节）
- [ ] `dsh doctor --write` 在 `.dsh/project.yml` 不存在时写入草稿 yml；存在时提示用户（除非 `--force`）
- [ ] `--write` 产出的 yml 通过 `readProjectYml` zod 校验
- [ ] `context-builder.buildRepoContext` 在 `ctx.intelligence` 存在时追加 Project Card 段；环境变量 `DSH_INJECT_PROJECT_CARD=false` 时关闭注入
- [ ] 3 个代表性 fixture（loamlog ts / pi-proof-forge python / release-hub java+vue）的 `buildRepoContext` 字符级 diff：仅含新增的 `## Project Card` 章节，其它行零回归
- [ ] `repair-loop.resolveSourcePath` 签名追加 `moduleRoots: string[]`，删除 line 211 字面量 markers 列表；调用方传入 `moduleRoots(pi)`
- [ ] `failure-detector.extractCompilationErrors` + `extractFailureSourceLocations` 签名追加 `moduleRoots: string[]`，删除 line 559 字面量列表
- [ ] `grep -n '"/backend/"\|"/frontend/"' packages/core/src/repair-loop.ts packages/core/src/failure-detector.ts` 返回 0 行
- [ ] release-hub 路径样本（含 `/backend/`）回归测试：moduleRoots 含 backend 时正确切回相对路径
- [ ] 小项目（moduleRoots=[]）回归测试：回退到 basename 行为不变
- [ ] `pnpm run scan` 全套通过

## Steps

参 plan §Step 9–11。

## Notes

- Step 9 / 10 / 11 之间相对独立，可并行起 3 个 commit
- Step 10 的 feature flag `DSH_INJECT_PROJECT_CARD` 是 Step 12 benchmark A/B 验证的关键钩子，不要省略
- Step 11 中 `moduleRoots` 的传递路径在实施时按最小侵入选择（通过参数 / 通过 state context 都可），不强求一种
