# DSH 项目事实台账

> 状态: active | 最后更新: 2026-05-08
>
> 任何新会话 AI 或新人进入项目后，**请先阅读本文件**，以便快速恢复项目状态基线。

## 1. 当前阶段目标

Phase 2（协议+评测完善）。详见 [BLUEPRINT.md](../BLUEPRINT.md) §3。

退出条件（8 条）详见 BLUEPRINT.md。当前进展：
- [x] 静态扫描 Phase 2-3（Top N 可解释选择）
- [x] 首份 DSH vs OpenCode 对比报告
- [x] 多仓库（3 repos 各 ≥3 fixture，13 fixture full benchmark 已完成）
- [x] 完成率（13/13 = 100%）
- [x] 对比报告（`docs/reports/260506-004042`）
- [ ] v0.4 协议操作覆盖率（CREATE/PATCH 达标；SEARCH_REPLACE/INSERT 标注不足；DELETE/RENAME 尚无标注与实测）
- [ ] 多语言（Python 5/5 ✅，TypeScript/loamlog ≥3 ✅，release-hub Java+Vue 混合 fixture 0/3 ❌）
- [x] 跨工具对比（DSH vs OpenCode，13 fixture 对比完成）
- [x] 长期跟踪事项复审（已执行，含 21 条复核 + 3 条状态变更）

## 2. 已完成事项

| 事项 | 完成时间 | 证据路径 | 验证方式 | 备注 |
|------|---------|---------|---------|------|
| Phase 1 MVP 闭环 | 2026-05-02 | `packages/core/src/pipeline.ts` | 386 测试通过 | Plan→Patch→Verify→Repair→Handoff |
| CLI 6 命令 | 2026-05-02 | `packages/cli/src/commands/` | 23 CLI 测试通过 | init/plan/patch/verify/repair/handoff |
| DeepSeek API 客户端 | 2026-05-02 | `packages/provider/src/client.ts` | 23 测试通过 | 含 tools 参数支持 |
| 项目扫描器（多语言） | 2026-05-03 | `packages/repo/src/scanner.ts` | 45 测试通过 | LANGUAGE_REGISTRY |
| 配置统一加载 | 2026-05-02 | `packages/repo/src/config-loader.ts` | 测试通过 | 单点读写架构 |
| Patch 协议解析 | 2026-05-02 | `packages/core/src/patch-parser.ts` | 271 core 测试通过 | 6 种操作 + 5 级回退匹配 |
| 静态扫描 Top N | 2026-05-02 | `packages/core/src/static-topn.ts` | 测试通过 | 6 维加权评分 |
| 工具执行引擎 | 2026-05-04 | `packages/core/src/tool-executor.ts` + `tool-definitions.ts` | 408+ 行测试 | read_file/grep_files/exec_shell |
| 工具 API 集成 | 2026-05-04 | `packages/core/src/pipeline.ts` L272-338 | 测试通过 | 5 轮调用循环 |
| 修复循环工具支持 | 2026-05-04 | `packages/core/src/repair-loop.ts` L208-238 | 测试通过 | 2→3 轮工具循环 |
| Benchmark 系统 | 2026-05-02 | `packages/eval/` + `run-benchmark.ts` | 24 eval 测试通过 | 多项目多语言 fixtures |
| CI 质量门禁 | 2026-05-02 | `.github/workflows/scan.yml` | PR CI 通过 | lint+typecheck+test |
| Benchmark CI | 2026-05-02 | `.github/workflows/benchmark.yml` | 每周六定时 | GitHub Actions |
| 安全扫描 CI | 2026-05-02 | `.github/workflows/codeql.yml` + `gitleaks.yml` | — | CodeQL + Gitleaks |

## 3. 已验证事项

| 事项 | 验证方式 | 报告路径 | 结论 |
|------|---------|---------|------|
| 386 单元测试 | `pnpm -r run test` | — | 全部通过 |
| DSH vs OpenCode 对比 | Benchmark（5 fixtures, pi-proof-forge） | `docs/reports/compare-20260502-120419/` | DSH 60% vs OC 100%，修复质量有差距 |
| 工具系统 Benchmark（loamlog） | Benchmark（5 fixtures） | `docs/reports/260504-140432/` | 80% 完成，0/2 修复成功，工具零调用 |

## 4. 进行中事项

| 事项 | 当前状态 | 阻塞点 | 下一步 |
|------|---------|--------|--------|
| 工具采纳率修复 | 已实现，待 benchmark 验证（commit `da7c554`） | 需要一次 ≥1 fixture 的 benchmark 跑出非空 `tool_rounds` | 跑 `pnpm exec tsx run-benchmark.ts --filter=loam-` 与 260504-140432 对照 |
| 修复循环成功率提升 | 待验证 | 依赖工具采纳率修复 benchmark 数据 | 上一项验证后用数据驱动 |
| Controlled Benchmark Suite | 本地 `dsh-benchmark/*-phase2` 分支已创建；13 个 loam/pi/rh fixture 已回填固定 commit metadata | 尚未推送 benchmark 分支；rh Java+Vue 混合新增 fixtures 仍待实现 | 基线：loamlog `5e1d3ee57e853698beacd51f4d1a674f293c17d8`，pi `d01d427be7d2999b4d17783b8982bb518c53ec9f`，release-hub `180de500e6740433b578e60e1585dc6e315f5191` |

