# DSH 项目事实台账

> 状态: active | 最后更新: 2026-05-11
>
> 任何新会话 AI 或新人进入项目后，**请先阅读本文件**，以便快速恢复项目状态基线。

## 1. 当前阶段目标

**Phase 3（工具化）**。详见 [BLUEPRINT.md](../BLUEPRINT.md) §3。

### Phase 3 核心演进
- **议题 A (dsh-autonomous-env)**: ✅ P1 已实施，代码已合并（去保姆化 + prompt 增强 + 命令白名单 + repair 扩容 + fixture 验证命令修正）。
- **议题 B (verify-protocol-structured)**: ✅ P1-P6 已实施，结构化验证协议上线。
- **议题 C (goal-driven-verify)**: ✅ P1-P2 已实施，代码已合并（config redaction + autonomous verification prompts + PLAN retry + scope 软化 + DONE 接受放松）。
- **议题 D (transactional-self-correction)**: spec drafted + 2 轮 review 完成，ready for P1 实施。
- **目标**: testsPassed > 60%.

### Phase 2 终态（已退出，归档参考）
- [x] 静态扫描 Phase 2-3（Top N 可解释选择）
- [x] 首份 DSH vs OpenCode 对比报告
- [x] 多仓库（3 repos 各 ≥3 fixture，24 fixture full benchmark `260508-003359`）
- [x] 完成率（双口径：completed 24/24 = 100% ✓；testsPassed 11/24 = 45% 作为 Phase 3 baseline）
- [x] 对比报告（`docs/reports/260506-004042` + 升级版 `docs/reports/260508-003359`）
- [x] v0.4 协议操作覆盖率（6 种全达标）
- [x] 多语言（Python 4/7 ≥3 ✓；TypeScript/loamlog 3/8 ≥3 ✓；rh Java+Vue 混合 4/9 ≥3 ✓）
- [x] 跨工具对比（DSH vs OpenCode，13 fixture 对比完成）
- [x] 长期跟踪事项复审（v1 21 条 + v2 25 条，两轮复审完成）

### Phase 3 起点
- baseline（原始）: testsPassed 11/24 (45%) — `260508-003359`
- baseline（议题 B P6 修正后）: testsPassed 8/24 (33%) — `260508-223235`
- **最新全量**: testsPassed 11/24 (45%) — `260509-165142`（parallel=3, 2087s, 3x 加速）
  - pi: 5/7 (71%), loam: 4/8 (50%), rh: 2/9 (22%)
- **rh debug 后**: 3/9 (33%) — `260509-181614`。NoSuchMethodError 已修（mvn install），剩余 PARTIAL 是模型输出不完整（1/2 files changed）
- 目标: testsPassed >60%
- 议题 B（`verify-protocol-structured`）：✅ P1-P6 已实施完成
- 议题 A+C P1 代码实施：✅ 已完成（commit 待推送）
- 议题 D spec：✅ drafted + reviewed（`docs/specs/2026-05-10-transactional-self-correction.md`）
- 并行 benchmark：✅ `--parallel=N` 已上线（git worktree + semaphore pool）
- 关键 bug 已修：CLOSE_WAIT body 超时、failure-detector regex 无限循环、`.m2` 旧 jar NoSuchMethodError
- ready 议题：`fixture-false-positive-audit`（P1）、`transactional-self-correction` P1（P0）
- 下一步：议题 A+C benchmark 全量验证 → 议题 D P1 实施

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
| 24 fixture 全量 Benchmark（patch-completeness 后） | Benchmark（24 fixtures, 3 repo） | `docs/reports/knowledge/260508-24-fixture-benchmark-analysis.md` | completed 24/24 (100%)，testsPassed 11/24 (45%)；协议覆盖 6/6 达标；多语言 3/3 ≥3 通过 |
| 并行 Benchmark（DONE 接受+补全模式+regex fix） | Benchmark（24 fixtures, parallel=3） | `docs/reports/260509-165142/` | completed 24/24，testsPassed 11/24 (45%)，2087s（3x 加速）；pi 5/7(71%), loam 4/8(50%), rh 2/9(22%)；repair 0/12 |

## 4. 进行中事项

