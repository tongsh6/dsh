# DSH 项目事实台账

> 状态: active | 最后更新: 2026-05-18
>
> 任何新会话 AI 或新人进入项目后，**请先阅读本文件**，以便快速恢复项目状态基线。

## 1. 当前阶段目标

**Phase 3 收口验证期**。详见 [BLUEPRINT.md](../BLUEPRINT.md) §3。

### Phase 3 核心演进
- **议题 A (dsh-autonomous-env)**: ✅ P1-P2 已实施（去保姆化 + runPreflight 状态机 + prompt 增强 + 命令白名单 + repair 扩容 + fixture 验证命令修正）。
- **议题 B (verify-protocol-structured)**: ✅ P1-P6 已实施，结构化验证协议上线。
- **议题 C (goal-driven-verify)**: ✅ P1-P2 已实施，代码已合并（config redaction + autonomous verification prompts + PLAN retry + scope 软化 + DONE 接受放松）。
- **议题 D (transactional-self-correction)**: ✅ P1 已实施并通过本地测试（双轨 checkpoint + managed_files + 物理回滚 + ANSI 剥离）；loam smoke PASS，rh smoke `260513-013656` PASS，repairSuccess 1/1。
- **DeepSeek-native adaptation**: ✅ 已实施（official `/chat/completions` endpoint、`thinking.type` + `reasoning_effort high/max`、cache/reasoning usage、HTTP retry/error metadata、message/tool/stream normalizer、capability registry、阶段化 tool policy、状态证据 sidecars、JSON/strict/prefix/FIM 扩展点）；`pnpm test` / `pnpm typecheck` / `pnpm lint` PASS。
- **Phase 3 起点基线**: testsPassed 11/24 = 45%（`260508-003359` / `260509-165142`）。
- **目标**: testsPassed > 60%.
- **最新 replicated benchmark evidence**: Project Card on `60/72 = 83.3%` over 24 fixtures × 3 reps — `docs/reports/knowledge/20260514-pie-phase2-3-baseline.md`；该结果已超过 Phase 3 `>60%` 目标，但 hard-fail smoke 修复仍需新的 N=3 / full benchmark 复审。
- **2026-05-17 收口复审**: full replicated run `docs/reports/runlogs/260517074552-pie-replicated/` 因成本控制在 12/168 trials 后中断；partial evidence 已足够判定 Phase 3 不可退出：`rh-test-dashboard-version` card_on 0/1、card_off 0/1，single smoke PASS 未在 replicated 环境稳定复现。
- **2026-05-17 定向 N=3 复审**: `rh-test-dashboard-version` valid rerun `docs/reports/runlogs/260517133604-pie-replicated/` 为 card_on 0/3、card_off 0/3。
- **2026-05-18 `rh-test-dashboard-version` fixture 有效性审计与重新归类**: 对该 blocker 做了结构化根因分析。结论——**fixture 有效，无设计缺陷**：两个目标测试文件在参考提交 `180de500` 不存在（"新建"前提成立）；benchmark runner 每条运行路径开头都跑 `reset --hard` + `clean -fd`，会清除未跟踪残留，**无状态泄漏**；single smoke `260517-222513` 已产出干净的可通过解（任务可解）；强制 Mockito 与仓库多数派风格（11/19 app 测试）一致。N=3 不稳定的真实原因是**模型在硬 JUnit5+Mockito CREATE 任务上的输出方差**（`List<VersionUpdaterPort>` 构造注入使 `@InjectMocks` 失效、strict-stub、捏造 enum 常量编译错、两文件只产出其一），既不是 DSH bug 也不是 fixture 设计 bug。failure matrix 已将该 fixture 从 `wrong_verification_command`/`regressed` 重新归类为 `high_variance`/`pending_replication`。上一会话为该 fixture 反应式新增的 PLAN/repair 兜底（任务描述路径抓取、PLAN 段 `<FILES>` 恢复、Java FQN 上下文、Mockito hint、repair 空输出重试）已**全部回退**，理由：打补丁式、违反宪法原则 1/3/5、缺类别级证据、含可比性污染（harness 端抓取 fixture 提示里的答案）。BLUEPRINT 已据此升级到 v1.2——Phase 3 退出条件 B 改为「hard-fail / high-variance fixture 经复审分流」：高方差 fixture 单独标注、不作单 fixture 硬门禁，Phase 3 退出以聚合 `testsPassed >60%` 为准。本轮 `pnpm run scan` 全绿（669 测试 0 失败）。
- **failure matrix 机器可读资产**: `packages/eval/src/failure-matrix.json` 是后续 AI / benchmark runner 判断 fixture 状态的主入口；Markdown 报告仅作为人读解释。