## 5. 已废弃事项

| 事项 | 废弃原因 | 决策证据 | 是否有残留 |
|------|---------|---------|-----------|
| superpowers/ 目录结构 | 重构为 docs/ 目录 | commit `c86e790` | 否 |

## 6. 当前 Top Priority

| 优先级 | 事项 | 原因 | 验收标准 |
|--------|------|------|---------|
| P0 | 跑 benchmark 验证工具采纳率修复（da7c554） | 代码已落地，行为数据缺失，最新报告 260504-140432 跑在修复前 commit `c86e790` 上 | 新 run 的 `metadata.json.dsh_commit` 为 `da7c554` 或之后；至少 1 fixture 的 task-state 含非空 `tool_rounds` |
| P1 | Controlled 多仓库/多语言全量 benchmark | Phase 2 退出条件 5 项依赖；loamlog/pi/release-hub 是 live 项目，严格退出必须固定基线 | 所有 Phase 2 fixture 声明 `benchmarkRef.commit`，单 run ≥10 fixture，3 仓库各 ≥3 fixture 通过，完成率 >60% |
| P2 | 修复循环成功率提升 | 当前 0/2，目标 ≥33% | 上述 benchmark 中 repairSuccess 数据 |

## 7. 关键证据索引

| 证据 | 路径 | 说明 |
|------|------|------|
| 项目宪法 | `CONSTITUTION.md` | 5 项核心原则 + 3 条 AI 规则 + 3 项技术原则（含原则 8 跟踪事项治理） |
| 产品蓝图 | `BLUEPRINT.md` | 7 阶段演进 + Phase 2 退出条件 |
| 任务规范 | `docs/TASK-SPEC.md` | 任务格式、生命周期、三层体系 |
| 最新 Benchmark | `docs/reports/260504-140432/` | 5 fixtures loamlog，工具零调用 |
| 对比报告 | `docs/reports/compare-20260502-120419/` | DSH vs OpenCode |
| 工具系统 Spec | `docs/specs/2026-05-04-tool-system.md` | 工具系统完整设计 |
| 工具采纳修复 Spec | `docs/specs/2026-05-04-tool-adoption-fix.md` | 本次修复设计 |
| 核心源码 | `packages/core/src/` | pipeline, patch-parser, repair-loop, tools |
| CLI 源码 | `packages/cli/src/` | 6 条命令 |
| Provider 源码 | `packages/provider/src/` | DeepSeek API 客户端 |
| Repo 源码 | `packages/repo/src/` | 扫描器、配置加载、文件排序 |
| Eval 源码 | `packages/eval/src/` | Benchmark 执行器、fixtures |
| CI 配置 | `.github/workflows/` | scan, benchmark, codeql, gitleaks |
| 跟踪事项治理 Spec | `docs/specs/2026-05-05-tracked-items-governance.md` | CONSTITUTION 原则 8 设计依据 |
| 跟踪事项 CI 脚本 | `scripts/check-tracked-items.ts` | CONSTITUTION 原则 8 兜底；扫描 spec/report 与 ledger §8 差集；scan workflow 集成 |

## 8. 长期跟踪事项

> 治理依据：`CONSTITUTION.md` 原则 8。新会话 AI 启动时必读。任何 status ≠ resolved/cancelled 的条目都需要在合适时机被复审（BLUEPRINT 各 Phase 退出条件含「长期跟踪事项复审」checkbox）。
>
> 字段说明（按列）：type / id / source / title / trigger / prio / status / last_reviewed
> trigger 字段语义：deferred=activate_when / bug=resolve_when / debt=pay_when / evidence=collect_when