| 事项 | 当前状态 | 阻塞点 | 下一步 |
|------|---------|--------|--------|
| 议题 A+C benchmark 验证 | 🔧 代码已合入，等待 benchmark 全量跑 | 需要跑 rh-* + loam 单 fixture 验证 Agent 自主环境修复 + 自主推导验证命令能力 | 先跑 rh-bugfix-csv-export 单 fixture 验证环境自愈；再跑 loam 验证自主 verify |
| 议题 D (transactional-self-correction) P1 | spec drafted + 2 轮 review 完成 | 需先更新 task doc（采纳 review 反馈），然后起草 plan | 更新 task doc → 起草 plan → 实施双轨快照 + managed_files 追踪 |
| 修复循环成功率提升 | 🔧 已定位但不阻塞 | 全量 `260509-165142`：repairSuccess 0/12。议题 D 的事务回滚是突破 0% 的关键杠杆 | 议题 D P1 实施后重跑 benchmark 验证 |
| rh Java PASS 提升 | 🔧 debug 完成 | rh 2/9(22%)→3/9(33%)。根因已修，剩余 PARTIAL 是模型输出不完整（1/2 files changed） | 议题 A 让 Agent 自主 mvn install 后重跑 rh 全量 |

## 5. 已废弃事项

| 事项 | 废弃原因 | 决策证据 | 是否有残留 |
|------|---------|---------|-----------|
| superpowers/ 目录结构 | 重构为 docs/ 目录 | commit `c86e790` | 否 |

## 6. 当前 Top Priority

| 优先级 | 事项 | 原因 | 验收标准 |
|--------|------|------|---------|
| P0 | 议题 D P1 实施（transactional-self-correction） | repair 成功率当前为 0%（0/12），物理回滚是突破 0% 的关键杠杆。spec 已 review 2 轮，可进入实施 | 双轨快照 + managed_files + 回滚逻辑实现，单元测试通过 |
| P1 | 议题 A+C benchmark 验证 | 代码已合入但未跑 benchmark，需确认 Agent 在无保姆环境下能自主完成环境修复 + 验证推导 | rh + loam 单 fixture 验证通过，testsPassed 无退化 |
| P1 | fixture-false-positive-audit | 13 旧 fixture 验证命令覆盖缺口审计 | 全量审计完成 + false-positive 修正 |
| P2 | rh backend 模型输出完整性 | rh debug 后 3 个 fixture 仍是 PARTIAL，原因是模型只改了 1/2 expected files | rh ≥ 5/9 PASS |

## 7. 关键证据索引