### 验证分层原则
- **单元/类型/静态验证是日常反馈**：代码修改后优先跑相关 package test、typecheck、lint/build，验证局部合同和编译质量。
- **定向 smoke 是 blocker 闭环验证**：只有当改动触及某个真实 fixture blocker，或需要证明一个具体端到端路径已收敛时，才跑对应单 fixture smoke。
- **benchmark 是阶段性能力评估**：全量或多 fixture benchmark 用于阶段收口、指标对比、跨 fixture 回归排查、对外宣称 testsPassed/repairSuccess 提升；不要把 benchmark 当成每次代码修改后的常规验证。
- **记录要求**：任何 benchmark 运行都应说明目的、baseline、结论和下一步；如果只是验证本地代码正确性，应选择更小的测试命令。

### Phase 3 退出条件
- [x] ProjectIntelligence 是 init / pipeline / context 的唯一主路径。
- [x] README / BLUEPRINT / project-ledger / GitHub 可见 README 状态一致。
- [ ] 最新 N=3 replicated benchmark 达到 Phase 3 目标，且 Project Card on 收益持续。
- [ ] hard-fail / high-variance fixture 经复审分流：复审后落入 §2.5 高方差区间（约 25%–75%）的 fixture 标注为 high-variance 并单独报告，不作单 fixture 硬门禁（详见 BLUEPRINT §3 Phase 3 退出条件）。
- [x] failure matrix 已机器可读：`packages/eval/src/failure-matrix.json`。
- [x] legacy scanner 有防回流测试：`packages/repo/src/legacy-scanner-guard.test.ts`。
- [x] `dsh run` / `dsh doctor` 作为最小产品入口通过测试。
- [x] build / typecheck / lint / test 全部通过。

当前剩余退出 blocker 是 benchmark 证据闭环，而不是文档入口、legacy scanner 或 ProjectIntelligence wiring。2026-05-17 收口提交 `454f731` 已完成文档一致性、failure matrix JSON、legacy 防回流测试、ProjectIntelligence decision mode 收紧和质量门禁。`rh-test-dashboard-version` 经 2026-05-18 有效性审计已重新归类为 high-variance fixture（非 regressed、非 DSH bug、非 fixture 设计缺陷），按 BLUEPRINT §2.5 第 3 条单独标注、不作为硬门禁；Phase 3 退出改以最新 N=3 replicated 的**聚合 testsPassed >60%** 为判据，单 fixture 高方差不再单独阻断退出。

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
- **最新 targeted replicated evidence**: `rh-test-dashboard-version` N=3 `260517133604-pie-replicated` 为 card_on 0/3、card_off 0/3；2026-05-18 已重新归类为 high-variance fixture（fixture 有效，失败源于模型输出方差，详见 §1）。
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
| Plan 阶段只读工具轮 | 2026-05-17 | `packages/core/src/pipeline.ts` + `docs/specs/2026-05-04-tool-system.md` | `pnpm run scan` PASS | plan 可使用 read_file/grep_files，最多 5 轮后降级要求输出最终 PLAN；修复 targeted benchmark 中 tool limit hard fail |
| 修复循环工具支持 | 2026-05-04 | `packages/core/src/repair-loop.ts` L208-238 | 测试通过 | 2→3 轮工具循环 |
| DeepSeek provider hardening | 2026-05-17 | `packages/provider/src/client.ts` + `docs/specs/deepseek-api-compatibility.md` | `pnpm test` / `pnpm typecheck` / `pnpm lint` PASS | official endpoint、thinking.type、usage/cache、retry、staged tool policy、实验性高级能力扩展点 |
| DeepSeek-native adaptation L1-L7 | 2026-05-17 | `packages/provider/src/client.ts` + `normalizer.ts` + `capability-registry.ts`; `packages/core/src/task-state.ts`; `docs/specs/deepseek-api-compatibility.md`; `docs/specs/execution-contract.md`; `docs/specs/state-evidence.md`; `docs/evals/deepseek-coding-harness-eval.md` | `pnpm test` / `pnpm typecheck` / `pnpm lint` PASS | P0-P2 最小闭环：API 语义、provider normalizer、错误 metadata、capability registry、state evidence sidecars、eval 设计与文档矩阵 |
| Benchmark 系统 | 2026-05-02 | `packages/eval/` + `run-benchmark.ts` | 24 eval 测试通过 | 多项目多语言 fixtures |
| CI 质量门禁 | 2026-05-02 | `.github/workflows/scan.yml` | PR CI 通过 | lint+typecheck+test |
| Benchmark CI | 2026-05-02 | `.github/workflows/benchmark.yml` | 每周六定时 | GitHub Actions |
| 安全扫描 CI | 2026-05-02 | `.github/workflows/codeql.yml` + `gitleaks.yml` | — | CodeQL + Gitleaks |

## 3. 已验证事项

