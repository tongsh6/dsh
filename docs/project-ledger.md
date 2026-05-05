# DSH 项目事实台账

> 状态: active | 最后更新: 2026-05-04
>
> 任何新会话 AI 或新人进入项目后，**请先阅读本文件**，以便快速恢复项目状态基线。

## 1. 当前阶段目标

Phase 2（协议+评测完善）。详见 [BLUEPRINT.md](../BLUEPRINT.md) §3。

退出条件（7 条）详见 BLUEPRINT.md。当前进展：
- [x] 静态扫描 Phase 2-3（Top N 可解释选择）
- [x] 首份 DSH vs OpenCode 对比报告
- [ ] v0.3 协议操作覆盖率（每条操作 ≥3 fixture + ≥1 实际触发）
- [ ] 多语言（Python + TypeScript 各 ≥3 fixture 通过）
- [ ] 多仓库（≥3 repo 各 ≥3 fixture 通过）
- [ ] 完成率（≥10 fixture 完成率 >60%）
- [ ] ≥5 相同 fixture DSH vs OpenCode 对比

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

## 5. 已废弃事项

| 事项 | 废弃原因 | 决策证据 | 是否有残留 |
|------|---------|---------|-----------|
| superpowers/ 目录结构 | 重构为 docs/ 目录 | commit `c86e790` | 否 |

## 6. 当前 Top Priority

| 优先级 | 事项 | 原因 | 验收标准 |
|--------|------|------|---------|
| P0 | 跑 benchmark 验证工具采纳率修复（da7c554） | 代码已落地，行为数据缺失，最新报告 260504-140432 跑在修复前 commit `c86e790` 上 | 新 run 的 `metadata.json.dsh_commit` 为 `da7c554` 或之后；至少 1 fixture 的 task-state 含非空 `tool_rounds` |
| P1 | 多仓库/多语言全量 benchmark | Phase 2 退出条件 5 项依赖（多语言/多仓库/完成率/协议覆盖/对比） | 单 run ≥10 fixture，3 仓库各 ≥3 fixture 通过，完成率 >60% |
| P2 | 修复循环成功率提升 | 当前 0/2，目标 ≥33% | 上述 benchmark 中 repairSuccess 数据 |

## 7. 关键证据索引

| 证据 | 路径 | 说明 |
|------|------|------|
| 项目宪法 | `CONSTITUTION.md` | 5 项核心原则 + 3 条 AI 规则 |
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
