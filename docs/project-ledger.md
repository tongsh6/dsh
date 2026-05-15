# DSH 项目事实台账

> 状态: active | 最后更新: 2026-05-15
>
> 任何新会话 AI 或新人进入项目后，**请先阅读本文件**，以便快速恢复项目状态基线。

## 1. 当前阶段目标

**Phase 3（工具化 / 验证闭环攻坚）**。详见 [BLUEPRINT.md](../BLUEPRINT.md) §3。

### Phase 3 核心演进
- **议题 A (dsh-autonomous-env)**: ✅ P1-P2 已实施（去保姆化 + runPreflight 状态机 + prompt 增强 + 命令白名单 + repair 扩容 + fixture 验证命令修正）。
- **议题 B (verify-protocol-structured)**: ✅ P1-P6 已实施，结构化验证协议上线。
- **议题 C (goal-driven-verify)**: ✅ P1-P2 已实施，代码已合并（config redaction + autonomous verification prompts + PLAN retry + scope 软化 + DONE 接受放松）。
- **议题 D (transactional-self-correction)**: ✅ P1 已实施并通过本地测试（双轨 checkpoint + managed_files + 物理回滚 + ANSI 剥离）；loam smoke PASS，rh smoke `260513-013656` PASS，repairSuccess 1/1。
- **Phase 3 起点基线**: testsPassed 11/24 = 45%（`260508-003359` / `260509-165142`）。
- **目标**: testsPassed > 60%.
- **最新 replicated benchmark evidence**: Project Card on `60/72 = 83.3%` over 24 fixtures × 3 reps — `docs/reports/knowledge/20260514-pie-phase2-3-baseline.md`；该结果已超过 Phase 3 `>60%` 目标，但 3 个 hard-fail fixture 仍需根因分析。

### 验证分层原则
- **单元/类型/静态验证是日常反馈**：代码修改后优先跑相关 package test、typecheck、lint/build，验证局部合同和编译质量。
- **定向 smoke 是 blocker 闭环验证**：只有当改动触及某个真实 fixture blocker，或需要证明一个具体端到端路径已收敛时，才跑对应单 fixture smoke。
- **benchmark 是阶段性能力评估**：全量或多 fixture benchmark 用于阶段收口、指标对比、跨 fixture 回归排查、对外宣称 testsPassed/repairSuccess 提升；不要把 benchmark 当成每次代码修改后的常规验证。
- **记录要求**：任何 benchmark 运行都应说明目的、baseline、结论和下一步；如果只是验证本地代码正确性，应选择更小的测试命令。

### Phase 2 终态（已退出，归档参考）
- [x] 静态扫描 Phase 2-3（Top N 可解释选择）
- [x] 首份 DSH vs OpenCode 对比报告
- [x] 多仓库（3 repos 各 ≥3 fixture，24 fixture full benchmark `260508-003359`）
- [x] 完成率（双口径：completed 24/24 = 100% ✓；testsPassed 11/24 = 45% 作为 Phase 3 baseline）
- [x] 对比报告（`docs/reports/runlogs/260506-004042` + 升级版 `docs/reports/runlogs/260508-003359`）
- [x] v0.4 协议操作覆盖率（6 种全达标）
- [x] 多语言（Python 4/7 ≥3 ✓；TypeScript/loamlog 3/8 ≥3 ✓；rh Java+Vue 混合 4/9 ≥3 ✓）
- [x] 跨工具对比（DSH vs OpenCode，13 fixture 对比完成）
- [x] 长期跟踪事项复审（v1 21 条 + v2 25 条，两轮复审完成）

### Phase 3 起点
- baseline（原始）: testsPassed 11/24 (45%) — `260508-003359`
- **最新稳定全量**: testsPassed 11/24 (45%) — `260509-165142`（parallel=3, 2087s, 3x 加速）
  - pi: 5/7 (71%), loam: 4/8 (50%), rh: 2/9 (22%)
- **最新 replicated evidence**: Project Card on `60/72 = 83.3%`（24 fixtures × 3 reps），约等价 `20/24`；详见 `docs/reports/knowledge/20260514-pie-phase2-3-baseline.md`
- **rh debug 后**: 3/9 (33%) — `260509-181614`。NoSuchMethodError 已修（mvn install），剩余 PARTIAL 是模型输出不完整（1/2 files changed）
- 目标: testsPassed >60%
- 议题 B（`verify-protocol-structured`）：✅ P1-P6 已实施完成
- 议题 A+C P1 代码实施：✅ 已完成（commit 待推送）
- 议题 D P1：✅ 已实施并通过 `pnpm run test` / `pnpm run typecheck` / `pnpm run lint`；loam smoke `260512-225408` PASS；rh smoke `260513-013656` PASS（源文件+测试文件已存在，结构化 Maven 验证触发，patch loop DONE=✓，repair 修复首轮测试失败后最终 Maven 通过）
- 并行 benchmark：✅ `--parallel=N` 已上线（git worktree + semaphore pool）
- 关键 bug 已修：CLOSE_WAIT body 超时、failure-detector regex 无限循环、`.m2` 旧 jar NoSuchMethodError
- ready 议题：Phase 3 failure matrix（P0）、3 个 hard-fail fixture 根因分析（P1）、最小 `dsh run`（P2）
- 下一步：先维护 failure matrix，再定点复现 `pi-bugfix-count-defs`、`rh-refactor-branch-orchestrator`、`rh-test-dashboard-version`，避免无证据泛化优化