| 事项 | 验证方式 | 报告路径 | 结论 |
|------|---------|---------|------|
| 669 单元测试 | `pnpm test` | — | 全部通过（2026-05-17 本地验证；provider 48 + repo 92 + core 430 + cli 34 + eval 65） |
| DSH vs OpenCode 对比 | Benchmark（5 fixtures, pi-proof-forge） | `docs/reports/runlogs/compare-20260502-120419/` | DSH 60% vs OC 100%，修复质量有差距 |
| DSH vs mini-cc 对比 | 代码/架构审阅（本地 dsh + `/private/tmp/mini-cc`） | 本台账 §8 `dsh-vs-mini-cc-comparison` | mini-cc 优势在交互式 UX、多 provider、工具/MCP 扩展；dsh 优势在验证闭环、可审计状态、patch 安全、benchmark 文化 |
| 工具系统 Benchmark（loamlog） | Benchmark（5 fixtures） | `docs/reports/runlogs/260504-140432/` | 80% 完成，0/2 修复成功，工具零调用 |
| 24 fixture 全量 Benchmark（patch-completeness 后） | Benchmark（24 fixtures, 3 repo） | `docs/reports/knowledge/260508-24-fixture-benchmark-analysis.md` | completed 24/24 (100%)，testsPassed 11/24 (45%)；协议覆盖 6/6 达标；多语言 3/3 ≥3 通过 |
| 并行 Benchmark（DONE 接受+补全模式+regex fix） | Benchmark（24 fixtures, parallel=3） | `docs/reports/runlogs/260509-165142/` | completed 24/24，testsPassed 11/24 (45%)，2087s（3x 加速）；pi 5/7(71%), loam 4/8(50%), rh 2/9(22%)；repair 0/12 |
| 议题 D loam smoke | Benchmark（1 fixture） | `docs/reports/runlogs/260512-225408/` | `loam-docs-provider-readme` PASS，completed 1/1，testsPassed 1/1，score 99；`<FILES>` 描述解析假阳性已修复 |
| 议题 D rh smoke（第一轮） | Benchmark（1 fixture） | `docs/reports/runlogs/260512-230044/` | `rh-bugfix-csv-export` PARTIAL；暴露 `<FILES>` 合同/补全与 Maven 定向验证问题 |
| rh smoke 系统性修复验证 | Benchmark（1 fixture） | `docs/reports/runlogs/260513-000650/` | PARTIAL；已推进为源文件+测试文件存在、结构化 Maven 验证运行；剩余失败为 `ExportAppService.java:[35,18] 需要';'` 编译错误，repairSuccess 仍 0/1 |
| rh smoke repair 诊断增强验证 | Benchmark（1 fixture） | `docs/reports/runlogs/260513-011828/` | PARTIAL；patch loop DONE=✓，CREATE/PATCH/SEARCH_REPLACE 均有统计，Maven 测试已进入运行期；剩余失败为 `ExportAppServiceTest.createRunItem` 触发 `RunItem.rehydrate`/`BaseEntity` NPE，repairSuccess 仍 0/1 |
| rh smoke blocker 收敛验证 | Benchmark（1 fixture） | `docs/reports/runlogs/260513-013656/` | PASS；`rh-bugfix-csv-export` completed 1/1，testsPassed 1/1，repairSuccess 1/1，score 99；首轮 Maven 测试失败后 repair 追加测试补丁并通过第二轮结构化 Maven verify |
| DeepSeek provider hardening | 本地质量门禁 | `docs/specs/deepseek-api-compatibility.md` | PASS；provider endpoint/thinking/retry/usage/stream tests，core staged tool loop tests，root `pnpm test` / `pnpm typecheck` / `pnpm lint` 全部通过 |
| DeepSeek-native L1-L7 adaptation | 本地质量门禁 + 官方文档核对 | `docs/specs/deepseek-api-compatibility.md` + `docs/specs/execution-contract.md` + `docs/specs/state-evidence.md` + `docs/evals/deepseek-coding-harness-eval.md` | PASS；P0 provider semantics、P1 execution/state evidence、P2 registry/eval design 已落地；root `pnpm test` / `pnpm typecheck` / `pnpm lint` 全部通过 |
| `rh-test-dashboard-version` 定向 N=3 复审 | Benchmark（1 fixture × card_on/off × 3 reps） | `docs/reports/runlogs/260517133604-pie-replicated/` | card_on 0/3、card_off 0/3。1 次进入 patch/repair 但 Maven compile fail，5 次 PLAN 缺 `<FILES>`。2026-05-18 有效性审计后归类为 high-variance fixture（见 §1） |
| `rh-test-dashboard-version` fixture 有效性审计 | 仓库源码核对 + runner 清理逻辑核对 + 单跑证据复核 | 本台账 §1（2026-05-18 条目）+ `packages/eval/src/failure-matrix.json` | fixture 有效、无设计缺陷、无状态泄漏、任务可解；N=3 不稳定源于模型输出方差；归类为 `high_variance`，反应式补丁已回退 |

## 4. 进行中事项