| 证据 | 路径 | 说明 |
|------|------|------|
| 项目宪法 | `CONSTITUTION.md` | 5 项核心原则 + 3 条 AI 规则 + 3 项技术原则（含原则 8 跟踪事项治理） |
| 产品蓝图 | `BLUEPRINT.md` | 7 阶段演进 + Phase 2 退出条件 |
| 任务规范 | `docs/TASK-SPEC.md` | 任务格式、生命周期、三层体系 |
| 最新全量 Benchmark | `docs/reports/260509-165142/` | 24 fixtures, parallel=3, 2087s, testsPassed 11/24 (45%) |
| rh Debug Benchmark | `docs/reports/260509-174358/` + `260509-181614/` | rh 9 fixtures, mvn clean compile→mvn install 修复 NoSuchMethodError |
| 决策知识库 | `docs/reports/knowledge/` | Phase 退出审查、session 总结、benchmark 分析报告、对比报告（提交到 Git） |
| Benchmark 运行产物 | `docs/reports/260*-*/` | 机器生成的运行报告（.gitignore，本地保留不提交） |
| 对比报告 | `docs/reports/knowledge/dsh-vs-opencode-comparison.md` | DSH vs OpenCode |
| 工具系统 Spec | `docs/specs/2026-05-04-tool-system.md` | 工具系统完整设计 |
| 工具采纳修复 Spec | `docs/specs/2026-05-04-tool-adoption-fix.md` | 本次修复设计 |
| 核心源码 | `packages/core/src/` | pipeline, patch-parser, repair-loop, tools |
| CLI 源码 | `packages/cli/src/` | 6 条命令 |
| Provider 源码 | `packages/provider/src/` | DeepSeek API 客户端 |
| Repo 源码 | `packages/repo/src/` | 扫描器、配置加载、文件排序 |
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
| deferred | dsh-autonomous-env | spec:docs/specs/2026-05-10-autonomous-env-verification.md | dsh 自主环境管理与验证推导（剥离保姆层） | ✅ P1 代码实施完成（commit 待推送）。待 benchmark 验证 Agent 自主环境修复能力 | P1 | in_progress | 2026-05-11 |
| deferred | goal-driven-verify | spec:docs/specs/2026-05-10-goal-driven-verification.md | 从指令驱动转向目标驱动的自主验证 | ✅ P1-P2 已实施（config redaction + autonomous verification prompts + PLAN retry + scope 软化 + DONE 接受放松） | P1 | resolved | 2026-05-11 |
| deferred | transactional-self-correction | spec:docs/specs/2026-05-10-transactional-self-correction.md | 事务级回滚与工程一致性审计（双轨快照 + managed_files + 物理回滚） | spec drafted + 2 轮 review 完成，ready for P1 实施 | P0 | ready | 2026-05-11 |
| deferred | patchloop-repair-upgrade | spec:docs/specs/2026-05-05-patch-loop-architecture.md | repair-loop 升级到 v0.4 patch loop 协议 | v0.4 patch loop 上线后跑 ≥10 fixture，repair 表现出与 patch 类似的多文件不完整 | P1 | waiting | 2026-05-06 |
| deferred | patch-loop-stash-rollback | spec:docs/specs/2026-05-05-patch-loop-architecture.md | 事务 rollback / stash-apply（v0.5 优化） | v0.4 patch loop 上线后出现「应用后行号错位」实证 | P3 | waiting | 2026-05-06 |
| bug | exec-shell-redirect | report:docs/reports/260504-185028 | exec_shell 把 `2>&1` 误判为危险 | 修 EXEC_SHELL_BLOCK_PATTERNS：`/>/` 改为 `/{1,2}\s*[^\s&]/` | P3 | resolved | 2026-05-05 |
| bug | multi-file-patch-output-incomplete | report:docs/reports/260504-183633 | patch 阶段多文件任务输出不完整 | P1+P2 部分解决（rounds -23%），但多文件输出仍不稳定 | P1 | waiting | 2026-05-06 |
| debt | tool-args-coerce | code:packages/core/src/pipeline.ts:300 | tool args 写 state 前 string-coerce 临时方案 | schema 放宽为 z.record(z.unknown()) + 全链路改 unknown | P3 | waiting | 2026-05-06 |
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
| evidence | patchloop-e2e-selfhost-260505 | report:docs/reports/260506-004042 | P6.1 自托管 e2e 验证（已 supersede 原始 report） | superseded 13 fixture full benchmark (260506-004042) | P1 | resolved | 2026-05-06 |
| deferred | patchloop-done-prompt-weak | code:packages/core/src/prompt-builder.ts | v0.4 DONE 触发（根因在第 7 条：元认知任务） | P1+P2 pipeline 自动终止已从代码层替代 prompt 方案 | P1 | waiting | 2026-05-06 |
| evidence | patchloop-search-replace-risk-realized | code:packages/core/src/pipeline.ts | SEARCH/REPLACE 行号错位风险已实证 | 长期跟踪；v0.5 考虑 stash-rollback | P2 | waiting | 2026-05-06 |
| evidence | patchloop-p62-first-run | report:docs/reports/260506-024933 | P6.2 首轮结果（已 supersede） | superseded 由后续多次 run（含 P1+P2 验证）替代 | P1 | resolved | 2026-05-06 |
| deferred | verify-protocol-structured | spec:docs/specs/2026-05-07-patch-completeness.md | verify 命令从 shell string 升级为结构化断言（file_contains / exit_code / shell 等） | trigger 已满足（24 fixture 实测于 260508-003359），可起草议题 B spec | P1 | ready | 2026-05-08 |
| evidence | patch-completeness-baseline | spec:docs/specs/2026-05-07-patch-completeness.md | rh-mixed-dashboard 3 次重跑 + 24 fixture 全量 benchmark vs 260506-004042 基线对比 | 3 次单 fixture（260507-235439/260508-000202/260508-000642，plan.files 覆盖率 0/3→2/3）+ 24 fixture 全量（docs/reports/knowledge/260508-24-fixture-benchmark-analysis.md）已完成；P1-P4 净效应正向（2 false-positive 修正 + 1 副作用 + 1 偶发） | P1 | resolved | 2026-05-08 |
| evidence | fixture-false-positive-audit | report:docs/reports/docs/reports/knowledge/260508-24-fixture-benchmark-analysis.md | 全量审计 13 旧 fixture 的 verification commands 是否对所有 expectedFiles 做断言；列出 false-positive 候选 + 修正建议 | 至少 pi-refactor-read-text、rh-test-dashboard-version 已确认 false-positive；其他 fixture 待审计 | P1 | waiting | 2026-05-08 |
| debt | plan-files-overlist | report:docs/reports/docs/reports/knowledge/260508-24-fixture-benchmark-analysis.md | plan prompt 加约束"`<FILES>` 仅列出确实需要修改的文件，不要把要读取/参考的文件列入" | 已实施 (fcfc202)：FILES 格式升级（每个文件+改动描述）+ 规则 3 强化 | P2 | resolved | 2026-05-09 |
| bug | failure-detector-regex-infinite-loop | code:packages/core/src/failure-detector.ts:540 | extractCompilationErrors() regex 无 g 标志导致无限循环（parallel=3 时 pi-bugfix-count-defs 触发） | 已修 (89db5e8)：带 g 标志副本扫描 + 零长度匹配保护 + 回归测试 | P1 | resolved | 2026-05-09 |
| evidence | verify-protocol-structured-baseline | spec:docs/specs/2026-05-08-verify-protocol-structured.md | 议题 B 实施 P6 完成时收集（5 fixture 迁移单跑 + 24 fixture 全量 vs 260508-003359 基线对比） | P6 全量 benchmark 完成（docs/reports/knowledge/260508-verify-structured-benchmark-analysis.md）；原始 7/24 → 修正 8/24（1 实现 bug + 7 采样变异）；4 改善含 rh-mixed-dashboard-generated-at-backend 首次全量通过 | P1 | resolved | 2026-05-09 |
| deferred | verify-assertion-extensions | spec:docs/specs/2026-05-08-verify-protocol-structured.md | 评估是否引入 json_path / regex_named_capture 等扩展断言类型 | 5 个迁移 fixture 实测后，若仍有 ≥3 个 fixture 在 shell_other 类无法表达 | P2 | waiting | 2026-05-08 |
| bug | scanner-java-default-maven | code:packages/repo/src/scanner.ts:237 | detectLanguageByFiles: ≥3 .java 文件 → packageManager="maven"（弱推断伪装成事实） | 已修 (bca15fd): 无 pom.xml/build.gradle 时 packageManager=null | P1 | resolved | 2026-05-09 |
| bug | scanner-py-default-pip | code:packages/repo/src/scanner.ts:220 | detectLanguageByFiles: ≥3 .py 文件 → packageManager="pip"（同上） | 已修 (bca15fd): 无 pyproject.toml/requirements.txt 时 packageManager=null | P1 | resolved | 2026-05-09 |
| bug | scanner-ts-default-npm | code:packages/repo/src/scanner.ts:223 | detectLanguageByFiles: ≥3 .ts 文件 → packageManager="npm"（同上） | 已修 (bca15fd): 无 package.json 时 packageManager=null | P1 | resolved | 2026-05-09 |
| bug | verify-java-fallback-maven | code:packages/repo/src/scanner.ts:295 | detectVerifyCommands: packageManager 非 gradle 即默认 mvn（含 null 情形） | 已修 (bca15fd): packageManager=null 时 test/lint/typecheck/build 全返回 null | P1 | resolved | 2026-05-09 |
| deferred | project-intelligence-phase1 | spec:BLUEPRINT.md | Project Intelligence Engine 第一阶段：新建 intelligence.ts（Fact/Candidate/Decision/Capability 模型 + 工厂函数）+ context-builder 输出 ProjectCard | 已实施 (bca15fd): intelligence.ts + intelligence.test.ts + scanner bug 修复 | P1 | resolved | 2026-05-09 |
| deferred | project-intelligence-phase2 | spec:BLUEPRINT.md | PIE Phase 2：完整 Fact 收集器 + Candidate 排序 + dsh doctor + .dsh/project.yml | Phase 1 上线 + 24 fixture 实证 ≥1 轮后启动 | P2 | waiting | 2026-05-09 |
| bug | provider-body-timeout | code:packages/provider/src/client.ts:211 | res.json() 在代理断连后永久阻塞（CLOSE_WAIT），导致 benchmark 卡死 | 已修 (a430453)：Promise.race body 读取超时保护 | P1 | resolved | 2026-05-09 |
| bug | failure-detector-regex-loop | code:packages/core/src/failure-detector.ts:540 | extractCompilationErrors() regex 无 g 标志导致 CPU 100% 死循环 | 已修 (89db5e8)：带 g 副本 + 零长度保护 + 回归测试 | P1 | resolved | 2026-05-09 |
| bug | benchmark-mvn-stale-jar | code:packages/eval/src/benchmark-runner.ts:241 | mvn compile 只编译到 target/，mvn test -pl <module> 无 -am 从 .m2 加载旧 jar → NoSuchMethodError | 已修 (3b8d00d)：mvn install -DskipTests 发布到 .m2 | P1 | resolved | 2026-05-09 |
| deferred | project-intelligence-phase3 | spec:BLUEPRINT.md | PIE Phase 3：detectVerifyCommands 退役 + scanner 改为 Intelligence 驱动 + verify plan 从 Capability 推导 | Phase 2 上线后启动 | P3 | waiting | 2026-05-09 |
| debt | pipeline-console-log | code:packages/core/src/pipeline.ts:452 | console.log 工具调用诊断输出应升级为结构化日志（debug/verbose flag 控制），避免污染 CLI TTY 输出 | Phase 3 退出时清理所有临时诊断输出 | P3 | waiting | 2026-05-10 |