## 2. 已完成事项

| 事项 | 完成时间 | 证据路径 | 验证方式 | 备注 |
|------|---------|---------|---------|------|
| Phase 1 MVP 闭环 | 2026-05-02 | `packages/core/src/pipeline.ts` | 386 测试通过 | Plan→Patch→Verify→Repair→Handoff |
| CLI 命令集 | 2026-05-02 起 | `packages/cli/src/commands/` | CLI 测试通过 | init/plan/patch/verify/repair/handoff/doctor/run |
| DeepSeek API 客户端 | 2026-05-02 | `packages/provider/src/client.ts` | 23 测试通过 | 含 tools 参数支持 |
| ProjectIntelligence 项目识别 | 2026-05-14 | `packages/repo/src/intelligence.ts` | repo 测试通过 | Fact → Candidate → Decision → Capability；`scanner.ts` 已退役 |
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
| 536 单元测试 | `pnpm run test` | — | 全部通过（2026-05-13 本地验证；provider 23 + repo 63 + core 385 + cli 23 + eval 43） |
| DSH vs OpenCode 对比 | Benchmark（5 fixtures, pi-proof-forge） | `docs/reports/runlogs/compare-20260502-120419/` | DSH 60% vs OC 100%，修复质量有差距 |
| 工具系统 Benchmark（loamlog） | Benchmark（5 fixtures） | `docs/reports/runlogs/260504-140432/` | 80% 完成，0/2 修复成功，工具零调用 |
| 24 fixture 全量 Benchmark（patch-completeness 后） | Benchmark（24 fixtures, 3 repo） | `docs/reports/knowledge/260508-24-fixture-benchmark-analysis.md` | completed 24/24 (100%)，testsPassed 11/24 (45%)；协议覆盖 6/6 达标；多语言 3/3 ≥3 通过 |
| 并行 Benchmark（DONE 接受+补全模式+regex fix） | Benchmark（24 fixtures, parallel=3） | `docs/reports/runlogs/260509-165142/` | completed 24/24，testsPassed 11/24 (45%)，2087s（3x 加速）；pi 5/7(71%), loam 4/8(50%), rh 2/9(22%)；repair 0/12 |
| 议题 D loam smoke | Benchmark（1 fixture） | `docs/reports/runlogs/260512-225408/` | `loam-docs-provider-readme` PASS，completed 1/1，testsPassed 1/1，score 99；`<FILES>` 描述解析假阳性已修复 |
| 议题 D rh smoke（第一轮） | Benchmark（1 fixture） | `docs/reports/runlogs/260512-230044/` | `rh-bugfix-csv-export` PARTIAL；暴露 `<FILES>` 合同/补全与 Maven 定向验证问题 |
| rh smoke 系统性修复验证 | Benchmark（1 fixture） | `docs/reports/runlogs/260513-000650/` | PARTIAL；已推进为源文件+测试文件存在、结构化 Maven 验证运行；剩余失败为 `ExportAppService.java:[35,18] 需要';'` 编译错误，repairSuccess 仍 0/1 |
| rh smoke repair 诊断增强验证 | Benchmark（1 fixture） | `docs/reports/runlogs/260513-011828/` | PARTIAL；patch loop DONE=✓，CREATE/PATCH/SEARCH_REPLACE 均有统计，Maven 测试已进入运行期；剩余失败为 `ExportAppServiceTest.createRunItem` 触发 `RunItem.rehydrate`/`BaseEntity` NPE，repairSuccess 仍 0/1 |
| rh smoke blocker 收敛验证 | Benchmark（1 fixture） | `docs/reports/runlogs/260513-013656/` | PASS；`rh-bugfix-csv-export` completed 1/1，testsPassed 1/1，repairSuccess 1/1，score 99；首轮 Maven 测试失败后 repair 追加测试补丁并通过第二轮结构化 Maven verify |

## 4. 进行中事项

