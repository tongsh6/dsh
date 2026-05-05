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
| deferred | patchloop-repair-upgrade | spec:docs/specs/2026-05-05-patch-loop-architecture.md | repair-loop 升级到 v0.4 patch loop 协议 | v0.4 patch loop 上线后跑 ≥10 fixture，repair 表现出与 patch 类似的多文件不完整 | P2 | waiting | 2026-05-05 |
| deferred | patch-loop-stash-rollback | spec:docs/specs/2026-05-05-patch-loop-architecture.md | 事务 rollback / stash-apply（v0.5 优化） | v0.4 patch loop 上线后出现「应用后行号错位」实证 | P3 | waiting | 2026-05-05 |
| bug | exec-shell-redirect | report:docs/reports/260504-185028 | exec_shell 把 `2>&1` 误判为危险（block-pattern `/>/` 过宽） | 修 EXEC_SHELL_BLOCK_PATTERNS：把单字符 `>` 改为更精确正则（仅拒文件重定向，允许 fd 复制如 `2>&1`）；`cd X && Y` 形式留待 v0.5（受 `&&` block-pattern 阻断，需更深改造） | P3 | resolved | 2026-05-05 |
| bug | multi-file-patch-output-incomplete | report:docs/reports/260504-183633 | patch 阶段多文件任务输出不完整：模型 5 轮工具调用充分但仅产出 1/3 文件 PATCH | patch loop v0.4（spec:2026-05-05-patch-loop-architecture）上线后用相同 fixture 验证；如解决则 status→resolved | P1 | waiting | 2026-05-05 |
| debt | tool-args-coerce | code:packages/core/src/pipeline.ts:300 | tool args 写 state 前 string-coerce 临时方案（修 Bug C） | schema 放宽为 z.record(z.unknown()) + executeTool/pipeline/repair-loop 全链路类型改 unknown | P3 | waiting | 2026-05-05 |
| debt | history-spec-backfill | spec:docs/specs/2026-05-05-tracked-items-governance.md | 历史 spec（创建日期 < 2026-05-05）未按原则 8 回填「跟踪事项」章节 | best-effort：日常审阅时遇到主要 spec 顺手补，不强制时点 | P3 | waiting | 2026-05-05 |
| evidence | dsh-vs-oc-resample | report:docs/reports/compare-20260502-120419 | DSH vs OpenCode 对比仅 5 共同 fixture，样本量不足以断言 60% vs 100% | 工具系统稳定后跑 ≥10 共同 fixture（含工具系统启用版）重生成对比报告 | P2 | waiting | 2026-05-05 |
| deferred | patchloop-protocol-negotiation | spec:docs/specs/2026-05-05-patch-loop-architecture.md | 协议自动版本协商（v0.3 / v0.4 共存） | v0.4 上线后若需多版本 prompt 共存（不期望发生） | P3 | waiting | 2026-05-05 |
| deferred | phase4-agent-loop | spec:docs/specs/2026-05-05-patch-loop-architecture.md | BLUEPRINT Phase 4 完整 Agent Loop（任务自主分解、子 Agent 并行） | BLUEPRINT Phase 2 退出 + Phase 3 工具化退出后启动 | P3 | waiting | 2026-05-05 |
| evidence | patchloop-vs-batch-baseline | spec:docs/specs/2026-05-05-patch-loop-architecture.md | v0.4 patch loop vs v0.3 batch 协议的对比基线（≥3 fixtures × 3 次） | patch-loop spec G6 实施完成后立即收集 | P1 | waiting | 2026-05-05 |
| deferred | tracked-items-dashboard | spec:docs/specs/2026-05-05-tracked-items-governance.md | 跟踪事项可视化 / dashboard | 跟踪事项数 > 30 时启动 | P3 | waiting | 2026-05-05 |
| deferred | tracked-items-auto-promotion | spec:docs/specs/2026-05-05-tracked-items-governance.md | 跟踪事项自动 promotion 推荐（"该 ready 了"提示） | CI 脚本稳定运行 90 天后启动 | P3 | waiting | 2026-05-05 |
| evidence | governance-overhead-baseline | spec:docs/specs/2026-05-05-tracked-items-governance.md | 治理体系实际维护成本 vs spec §5.3 估算（人工登记 < 30s、CI < 5s、月度复审 < 15min） | G4 完成 30 天后统计实际数据 | P3 | waiting | 2026-05-05 |
| bug | scan-workflow-branch-mismatch | code:.github/workflows/scan.yml:6 | scan.yml push 触发分支配置为 `main`，但项目主分支是 `master`，导致 push 到 master 不触发 lint/typecheck/test/check-tracked-items CI | 改为 `branches: [master, main]`，同时支持两分支以便未来重命名 | P2 | resolved | 2026-05-05 |
| bug | ci-pnpm-version-missing | code:package.json | scan-workflow-branch-mismatch 修复后 CI 首次实际触发 push 即报错：`pnpm/action-setup@v4` 找不到 pnpm version（package.json 缺 `packageManager` 字段） | 加 `"packageManager": "pnpm@10.33.0"` 到 package.json（与本机 pnpm 版本对齐） | P1 | resolved | 2026-05-05 |
| bug | ci-missing-build-step | code:.github/workflows/scan.yml | ci-pnpm-version-missing 修复后 CI 第二轮触发 typecheck 失败：找不到 `@dsh/repo` / `@dsh/provider` 模块。本地 typecheck 通过是因为 `packages/*/dist/` 已 build；CI pnpm install 后 dist/ 为空，跨包 import 解析失败 | 在 scan.yml 的 pnpm install 之后、pnpm run scan 之前插入 `pnpm -r run build` step | P1 | resolved | 2026-05-05 |
| deferred | ci-actions-node24-upgrade | code:.github/workflows/scan.yml | actions/checkout@v4 / setup-node@v4 / pnpm-action-setup@v4 仍跑在 Node.js 20，GitHub 已宣布 2026-06-02 默认切到 Node 24、2026-09-16 后 Node 20 移除 | 2026-06-02 之前升级到支持 Node 24 的 actions/* 主版本（或在 workflow 设 FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true 临时过渡） | P3 | waiting | 2026-05-05 |
| evidence | patchloop-e2e-selfhost-260505 | report:docs/reports/session-260505-summary.md | P6.1 自托管 e2e：v0.4 patch loop 端到端跑通（30 轮，tool/change 交替正常，patch_rounds 完整记录）。模型未主动 `<DONE/>`，用完 30 轮上限；SEARCH_REPLACE 损坏函数签名。prompt DONE 触发需强化。 | P6.2 之前 prompt tweak；P6.2 后对比 DONE 率变化 | P1 | waiting | 2026-05-05 |
| debt | patchloop-done-prompt-weak | code:packages/core/src/prompt-builder.ts | v0.4 PATCH_PROMPT_V4 Termination 节对 `<DONE/>` 触发条件描述不够显著，P6.1 自托管 e2e 模型 30 轮未主动 DONE。P6.2 中 1/3 fixture 触发了 DONE（改进但不充分） | prompt 微调两次：①Termination 节提前并强调"立即 DONE" ② P6.2 数据显示 DONE 率 33%，仍需进一步优化。后续方向：加"MAX 10 turns，默认 DONE"约束、减工具描述长度以减少探索倾向 | P1 | waiting | 2026-05-05 |
| evidence | patchloop-search-replace-risk-realized | code:packages/core/src/pipeline.ts (restored) | spec §6 风险"SEARCH/REPLACE 行号错位"变体实证：P6.1 e2e 中模型用 SEARCH_REPLACE 替换 JSDoc 时误删函数参数列表。prompt 已强调"copy verbatim"，但模型仍不精确。 | 长期跟踪；v0.5 考虑 stash-rollback（相关 deferred item：patch-loop-stash-rollback） | P2 | waiting | 2026-05-05 |
| evidence | patchloop-p62-first-run | report:docs/reports/260505-135720 | P6.2 首轮 3 fixtures × 1 run：DONE 率 33% (1/3)，0% test pass，avg 27 tool rounds/fixture，模型系统性地过度探索。loam-bugfix-cli-error-handling 仅改 2/3 文件。 | 建议 ≥3 次 run 收集统计显著性后再评估 spec §5.2；prompt 需进一步约束探索轮数 | P1 | waiting | 2026-05-05 |