| 事项 | 当前状态 | 阻塞点 | 下一步 |
|------|---------|--------|--------|
| Phase 3 failure matrix | 已结构化 | `packages/eval/src/failure-matrix.json` 已建立，含 `governance.comparabilityRisk` / `evidencePolicy` 标记；replicated benchmark metadata 已写入 `failureMatrixSummary` 和本次 fixture 的 `failureMatrixFixtures` 治理标注；`summary.md` 报告从 metadata 消费治理标注 | 后续 Phase 3 benchmark 复审必须保留 evidencePolicy 标签，不重新拼散落 Markdown 报告 |
| hard-fail fixture 根因分析 | 部分闭环 | `pi-bugfix-count-defs` partial replicated on/off 各 3/3 PASS 但历史 evidence 需按污染治理重新标注；`rh-test-dashboard-version` 已闭环——2026-05-18 审计确认 fixture 有效、失败为模型输出方差，归类 high-variance；`rh-refactor-branch-orchestrator` 5 个小 fixture 仍待 N=3 且需标注 scope reshaping | 不再为 `rh-test-dashboard-version` 单独打补丁；如要提升其通过率，走「多文件 CREATE 完整性 + Java 编译错误 repair」通用能力 spec 并跨 Java fixture 验证；其余 fixture 按污染治理重新标注 |
| Benchmark fixture 标准与 contamination audit | 已标准化并自动化 | `docs/specs/benchmark-fixture-standard.md` 是新增/修改 fixture 的 canonical 标准；`docs/reports/knowledge/20260517-fixture-contamination-audit.md` 确认 53 个 current fixture 中 0 个 remaining strict contamination risk、6 个 scope reshaping / comparability risk；`packages/eval/src/fixture-audit.ts` 已锁定自动审计；新增 expectedFiles verification coverage audit，四批补充 25 个 fixture 的结构化断言后，当前 baseline 为 0/53 fixture、0 条候选缺口 | 不把 fixture-specific answer hints 当作能力修复；历史污染 evidence 不进入 Phase 3 exit evidence；后续 fixture 修改必须保持审计为 0 gap |
| 最小 `dsh run` | 已补 CLI 入口 | core 已有 `runFullPipeline`，CLI 已提供一键入口 | 继续通过 CLI 测试和真实 dry-run/smoke 验证输出体验 |
| Phase 3 收口证据台账 | 已更新 | commit `454f731` + `docs/reports/knowledge/20260517-phase3-closeout-review.md` + `docs/reports/runlogs/260517133604-pie-replicated/` | `rh-test-dashboard-version` blocker 已闭环（2026-05-18 归类 high-variance，不作硬门禁）；Phase 3 退出待一次最新 N=3 replicated 确认聚合 testsPassed >60% |

## 5. 已废弃事项

| 事项 | 废弃原因 | 决策证据 | 是否有残留 |
|------|---------|---------|-----------|
| superpowers/ 目录结构 | 重构为 docs/ 目录 | commit `c86e790` | 否 |

## 6. 当前 Top Priority

| 优先级 | 事项 | 原因 | 验收标准 |
|--------|------|------|---------|
| P0 | Benchmark contamination 清理 | strict prompt contamination 已清理为 0；`rh-refactor-branch-orchestrator-*` 拆分 fixture 与 `rh-test-dashboard-version` 已在 failure matrix 机器可读标注 scope reshaping / comparability risk；replicated benchmark metadata 和 `summary.md` 已读取并写出 evidencePolicy | 后续 benchmark 复审必须保留 evidencePolicy；历史污染 evidence 不进入 Phase 3 exit evidence |
| P1 | `rh-refactor-branch-orchestrator` 拆分后 N=3 复审 | 原 single fixture 在干净 runner 下仍 PARTIAL (`260515-024737`，30 rounds / 0 changes)，已拆为 5 个小 fixture；create/tests/release/code-merge/attach 已全部 single PASS，attach 最新 `260515-044458` PASS | 下次 replicated benchmark 确认 5 个小 fixture 稳定，不恢复 monolith |
| P2 | `rh-test-dashboard-version` 已归类 high-variance（不再是 blocker） | 2026-05-18 有效性审计确认 fixture 有效、失败为模型输出方差；failure matrix 已标 `high_variance`，反应式补丁已回退 | 不再为该 fixture 单独打补丁；如要系统提升 Java 测试 CREATE 通过率，立「多文件 CREATE 完整性 + Java 编译错误 repair」通用 spec，跨 Java fixture 验证 |
| P1 | `pi-bugfix-count-defs` semantic failure 复审 | 已修正 fixture source-context hint 并 single smoke PASS (`260515-015045`)；等待下一轮 N=3/全量确认稳定性 | 下次 replicated benchmark 不再 0/6；pytest 定向验证持续通过 |

## 7. 关键证据索引