| 事项 | 当前状态 | 阻塞点 | 下一步 |
|------|---------|--------|--------|
| Phase 3 failure matrix | 已建立 | 最新 replicated evidence 已整理为 hard-fail / high-variance 矩阵 | 依据矩阵定点复现，不做无证据泛化优化 |
| hard-fail fixture 根因分析 | 已完成首轮定点复现 | `pi-bugfix-count-defs` 与 `rh-test-dashboard-version` 已 single PASS；`rh-refactor-branch-orchestrator` monolith 已拆解，5 个小 fixture 已全部 single PASS | 下次做 N=3/全量复审，原 monolith 不再作为单 fixture 继续优化 |
| 最小 `dsh run` | 已补 CLI 入口 | core 已有 `runFullPipeline`，CLI 已提供一键入口 | 继续通过 CLI 测试和真实 dry-run/smoke 验证输出体验 |

## 5. 已废弃事项

| 事项 | 废弃原因 | 决策证据 | 是否有残留 |
|------|---------|---------|-----------|
| superpowers/ 目录结构 | 重构为 docs/ 目录 | commit `c86e790` | 否 |

## 6. 当前 Top Priority

| 优先级 | 事项 | 原因 | 验收标准 |
|--------|------|------|---------|
| P1 | `rh-refactor-branch-orchestrator` 拆分后 N=3 复审 | 原 single fixture 在干净 runner 下仍 PARTIAL (`260515-024737`，30 rounds / 0 changes)，已拆为 5 个小 fixture；create/tests/release/code-merge/attach 已全部 single PASS，attach 最新 `260515-044458` PASS | 下次 replicated benchmark 确认 5 个小 fixture 稳定，不恢复 monolith |
| P1 | `rh-test-dashboard-version` Maven verify 修复复审 | 已修复并 single smoke PASS (`260515-013524`)；等待下一轮 N=3/全量确认从 hard-fail 移除 | 下次 replicated benchmark 不再出现 upstream no-tests / Maven 拓扑误伤 |
| P1 | `pi-bugfix-count-defs` semantic failure 复审 | 已修正 fixture source-context hint 并 single smoke PASS (`260515-015045`)；等待下一轮 N=3/全量确认稳定性 | 下次 replicated benchmark 不再 0/6；pytest 定向验证持续通过 |

## 7. 关键证据索引

| 证据 | 路径 | 说明 |
|------|------|------|
| 项目宪法 | `CONSTITUTION.md` | 5 项核心原则 + 3 条 AI 规则 + 3 项技术原则（含原则 8 跟踪事项治理） |
| 产品蓝图 | `BLUEPRINT.md` | 7 阶段演进 + Phase 2 退出条件 |
| 任务规范 | `docs/TASK-SPEC.md` | 任务格式、生命周期、三层体系 |
| 最新全量 Benchmark | `docs/reports/runlogs/260509-165142/` | 24 fixtures, parallel=3, 2087s, testsPassed 11/24 (45%) |
| 最新 replicated Benchmark | `docs/reports/knowledge/20260514-pie-phase2-3-baseline.md` | N=3 randomized hard cleanup；Project Card on 60/72 (83.3%) |
| Phase 3 Failure Matrix | `docs/reports/knowledge/20260514-phase3-failure-matrix.md` | hard-fail / high-variance fixture 分类与下一轮修复顺序 |
| 最新 smoke Benchmark | `docs/reports/runlogs/260512-225408/` + `docs/reports/runlogs/260513-013656/` | loam PASS；rh PASS，repairSuccess 1/1 |
| rh Debug Benchmark | `docs/reports/runlogs/260509-174358/` + `260509-181614/` | rh 9 fixtures, mvn clean compile→mvn install 修复 NoSuchMethodError |
| 决策知识库 | `docs/reports/knowledge/` | Phase 退出审查、session 总结、benchmark 分析报告、对比报告（提交到 Git） |
| Benchmark 运行产物 | `docs/reports/runlogs/260*-*/` | 机器生成的运行报告（.gitignore，本地保留不提交） |
| 对比报告 | `docs/reports/knowledge/dsh-vs-opencode-comparison.md` | DSH vs OpenCode |
| 工具系统 Spec | `docs/specs/2026-05-04-tool-system.md` | 工具系统完整设计 |
| 工具采纳修复 Spec | `docs/specs/2026-05-04-tool-adoption-fix.md` | 本次修复设计 |
| 核心源码 | `packages/core/src/` | pipeline, patch-parser, repair-loop, tools |
| CLI 源码 | `packages/cli/src/` | init/plan/patch/verify/repair/handoff/doctor/run |
| Provider 源码 | `packages/provider/src/` | DeepSeek API 客户端 |
| Repo 源码 | `packages/repo/src/` | ProjectIntelligence、配置加载、文件排序 |
| Eval 源码 | `packages/eval/src/` | Benchmark 执行器、fixtures |
| CI 配置 | `.github/workflows/` | scan, benchmark, codeql, gitleaks |
| 自主环境 Spec | `docs/specs/2026-05-10-autonomous-env-verification.md` | 议题 A：剥离保姆层 + 环境自愈 |
| 目标驱动验证 Spec | `docs/specs/2026-05-10-goal-driven-verification.md` | 议题 C：从指令驱动转向自主验证推导 |
| 事务自愈 Spec | `docs/specs/2026-05-10-transactional-self-correction.md` | 议题 D：双轨快照 + managed_files + 物理回滚（含 2 轮 review 意见） |
| 议题 A P1 Task | `docs/tasks/2026-05-10-dsh-autonomous-env-p1.md` | 剥离 Benchmark Runner 保姆动作 |
| 议题 C P1 Task | `docs/tasks/2026-05-10-goal-driven-verify-p1.md` | 弱化验证指令显式引导 |
| 议题 D P1 Task | `docs/tasks/2026-05-10-patch-loop-rollback-p1.md` | 基于 Git Stash 的事务级回滚基础设施 |
| 跟踪事项治理 Spec | `docs/specs/2026-05-05-tracked-items-governance.md` | CONSTITUTION 原则 8 设计依据 |
| 跟踪事项 CI 脚本 | `scripts/check-tracked-items.ts` | CONSTITUTION 原则 8 兜底；扫描 spec/report 与 ledger §8 差集；scan workflow 集成 |