| type | id | source | title | trigger | prio | status | last_reviewed |
|------|----|--------|-------|---------|------|--------|---------------|
| deferred | patchloop-repair-upgrade | spec:docs/specs/2026-05-05-patch-loop-architecture.md | repair-loop 升级到 v0.4 patch loop 协议 | v0.4 patch loop 上线后跑 ≥10 fixture，repair 表现出与 patch 类似的多文件不完整 | P1 | waiting | 2026-05-06 |
| deferred | patch-loop-stash-rollback | spec:docs/specs/2026-05-05-patch-loop-architecture.md | 事务 rollback / stash-apply（v0.5 优化） | v0.4 patch loop 上线后出现「应用后行号错位」实证 | P3 | waiting | 2026-05-06 |
| bug | exec-shell-redirect | report:docs/reports/260504-185028 | exec_shell 把 `2>&1` 误判为危险 | 修 EXEC_SHELL_BLOCK_PATTERNS：`/>/` 改为 `/{1,2}\s*[^\s&]/` | P3 | resolved | 2026-05-05 |
| bug | multi-file-patch-output-incomplete | report:docs/reports/260504-183633 | patch 阶段多文件任务输出不完整 | P1+P2 部分解决（rounds -23%），但多文件输出仍不稳定 | P1 | waiting | 2026-05-06 |
| debt | tool-args-coerce | code:packages/core/src/pipeline.ts:300 | tool args 写 state 前 string-coerce 临时方案 | schema 放宽为 z.record(z.unknown()) + 全链路改 unknown | P3 | waiting | 2026-05-06 |
| debt | history-spec-backfill | spec:docs/specs/2026-05-05-tracked-items-governance.md | 历史 spec 未按原则 8 回填跟踪事项 | best-effort：日常审阅时遇到主要 spec 顺手补 | P3 | waiting | 2026-05-06 |
| evidence | dsh-vs-oc-resample | report:docs/reports/oc-motf4q7b/dsh-vs-opencode-comparison.md | DSH vs OpenCode 对比（13 fixture） | 对比完成：通过率持平（62%），DSH 完成率更高（100% vs 77%）| P2 | resolved | 2026-05-06 |
| deferred | patchloop-protocol-negotiation | spec:docs/specs/2026-05-05-patch-loop-architecture.md | 协议自动版本协商 | cancelled：被 P2 guard 替代 | P3 | cancelled | 2026-05-06 |
| deferred | phase4-agent-loop | spec:docs/specs/2026-05-05-patch-loop-architecture.md | BLUEPRINT Phase 4 Agent Loop | Phase 2 退出 + Phase 3 退出后启动 | P3 | waiting | 2026-05-06 |
| evidence | patchloop-vs-batch-baseline | spec:docs/specs/2026-05-05-patch-loop-architecture.md | v0.4 vs v0.3 对比基线（≥3 fixtures × 3 次） | 数据已收集但未做正式对比报告 | P1 | waiting | 2026-05-06 |
| deferred | tracked-items-dashboard | spec:docs/specs/2026-05-05-tracked-items-governance.md | 跟踪事项可视化 / dashboard | 跟踪事项数 > 30 时启动 | P3 | waiting | 2026-05-06 |
| deferred | tracked-items-auto-promotion | spec:docs/specs/2026-05-05-tracked-items-governance.md | 跟踪事项自动 promotion | CI 脚本稳定运行 90 天后启动 | P3 | waiting | 2026-05-06 |
| evidence | governance-overhead-baseline | spec:docs/specs/2026-05-05-tracked-items-governance.md | 治理体系实际维护成本验证 | G4 完成 30 天后统计实际数据 | P3 | waiting | 2026-05-06 |
| bug | scan-workflow-branch-mismatch | code:.github/workflows/scan.yml:6 | scan.yml branches 配置 | 改为 branches: [master, main] | P2 | resolved | 2026-05-05 |
| bug | ci-pnpm-version-missing | code:package.json | pnpm version 缺失 | 加 packageManager 到 package.json | P1 | resolved | 2026-05-05 |
| bug | ci-missing-build-step | code:.github/workflows/scan.yml | CI 缺少 build 步骤 | pnpm install 后加 pnpm -r run build | P1 | resolved | 2026-05-05 |
| deferred | ci-actions-node24-upgrade | code:.github/workflows/scan.yml | actions Node.js 20 deprecation | 2026-06-02 之前升级到支持 Node 24 的 actions/* 主版本 | P3 | waiting | 2026-05-06 |
| evidence | patchloop-e2e-selfhost-260505 | report:docs/reports/260506-004042 | P6.1 自托管 e2e 验证（已 supersede 原始 report） | superseded 13 fixture full benchmark (260506-004042) | P1 | resolved | 2026-05-06 |
| deferred | patchloop-done-prompt-weak | code:packages/core/src/prompt-builder.ts | v0.4 DONE 触发（根因在第 7 条：元认知任务） | P1+P2 pipeline 自动终止已从代码层替代 prompt 方案 | P1 | waiting | 2026-05-06 |
| evidence | patchloop-search-replace-risk-realized | code:packages/core/src/pipeline.ts | SEARCH/REPLACE 行号错位风险已实证 | 长期跟踪；v0.5 考虑 stash-rollback | P2 | waiting | 2026-05-06 |
| evidence | patchloop-p62-first-run | report:docs/reports/260506-024933 | P6.2 首轮结果（已 supersede） | superseded 由后续多次 run（含 P1+P2 验证）替代 | P1 | resolved | 2026-05-06 |
| deferred | verify-protocol-structured | spec:docs/specs/2026-05-07-patch-completeness.md | verify 命令从 shell string 升级为结构化断言（file_contains / exit_code / shell 等） | patch-completeness 上线 ≥1 周 + ≥10 fixture 实测后启动；议题 B 单独 spec | P1 | waiting | 2026-05-08 |
| evidence | patch-completeness-baseline | spec:docs/specs/2026-05-07-patch-completeness.md | rh-mixed-dashboard 3 次重跑 + 13 fixture 全量 benchmark vs 260506-004042 基线对比 | 3 次单 fixture 已收集（reports 260507-235439 / 260508-000202 / 260508-000642，plan.files 覆盖率 0/3 → 2/3，testsPassed 仍 0/3 受限模型代码质量）；13 fixture 全量 benchmark 待跑 | P1 | waiting | 2026-05-08 |