| 证据 | 路径 | 说明 |
|------|------|------|
| 项目宪法 | `CONSTITUTION.md` | 5 项核心原则 + 3 条 AI 规则 + 3 项技术原则（含原则 8 跟踪事项治理） |
| 产品蓝图 | `BLUEPRINT.md` | 7 阶段演进 + Phase 2 退出条件 |
| 任务规范 | `docs/TASK-SPEC.md` | 任务格式、生命周期、三层体系 |
| 最新全量 Benchmark | `docs/reports/runlogs/260509-165142/` | 24 fixtures, parallel=3, 2087s, testsPassed 11/24 (45%) |
| 最新 replicated Benchmark | `docs/reports/knowledge/20260514-pie-phase2-3-baseline.md` | N=3 randomized hard cleanup；Project Card on 60/72 (83.3%) |
| 最新 targeted replicated Benchmark | `docs/reports/runlogs/260517133604-pie-replicated/` | `rh-test-dashboard-version` N=3；card_on 0/3、card_off 0/3。2026-05-18 已归类 high-variance fixture（见 §1） |
| Phase 3 Failure Matrix | `docs/reports/knowledge/20260514-phase3-failure-matrix.md` + `packages/eval/src/failure-matrix.json` | hard-fail / high-variance fixture 分类与下一轮修复顺序；JSON 含 comparability risk / evidence policy |
| Benchmark Fixture Standard | `docs/specs/benchmark-fixture-standard.md` | 新增/修改 benchmark fixture 的 canonical 标准；汇总 schema、prompt、verification、protocol ops、isolation、contamination/comparability policy |
| Fixture Contamination Audit | `docs/reports/knowledge/20260517-fixture-contamination-audit.md` | 53 个 current fixture 审计；0 个 remaining strict contamination risk，6 个 scope reshaping / comparability risk；`pi-bugfix-count-defs` answer leakage 与 attach protocol coaching 已 neutralized |
| 最新 smoke Benchmark | `docs/reports/runlogs/260512-225408/` + `docs/reports/runlogs/260513-013656/` | loam PASS；rh PASS，repairSuccess 1/1 |
| rh Debug Benchmark | `docs/reports/runlogs/260509-174358/` + `260509-181614/` | rh 9 fixtures, mvn clean compile→mvn install 修复 NoSuchMethodError |
| 决策知识库 | `docs/reports/knowledge/` | Phase 退出审查、session 总结、benchmark 分析报告、对比报告（提交到 Git） |
| Benchmark 运行产物 | `docs/reports/runlogs/260*-*/` | 机器生成的运行报告（.gitignore，本地保留不提交） |
| 对比报告 | `docs/reports/knowledge/dsh-vs-opencode-comparison.md` | DSH vs OpenCode |
| mini-cc 对比结论 | 本台账 §8 `dsh-vs-mini-cc-comparison` | 与 `you-want/mini-cc` 的架构/能力对比：mini-cc 更像交互式 Claude Code 教学复刻，dsh 更像 DeepSeek-native verify-first coding harness |
| 工具系统 Spec | `docs/specs/2026-05-04-tool-system.md` | 工具系统完整设计 |
| 工具采纳修复 Spec | `docs/specs/2026-05-04-tool-adoption-fix.md` | 本次修复设计 |
| 核心源码 | `packages/core/src/` | pipeline, patch-parser, repair-loop, tools |
| CLI 源码 | `packages/cli/src/` | init/plan/patch/verify/repair/handoff/doctor/run |
| Provider 源码 | `packages/provider/src/` | DeepSeek API 客户端 |
| DeepSeek API Compatibility | `docs/specs/deepseek-api-compatibility.md` | official endpoint、thinking、usage/cache、retry、tool policy、高级能力扩展点支持矩阵 |
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
| evidence | dsh-vs-mini-cc-comparison | repo:https://github.com/you-want/mini-cc | DSH vs mini-cc 架构/能力对比 | 已完成（2026-05-16）：mini-cc 是轻量交互式 coding agent / Claude Code 教学复刻，强在 Ink TUI、流式交互、Anthropic/OpenAI-compatible provider、ToolUseContext、MCP bridge 和 onboarding；dsh 是 DeepSeek-native verify-first harness，强在 Plan→Patch→Verify→Repair→Handoff、结构化 task-state、XML patch protocol、verify assertions、repair/static scan 和 benchmark evidence。结论：dsh 应借鉴 UX、provider/tool 抽象、config/health fast-path、MCP 预留；不应借鉴整文件覆盖式 FileWriteTool 或弱验证自由 agent 模式 | P2 | resolved | 2026-05-16 |
| debt | dsh-ux-onboarding-mini-cc-lessons | report:docs/project-ledger.md | 借鉴 mini-cc 改善 dsh CLI 运行体验与 onboarding | 增加交互式 API key/config 设置、`dsh --health`/`dsh config get/set`、`dsh run` 阶段进度/patch round/verify 状态的实时输出；验收以不削弱 headless/benchmark 可审计输出为前提 | P2 | waiting | 2026-05-16 |
| debt | dsh-tool-provider-abstraction-mini-cc-lessons | report:docs/project-ledger.md | 借鉴 mini-cc 的 provider/tool registry 抽象，但保留 dsh patch 安全边界 | 抽出稳定 `ModelProvider` 接口和工具 registry + `ToolContext`；文件修改仍必须走 dsh XML change block / patch parser，不引入模型直接整文件覆盖写入作为主路径 | P2 | waiting | 2026-05-16 |
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
| deferred | verify-protocol-structured | spec:docs/specs/2026-05-08-verify-protocol-structured.md | verify 命令从 shell string 升级为结构化断言（file_exists / file_not_exists / file_contains / file_not_contains / shell 等） | resolved：议题 B P1-P6 已实施；2026-05-18 追加迁移剩余简单 shell 文件断言到 `verifications`，并新增真实 fixture 防回流测试，保留测试运行器类命令为 shell | P1 | resolved | 2026-05-18 |
| evidence | patch-completeness-baseline | spec:docs/specs/2026-05-07-patch-completeness.md | rh-mixed-dashboard 3 次重跑 + 24 fixture 全量 benchmark vs 260506-004042 基线对比 | 3 次单 fixture（260507-235439/260508-000202/260508-000642，plan.files 覆盖率 0/3→2/3）+ 24 fixture 全量（docs/reports/knowledge/260508-24-fixture-benchmark-analysis.md）已完成；P1-P4 净效应正向（2 false-positive 修正 + 1 副作用 + 1 偶发） | P1 | resolved | 2026-05-08 |
| evidence | fixture-false-positive-audit | report:docs/reports/knowledge/260508-24-fixture-benchmark-analysis.md | 全量审计 fixture 的 verification commands / structured assertions 是否对所有 expectedFiles 做显式断言；列出 false-positive 候选 + 修正建议 | 已新增机器审计 `auditFixturesForVerificationCoverage`；四批迁移 25 个 fixture 到结构化断言；当前 baseline：53 fixture 中 0 个存在 expectedFiles 未显式验证候选；`rh-test-dashboard-version` 已不在缺口列表 | P1 | resolved | 2026-05-17 |
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
| debt | pipeline-console-log | code:packages/core/src/pipeline.ts:452 | console.log 工具调用诊断输出应升级为结构化日志（debug/verbose flag 控制），避免污染 CLI TTY 输出 | resolved：核心默认路径已移除临时 stdout/stderr 诊断输出；tool call 诊断保留在 `patch_rounds.tool_calls`，SEARCH_REPLACE 失败诊断保留在结构化 error 字段，repair rollback 原因保留在 patch record；已补回归测试防止工具轮、SEARCH_REPLACE 失败、repair rollback 污染终端输出 | P3 | resolved | 2026-05-15 |
| deferred | pie-phase2-tier2-doctor-card | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | PIE Phase 2 Tier 2：`dsh doctor` 命令 + `toProjectCard` 注入 LLM prompt | superseded by 本 spec v1.1（§3.6 覆盖：dsh doctor 命令 + context-builder 注入 Project Card） | P2 | cancelled | 2026-05-13 |
| deferred | pie-phase2-tier3-project-yml | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | PIE Phase 2 Tier 3：`.dsh/project.yml` 人工确认层 | superseded by 本 spec v1.1（§3.7 覆盖：ProjectYml zod schema + assembleIntelligence override 集成） | P3 | cancelled | 2026-05-13 |
| debt | runtime-path-resolution-ctxdirs | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | `repair-loop.ts:211` + `failure-detector.ts:559` 的 `["/backend/", "/frontend/", "/src/", ...]` ctxDirs 字面量：路径归一化时缺 project layout source of truth，被迫硬编码 | superseded by 本 spec v1.1（§3.8 覆盖：两函数接收 moduleRoots 参数，由 ProjectIntelligence 投影传入；字面量删除） | P2 | cancelled | 2026-05-13 |
| debt | canonical-module-wiring-rule | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | spec 模板 / CONSTITUTION 原则 5 展开：新模块取代旧模块时，Phase 完成验收必须含「调用方迁移率 = 100% AND 旧 API 物理删除」硬条目 | resolved：`CONSTITUTION.md` v1.2 原则 5 已加入 canonical wiring 规则；`docs/specs/_template.md` §5.4 已加入可复制验收清单，要求生产调用点 100% 迁移、legacy API 删除或登记退出条件、顶层 wiring 指向 canonical 入口 | P2 | resolved | 2026-05-15 |
| evidence | pie-phase2-tier1-baseline-comparison | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | 本 spec Step 6 完成时收集：24 fixture full benchmark vs 基线 260508-003359 / 260513-013656；context-builder.buildRepoContext 在 ≥3 fixture（TS/Python/Java+Vue）的字符级 diff 为空 | superseded by pie-phase2-3-baseline-comparison（id 反映 v1.1 扩张后的范围） | P1 | cancelled | 2026-05-13 |
| evidence | pie-phase2-3-baseline-comparison | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | 本 spec Step 12 完成时收集：24 fixture full benchmark vs 基线 260508-003359 / 260513-013656；context-builder.buildRepoContext 在 3 个代表性 fixture（TS/Python/Java+Vue）的字符级 diff 除 Project Card 新章节外零回归 | ✅ 已完成 (2026-05-14): N=3 randomized A/B with hard cleanup (260514020257-pie-replicated)；144 trials；Card on 60/72 (83.3%) > Card off 53/72 (73.6%)；累积 +37.5pp vs baseline 11/24 (45.8%)；归因分解 PIE+并发 +21pp, hard cleanup +12pp, Card 注入 +5pp。完整报告 docs/reports/knowledge/20260514-pie-phase2-3-baseline.md | P1 | resolved | 2026-05-14 |
| debt | benchmark-spec-threshold-revision | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | resolved：PIE spec v1.2 已修订 §5.2，废弃 deterministic `testsPassed ±2` 阈值，改为 N≥3 replication + hard cleanup + 总通过数不低于 baseline + 单 fixture Wilson 95% CI 退化判定；高方差 fixture 单独标注 | 已处理：`docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md` v1.2 | P1 | resolved | 2026-05-15 |
| debt | blueprint-evaluation-methodology-v1.1 | code:BLUEPRINT.md | resolved：BLUEPRINT §2.5 已加入 Phase 2.5 严肃实证方法论，明确 N≥3 randomized A/B、hard cleanup、Wilson 95% CI、高方差 fixture 标注和报告归档要求 | 已处理：`BLUEPRINT.md` §2.5 v1.1 方法论 | P1 | resolved | 2026-05-15 |
| bug | benchmark-hardfail-fixtures-3x | report:docs/reports/knowledge/20260514-pie-phase2-3-baseline.md | 3 个 fixture 在 N=3 hard cleanup × Card on/off 6 次跑全 FAIL: pi-bugfix-count-defs / rh-refactor-branch-orchestrator / rh-test-dashboard-version。进展：`rh-test-dashboard-version` 2026-05-18 审计结论为 fixture 有效 + 模型输出方差（归类 high-variance）；`rh-refactor-branch-orchestrator` 已拆为 5 个小 fixture；`pi-bugfix-count-defs` 已修 fixture hint | 剩余每个 fixture 单独复审；不再用单 fixture 打补丁，能力提升走通用 spec | P2 | in_progress | 2026-05-18 |
| bug | rh-test-dashboard-version-maven-verify | report:docs/reports/knowledge/20260514-phase3-failure-matrix.md | `rh-test-dashboard-version` 在 replicated benchmark 中 0/6；根因确认是 `-am` + `-DfailIfNoTests=true` 触发 upstream no-tests 误伤。已改为结构化 `maven_test`，保留 `-am` 但不设置 `failIfNoTests=true`；single smoke `260515-013524` PASS，testsPassed=true，repairSuccess=true | 下次 N=3/全量 benchmark 复审稳定性 | P0 | resolved | 2026-05-15 |
| bug | plan-tool-limit-hard-fail | report:docs/reports/runlogs/260517132848-pie-replicated | `rh-test-dashboard-version` targeted N=3 首跑 6/6 均在 PLAN 阶段失败，原因是 plan read-only tools 达到 5 轮后直接抛 `plan tool rounds exceeded 5`，未给模型输出最终 PLAN 的机会 | resolved：plan 阶段只读工具超过 5 轮后暂停工具注入并要求输出最终 PLAN；已补 core 测试，`pnpm run scan` PASS | P0 | resolved | 2026-05-17 |
| bug | rh-test-dashboard-version-replicated-regression | report:docs/reports/runlogs/260517133604-pie-replicated | cancelled：本条目把该 fixture 框定为「可修的 regression」，但 2026-05-18 有效性审计推翻了这一框定——fixture 有效、无设计缺陷、无状态泄漏、任务可解，N=3 不稳定是模型输出方差。已重新归类为 high-variance，由 failure-matrix `high_variance` 条目 + `benchmark-hardfail-fixtures-3x` 跟踪；为该 fixture 反应式打的补丁已全部回退 | superseded by high-variance 归类 | P0 | cancelled | 2026-05-18 |
| bug | rh-refactor-branch-orchestrator-patch-apply | report:docs/reports/knowledge/20260514-phase3-failure-matrix.md | 原 monolith clean rerun `260515-024737` 仍 PARTIAL：30 rounds / 0 changes。已删除原 fixture 并拆为 create / tests / service-code-merge / service-release-branch / service-attach：create PASS (`260515-025747`), tests PASS (`260515-025747`), release PASS (`260515-031851`), code-merge PASS after expectedFiles fix (`260515-035901`, repairSuccess 1/1), attach PASS after SEARCH/REPLACE safety + fixture constraints (`260515-044458`, repairSuccess 1/1). 同时修 benchmark runner：每个 fixture 开始时清空 worktree `.dsh`，避免旧 assertions 泄漏。 | 原 hard-fail 已拆解；下次 N=3/全量复审稳定性，不恢复 monolith | P1 | resolved | 2026-05-15 |
| bug | pi-bugfix-count-defs-semantic | report:docs/reports/knowledge/20260514-phase3-failure-matrix.md | `pi-bugfix-count-defs` 根因确认是 fixture 提示错误：真实 infra definitions 包含缩进类方法，`^def` 第 0 列匹配会漏计。已改为 `^\s*` source-context hint；single smoke `260515-015045` PASS，testsPassed=true | 下次 N=3/全量 benchmark 复审稳定性 | P1 | resolved | 2026-05-15 |
| debt | benchmark-wallclock-optimization | code:scripts/benchmark-pie-replicated.ts | 144 trial 跑了 18.8 hr 挂钟（vs 估算 5-6 hr），parallel 利用率 < 33%。优化方向：LPT 调度 + fixture-level parallel（同 repo 内 fixture 互不冲突时可并行）+ outlier 时长上限 | resolved：replicated benchmark 脚本已支持 `--lanes-per-repo=N`，为同一 repo 建独立 git worktree lane，并用历史 `results.json` 平均耗时做 LPT 分桶；默认仍为 1 lane 保持保守行为。需要共享 Maven 本地仓库清理的 repo 保持单 lane，避免并发删除 artifact 造成 flaky。已补脚本级测试覆盖 duration estimate 读取与 LPT 调度 | P3 | resolved | 2026-05-15 |
| evidence | replicated-benchmark-260515064739 | report:docs/reports/runlogs/260515064739-pie-replicated | 28 fixture × 3 reps × card_on/off 全量 replicated benchmark（`--lanes-per-repo=2`，release-hub 强制单 lane） | 完成：168 trials，Card ON 70/84 (83.3%)，Card OFF 64/84 (76.2%)，总计 134/168 (79.8%)。结论：Card 注入有 +6/84、约 +7.1pp 正向收益，但主要瓶颈集中在少数复杂 fixture（rh-bugfix-csv-export 1/6、loam-refactor-rename-distill-state 1/6、rh-refactor-branch-orchestrator-service-attach 2/6、loam-bugfix-cli-error-handling 2/6、rh-test-dashboard-version 2/6）；下一步应修失败簇，不继续扩大样本 | P1 | resolved | 2026-05-15 |
| deferred | verify-plan-model-enhancement | spec:docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md | §7.3 中显式排除的剩余范围：多模块独立 verify plan、test selectivity 等 verify 模型增强；本 spec 只做 cli/init 写 config 时的 capabilities → VerifyCommands 投影 | benchmark 数据揭示 verify plan 在多模块项目 / test selectivity 场景出现需求时启动 | P3 | waiting | 2026-05-13 |
| debt | tracked-items-resolved-path-check | spec:docs/specs/2026-05-05-tracked-items-governance.md | resolved：治理 spec v1.1 已明确 `source` 字段语义：active 条目必须保持路径存在；status=resolved/cancelled 后 source 是历史指针，CI 不再校验路径存在。脚本既有跳过逻辑已补回归测试 | 已处理：`docs/specs/2026-05-05-tracked-items-governance.md` v1.1 + `scripts/check-tracked-items.test.ts` | P3 | resolved | 2026-05-15 |
| debt | phase2-exit-fixture-doc-lag | spec:docs/specs/2026-05-06-phase2-exit-fixtures.md | doc-lag 回补：commit `f97aae3` 实施时按"单侧成对 fixture"拆 rh 混合 (3 个设计→6 个实施 yaml)，但 spec §3.3 第 2 条/§3.5/§4.6 没同步；BLUEPRINT Phase 2 退出条件"Java+Vue 混合 ≥3" 按旧 §3.3 定义不达成（0/3 双侧），按 v0.6 新定义达成 (3 pair)。**已修**: spec v0.6 (2026-05-14) 扩展 §3.3 第 2 条，新增"单侧成对"作为合法实施选项 + 计数规则；未来类似 mid-implementation 偏离 spec 时，应在同 commit 更新 spec 而不是延迟 8 天才回补 | spec 治理流程: 任何 commit 实施偏离设计 spec 时，必须在同 commit 更新 spec 或加 ledger debt | P2 | waiting | 2026-05-14 |
| debt | benchmark-fixture-contamination-audit | report:docs/reports/knowledge/20260517-fixture-contamination-audit.md | Benchmark fixture 污染治理：严禁把 failure-specific answer hints / DSH patch workaround 写入通用 fixture 任务提示 | 已新增 canonical fixture standard、fixture prompt audit rule；`pi-bugfix-count-defs` answer leakage 与 `rh-refactor-branch-orchestrator-service-attach` protocol coaching 已 neutralized；scope reshaping / comparability risk 已写入 failure matrix governance metadata，且测试校验 audit 与 matrix 对齐 | P0 | in_progress | 2026-05-17 |