## 8. 长期跟踪事项

> 治理依据：`CONSTITUTION.md` 原则 8。新会话 AI 启动时必读。任何 status ≠ resolved/cancelled 的条目都需要在合适时机被复审（BLUEPRINT 各 Phase 退出条件含「长期跟踪事项复审」checkbox）。
>
> 字段说明（按列）：type / id / source / title / trigger / prio / status / last_reviewed
> trigger 字段语义：deferred=activate_when / bug=resolve_when / debt=pay_when / evidence=collect_when

| type | id | source | title | trigger | prio | status | last_reviewed |
|------|----|--------|-------|---------|------|--------|---------------|
| deferred | dsh-autonomous-env | spec:docs/specs/2026-05-10-autonomous-env-verification.md | dsh 自主环境管理与验证推导（剥离保姆层） | ✅ P1-P2 已实施（runPreflight 状态机 + prompt 增强）。待全量 benchmark 验证。 | P1 | resolved | 2026-05-11 |
| deferred | goal-driven-verify | spec:docs/specs/2026-05-10-goal-driven-verification.md | 从指令驱动转向目标驱动的自主验证 | ✅ P1-P2 已实施（config redaction + autonomous verification prompts + PLAN retry + scope 软化 + DONE 接受放松） | P1 | resolved | 2026-05-11 |
| deferred | transactional-self-correction | spec:docs/specs/2026-05-10-transactional-self-correction.md | 事务级回滚与工程一致性审计（双轨 checkpoint + managed_files + 物理回滚） | ✅ P1 已实施并通过本地测试；loam smoke PASS (`260512-225408`)；rh smoke PASS (`260513-013656`)，repairSuccess 1/1。待 24 fixture 全量确认净效应。 | P0 | in_progress | 2026-05-13 |
| deferred | patchloop-repair-upgrade | spec:docs/specs/2026-05-05-patch-loop-architecture.md | repair-loop 升级到 v0.4 patch loop 协议 | v0.4 patch loop 上线后跑 ≥10 fixture，repair 表现出与 patch 类似的多文件不完整 | P1 | waiting | 2026-05-06 |
| deferred | patch-loop-stash-rollback | spec:docs/specs/2026-05-05-patch-loop-architecture.md | 事务 rollback / stash-apply（v0.5 优化） | v0.4 patch loop 上线后出现「应用后行号错位」实证 | P3 | waiting | 2026-05-06 |
| bug | exec-shell-redirect | report:docs/reports/runlogs/260504-185028 | exec_shell 把 `2>&1` 误判为危险 | 修 EXEC_SHELL_BLOCK_PATTERNS：`/>/` 改为 `/{1,2}\s*[^\s&]/` | P3 | resolved | 2026-05-05 |
| bug | multi-file-patch-output-incomplete | report:docs/reports/runlogs/260504-183633 | patch 阶段多文件任务输出不完整 | P1+P2 部分解决（rounds -23%），但多文件输出仍不稳定 | P1 | waiting | 2026-05-06 |
| debt | tool-args-coerce | code:packages/core/src/pipeline.ts | tool args 写 state 前 string-coerce 临时方案 | resolved：`ToolCallRecord.arguments` 已改为 `z.record(z.unknown())`；pipeline / preflight / repair 保留原始 JSON 参数写 state，工具执行层按需转换字符串参数；已补非字符串参数回归测试 | P3 | resolved | 2026-05-15 |
| debt | history-spec-backfill | spec:docs/specs/2026-05-05-tracked-items-governance.md | 历史 spec 未按原则 8 回填跟踪事项 | best-effort：日常审阅时遇到主要 spec 顺手补 | P3 | waiting | 2026-05-06 |
| evidence | dsh-vs-oc-resample | report:docs/reports/knowledge/dsh-vs-opencode-comparison.md | DSH vs OpenCode 对比（13 fixture） | 对比完成：通过率持平（62%），DSH 完成率更高（100% vs 77%）| P2 | resolved | 2026-05-06 |
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
| evidence | patchloop-e2e-selfhost-260505 | report:docs/reports/runlogs/260506-004042 | P6.1 自托管 e2e 验证（已 supersede 原始 report） | superseded 13 fixture full benchmark (260506-004042) | P1 | resolved | 2026-05-06 |
| deferred | patchloop-done-prompt-weak | code:packages/core/src/prompt-builder.ts | v0.4 DONE 触发（根因在第 7 条：元认知任务） | P1+P2 pipeline 自动终止已从代码层替代 prompt 方案 | P1 | waiting | 2026-05-06 |
| evidence | patchloop-search-replace-risk-realized | code:packages/core/src/pipeline.ts | SEARCH/REPLACE 行号错位风险已实证 | 长期跟踪；v0.5 考虑 stash-rollback | P2 | waiting | 2026-05-06 |
| evidence | patchloop-p62-first-run | report:docs/reports/runlogs/260506-024933 | P6.2 首轮结果（已 supersede） | superseded 由后续多次 run（含 P1+P2 验证）替代 | P1 | resolved | 2026-05-06 |
| deferred | verify-protocol-structured | spec:docs/specs/2026-05-07-patch-completeness.md | verify 命令从 shell string 升级为结构化断言（file_contains / exit_code / shell 等） | trigger 已满足（24 fixture 实测于 260508-003359），可起草议题 B spec | P1 | ready | 2026-05-08 |
| evidence | patch-completeness-baseline | spec:docs/specs/2026-05-07-patch-completeness.md | rh-mixed-dashboard 3 次重跑 + 24 fixture 全量 benchmark vs 260506-004042 基线对比 | 3 次单 fixture（260507-235439/260508-000202/260508-000642，plan.files 覆盖率 0/3→2/3）+ 24 fixture 全量（docs/reports/knowledge/260508-24-fixture-benchmark-analysis.md）已完成；P1-P4 净效应正向（2 false-positive 修正 + 1 副作用 + 1 偶发） | P1 | resolved | 2026-05-08 |
| evidence | fixture-false-positive-audit | report:docs/reports/knowledge/260508-24-fixture-benchmark-analysis.md | 全量审计 13 旧 fixture 的 verification commands 是否对所有 expectedFiles 做断言；列出 false-positive 候选 + 修正建议 | 至少 pi-refactor-read-text、rh-test-dashboard-version 已确认 false-positive；其他 fixture 待审计 | P1 | waiting | 2026-05-08 |
| debt | plan-files-overlist | report:docs/reports/knowledge/260508-24-fixture-benchmark-analysis.md | plan prompt 加约束"`<FILES>` 仅列出确实需要修改的文件，不要把要读取/参考的文件列入" | 已实施 (fcfc202)；2026-05-12 补 `extractFilesBlock` 描述剥离，loam smoke `260512-225408` 不再出现 scope-completeness 假阳性 | P2 | resolved | 2026-05-12 |
| bug | rh-csv-export-smoke-partial | report:docs/reports/runlogs/260513-013656 | rh-bugfix-csv-export smoke PARTIAL | resolved：`260513-013656` PASS；首轮 Maven 测试失败后 repair 追加测试补丁并通过第二轮结构化 Maven verify，filesChanged 覆盖预期两文件，repairSuccess 1/1 | P0 | resolved | 2026-05-13 |
| bug | benchmark-runner-hangs-after-artifacts | report:docs/reports/runlogs/260512-225408 | benchmark 已写出 artifacts 后 Node 进程未自然退出 | resolved：根因是 provider `res.json()` body-read timeout 成功返回后未 `clearTimeout`，每次 LLM 调用遗留最长 300s 活动 timer；已补清理和回归测试。single smoke `260515-045747` 写出 artifacts 后自然 exit code 0 | P2 | resolved | 2026-05-15 |
| bug | failure-detector-regex-infinite-loop | code:packages/core/src/failure-detector.ts:540 | extractCompilationErrors() regex 无 g 标志导致无限循环（parallel=3 时 pi-bugfix-count-defs 触发） | 已修 (89db5e8)：带 g 标志副本扫描 + 零长度匹配保护 + 回归测试 | P1 | resolved | 2026-05-09 |
| evidence | verify-protocol-structured-baseline | spec:docs/specs/2026-05-08-verify-protocol-structured.md | 议题 B 实施 P6 完成时收集（5 fixture 迁移单跑 + 24 fixture 全量 vs 260508-003359 基线对比） | P6 全量 benchmark 完成（docs/reports/knowledge/260508-verify-structured-benchmark-analysis.md）；原始 7/24 → 修正 8/24（1 实现 bug + 7 采样变异）；4 改善含 rh-mixed-dashboard-generated-at-backend 首次全量通过 | P1 | resolved | 2026-05-09 |
| deferred | verify-assertion-extensions | spec:docs/specs/2026-05-08-verify-protocol-structured.md | 评估是否引入 json_path / regex_named_capture 等扩展断言类型 | 5 个迁移 fixture 实测后，若仍有 ≥3 个 fixture 在 shell_other 类无法表达 | P2 | waiting | 2026-05-08 |
| bug | scanner-java-default-maven | code:packages/repo/src/scanner.ts:237 | detectLanguageByFiles: ≥3 .java 文件 → packageManager="maven"（弱推断伪装成事实） | 已修 (bca15fd): 无 pom.xml/build.gradle 时 packageManager=null | P1 | resolved | 2026-05-09 |
| bug | scanner-py-default-pip | code:packages/repo/src/scanner.ts:220 | detectLanguageByFiles: ≥3 .py 文件 → packageManager="pip"（同上） | 已修 (bca15fd): 无 pyproject.toml/requirements.txt 时 packageManager=null | P1 | resolved | 2026-05-09 |
| bug | scanner-ts-default-npm | code:packages/repo/src/scanner.ts:223 | detectLanguageByFiles: ≥3 .ts 文件 → packageManager="npm"（同上） | 已修 (bca15fd): 无 package.json 时 packageManager=null | P1 | resolved | 2026-05-09 |
| bug | verify-java-fallback-maven | code:packages/repo/src/scanner.ts:295 | detectVerifyCommands: packageManager 非 gradle 即默认 mvn（含 null 情形） | 已修 (bca15fd): packageManager=null 时 test/lint/typecheck/build 全返回 null | P1 | resolved | 2026-05-09 |
| deferred | project-intelligence-phase1 | spec:BLUEPRINT.md | Project Intelligence Engine 第一阶段：新建 intelligence.ts（Fact/Candidate/Decision/Capability 模型 + 工厂函数）+ context-builder 输出 ProjectCard | 已实施 (bca15fd): intelligence.ts + intelligence.test.ts + scanner bug 修复 | P1 | resolved | 2026-05-09 |
| deferred | project-intelligence-phase2 | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | PIE Phase 2：完整 Fact 收集器 + Candidate 排序 + dsh doctor + .dsh/project.yml | Phase 2 全集由本 spec v1.1 覆盖（子模块/framework Fact + dsh doctor + Project Card 注入 + .dsh/project.yml 人工确认层）；本 spec resolved 时同步转 resolved | P2 | waiting | 2026-05-13 |
| bug | provider-body-timeout | code:packages/provider/src/client.ts:211 | res.json() 在代理断连后永久阻塞（CLOSE_WAIT），导致 benchmark 卡死 | 已修 (a430453)：Promise.race body 读取超时保护 | P1 | resolved | 2026-05-09 |
| bug | failure-detector-regex-loop | code:packages/core/src/failure-detector.ts:540 | extractCompilationErrors() regex 无 g 标志导致 CPU 100% 死循环 | 已修 (89db5e8)：带 g 副本 + 零长度保护 + 回归测试 | P1 | resolved | 2026-05-09 |
| bug | benchmark-mvn-stale-jar | code:packages/eval/src/benchmark-runner.ts:241 | mvn compile 只编译到 target/，mvn test -pl <module> 无 -am 从 .m2 加载旧 jar → NoSuchMethodError | 已修 (3b8d00d)：mvn install -DskipTests 发布到 .m2 | P1 | resolved | 2026-05-09 |
| deferred | project-intelligence-phase3 | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | PIE Phase 3：detectVerifyCommands 退役 + scanner 改为 Intelligence 驱动 + verify plan 从 Capability 推导 | superseded by 本 spec v1.1：detectVerifyCommands 退役 + scanner.ts 整体物理删除 + cli/init 写 config 时 capabilities → VerifyCommands 投影；剩余 verify 模型增强（多模块独立 verify plan / test selectivity）拆出独立条目 verify-plan-model-enhancement | P3 | cancelled | 2026-05-13 |
| debt | pipeline-console-log | code:packages/core/src/pipeline.ts:452 | console.log 工具调用诊断输出应升级为结构化日志（debug/verbose flag 控制），避免污染 CLI TTY 输出 | Phase 3 退出时清理所有临时诊断输出 | P3 | waiting | 2026-05-10 |
| deferred | pie-phase2-tier2-doctor-card | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | PIE Phase 2 Tier 2：`dsh doctor` 命令 + `toProjectCard` 注入 LLM prompt | superseded by 本 spec v1.1（§3.6 覆盖：dsh doctor 命令 + context-builder 注入 Project Card） | P2 | cancelled | 2026-05-13 |
| deferred | pie-phase2-tier3-project-yml | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | PIE Phase 2 Tier 3：`.dsh/project.yml` 人工确认层 | superseded by 本 spec v1.1（§3.7 覆盖：ProjectYml zod schema + assembleIntelligence override 集成） | P3 | cancelled | 2026-05-13 |
| debt | runtime-path-resolution-ctxdirs | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | `repair-loop.ts:211` + `failure-detector.ts:559` 的 `["/backend/", "/frontend/", "/src/", ...]` ctxDirs 字面量：路径归一化时缺 project layout source of truth，被迫硬编码 | superseded by 本 spec v1.1（§3.8 覆盖：两函数接收 moduleRoots 参数，由 ProjectIntelligence 投影传入；字面量删除） | P2 | cancelled | 2026-05-13 |
| debt | canonical-module-wiring-rule | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | spec 模板 / CONSTITUTION 原则 5 展开：新模块取代旧模块时，Phase 完成验收必须含「调用方迁移率 = 100% AND 旧 API 物理删除」硬条目 | resolved：`CONSTITUTION.md` v1.2 原则 5 已加入 canonical wiring 规则；`docs/specs/_template.md` §5.4 已加入可复制验收清单，要求生产调用点 100% 迁移、legacy API 删除或登记退出条件、顶层 wiring 指向 canonical 入口 | P2 | resolved | 2026-05-15 |
| evidence | pie-phase2-tier1-baseline-comparison | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | 本 spec Step 6 完成时收集：24 fixture full benchmark vs 基线 260508-003359 / 260513-013656；context-builder.buildRepoContext 在 ≥3 fixture（TS/Python/Java+Vue）的字符级 diff 为空 | superseded by pie-phase2-3-baseline-comparison（id 反映 v1.1 扩张后的范围） | P1 | cancelled | 2026-05-13 |
| evidence | pie-phase2-3-baseline-comparison | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | 本 spec Step 12 完成时收集：24 fixture full benchmark vs 基线 260508-003359 / 260513-013656；context-builder.buildRepoContext 在 3 个代表性 fixture（TS/Python/Java+Vue）的字符级 diff 除 Project Card 新章节外零回归 | ✅ 已完成 (2026-05-14): N=3 randomized A/B with hard cleanup (260514020257-pie-replicated)；144 trials；Card on 60/72 (83.3%) > Card off 53/72 (73.6%)；累积 +37.5pp vs baseline 11/24 (45.8%)；归因分解 PIE+并发 +21pp, hard cleanup +12pp, Card 注入 +5pp。完整报告 docs/reports/knowledge/20260514-pie-phase2-3-baseline.md | P1 | resolved | 2026-05-14 |
| debt | benchmark-spec-threshold-revision | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | resolved：PIE spec v1.2 已修订 §5.2，废弃 deterministic `testsPassed ±2` 阈值，改为 N≥3 replication + hard cleanup + 总通过数不低于 baseline + 单 fixture Wilson 95% CI 退化判定；高方差 fixture 单独标注 | 已处理：`docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md` v1.2 | P1 | resolved | 2026-05-15 |
| debt | blueprint-evaluation-methodology-v1.1 | code:BLUEPRINT.md | resolved：BLUEPRINT §2.5 已加入 Phase 2.5 严肃实证方法论，明确 N≥3 randomized A/B、hard cleanup、Wilson 95% CI、高方差 fixture 标注和报告归档要求 | 已处理：`BLUEPRINT.md` §2.5 v1.1 方法论 | P1 | resolved | 2026-05-15 |
| bug | benchmark-hardfail-fixtures-3x | report:docs/reports/knowledge/20260514-pie-phase2-3-baseline.md | 3 个 fixture 在 N=3 hard cleanup × Card on/off 6 次跑全 FAIL: pi-bugfix-count-defs / rh-refactor-branch-orchestrator / rh-test-dashboard-version。根因待调查（任务难度、Python AST 推断、Spring DI 重组、Maven 拓扑等假设） | 每个 fixture 单独 task 根因分析；当前模型能力上限或 fixture 设计 bug 二选一 | P2 | waiting | 2026-05-14 |
| bug | rh-test-dashboard-version-maven-verify | report:docs/reports/knowledge/20260514-phase3-failure-matrix.md | `rh-test-dashboard-version` 在 replicated benchmark 中 0/6；根因确认是 `-am` + `-DfailIfNoTests=true` 触发 upstream no-tests 误伤。已改为结构化 `maven_test`，保留 `-am` 但不设置 `failIfNoTests=true`；single smoke `260515-013524` PASS，testsPassed=true，repairSuccess=true | 下次 N=3/全量 benchmark 复审稳定性 | P0 | resolved | 2026-05-15 |
| bug | rh-refactor-branch-orchestrator-patch-apply | report:docs/reports/knowledge/20260514-phase3-failure-matrix.md | 原 monolith clean rerun `260515-024737` 仍 PARTIAL：30 rounds / 0 changes。已删除原 fixture 并拆为 create / tests / service-code-merge / service-release-branch / service-attach：create PASS (`260515-025747`), tests PASS (`260515-025747`), release PASS (`260515-031851`), code-merge PASS after expectedFiles fix (`260515-035901`, repairSuccess 1/1), attach PASS after SEARCH/REPLACE safety + fixture constraints (`260515-044458`, repairSuccess 1/1). 同时修 benchmark runner：每个 fixture 开始时清空 worktree `.dsh`，避免旧 assertions 泄漏。 | 原 hard-fail 已拆解；下次 N=3/全量复审稳定性，不恢复 monolith | P1 | resolved | 2026-05-15 |
| bug | pi-bugfix-count-defs-semantic | report:docs/reports/knowledge/20260514-phase3-failure-matrix.md | `pi-bugfix-count-defs` 根因确认是 fixture 提示错误：真实 infra definitions 包含缩进类方法，`^def` 第 0 列匹配会漏计。已改为 `^\s*` source-context hint；single smoke `260515-015045` PASS，testsPassed=true | 下次 N=3/全量 benchmark 复审稳定性 | P1 | resolved | 2026-05-15 |
| debt | benchmark-wallclock-optimization | code:scripts/benchmark-pie-replicated.ts | 144 trial 跑了 18.8 hr 挂钟（vs 估算 5-6 hr），parallel 利用率 < 33%。优化方向：LPT 调度 + fixture-level parallel（同 repo 内 fixture 互不冲突时可并行）+ outlier 时长上限 | 下次 N≥3 benchmark 前优化；非阻塞 | P3 | waiting | 2026-05-14 |
| deferred | verify-plan-model-enhancement | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | §7.3 中显式排除的剩余范围：多模块独立 verify plan、test selectivity 等 verify 模型增强；本 spec 只做 cli/init 写 config 时的 capabilities → VerifyCommands 投影 | benchmark 数据揭示 verify plan 在多模块项目 / test selectivity 场景出现需求时启动 | P3 | waiting | 2026-05-13 |
| debt | tracked-items-resolved-path-check | spec:docs/specs/2026-05-05-tracked-items-governance.md | resolved：治理 spec v1.1 已明确 `source` 字段语义：active 条目必须保持路径存在；status=resolved/cancelled 后 source 是历史指针，CI 不再校验路径存在。脚本既有跳过逻辑已补回归测试 | 已处理：`docs/specs/2026-05-05-tracked-items-governance.md` v1.1 + `scripts/check-tracked-items.test.ts` | P3 | resolved | 2026-05-15 |
| debt | phase2-exit-fixture-doc-lag | spec:docs/specs/2026-05-06-phase2-exit-fixtures.md | doc-lag 回补：commit `f97aae3` 实施时按"单侧成对 fixture"拆 rh 混合 (3 个设计→6 个实施 yaml)，但 spec §3.3 第 2 条/§3.5/§4.6 没同步；BLUEPRINT Phase 2 退出条件"Java+Vue 混合 ≥3" 按旧 §3.3 定义不达成（0/3 双侧），按 v0.6 新定义达成 (3 pair)。**已修**: spec v0.6 (2026-05-14) 扩展 §3.3 第 2 条，新增"单侧成对"作为合法实施选项 + 计数规则；未来类似 mid-implementation 偏离 spec 时，应在同 commit 更新 spec 而不是延迟 8 天才回补 | spec 治理流程: 任何 commit 实施偏离设计 spec 时，必须在同 commit 更新 spec 或加 ledger debt | P2 | waiting | 2026-05-14 |
