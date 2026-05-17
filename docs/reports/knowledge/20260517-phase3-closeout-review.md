# DSH Phase 3 收口执行报告

## 1. 本次执行摘要

本轮完成 README / BLUEPRINT / project-ledger 状态统一、ProjectIntelligence 语义收紧、legacy scanner 防回流测试、failure matrix JSON 资产化，以及质量门禁验证。full replicated benchmark 已启动但未跑完：为控制成本，在已获得 Phase 3 不可退出的 blocker 证据后中断。

结论：不建议进入 Phase 4。`rh-test-dashboard-version` 的 single smoke PASS 未在 replicated 环境稳定复现。

## 2. README / BLUEPRINT / project-ledger 一致性修正

- README 当前定位统一为 `DeepSeek-native, benchmark-gated, verify-first Coding Harness`。
- 当前阶段统一为 `Phase 3 收口验证期`。
- README 明确 ProjectIntelligence 主路径、Project Card 默认注入、`dsh run` / `dsh doctor` 可用。
- historical `8 of 24 (33%)` 报告已标注为历史单次 run，不作为当前状态。
- 本地检查确认 README / BLUEPRINT / project-ledger / reports 不再出现旧仓库名、历史 8-of-24 当前态、旧命令数量描述、旧 Phase 3 状态。

## 3. ProjectIntelligence 主路径复核

生产路径通过 `assembleIntelligence`、`generateRepoContext`、`pickVerifyPlan`、`toProjectCard` 工作。`packages/repo/src/scanner.ts` 已不存在，`packages/repo/src/index.ts` 不默认暴露旧 scanner API。

## 4. suggest / auto / unknown 边界修正

- `DecisionMode` 明确为 `auto | suggest | unknown | blocked`。
- `suggest` 不再进入 `pickVerifyPlan` 的 Node/Python fallback。
- `toLegacyTechStack` 只有 `auto` 才投影为 legacy fact，并额外携带 decision mode。
- Project Card 明确区分 Known Facts / Inferred Candidates / Unknowns / Capabilities / Forbidden Assumptions / Suggested Probes。

## 5. legacy scanner 防回流处理

新增 `packages/repo/src/legacy-scanner-guard.test.ts`，扫描 `packages/core/src`、`packages/cli/src`、`packages/repo/src` 生产源码，禁止 `detectTechStack` / `detectVerifyCommands` 回流。

## 6. failure matrix 机器可读化

- 新增 `packages/eval/src/failure-matrix.json`。
- 新增 schema / loader / summary：`packages/eval/src/failure-matrix.ts`。
- 新增测试：`packages/eval/src/failure-matrix.test.ts`。
- `run-benchmark.ts` 与 `scripts/benchmark-pie-replicated.ts` metadata 会读取 failure matrix summary。
- `rh-test-dashboard-version` 已按本轮 partial replicated evidence 更新为 `regressed`。

## 7. Benchmark 复审结果

### 7.1 执行命令

```bash
./packages/core/node_modules/.bin/tsx scripts/benchmark-pie-replicated.ts --reps=3 --lanes-per-repo=2
```

### 7.2 原始输出路径

- partial raw output: `docs/reports/runlogs/260517074552-pie-replicated/results.json`
- metadata: `docs/reports/runlogs/260517074552-pie-replicated/metadata.json`

### 7.3 汇总结果

该 run 加载 28 fixtures × 3 reps × 2 configs = 168 trials。为控制成本，在 12/168 trials 后中断。

| 指标 | 本轮 partial |
|---|---:|
| completed trials | 12/168 |
| testsPassed | 10/12 |
| Project Card on | 6/7 |
| Project Card off | 4/5 |
| repairSuccess | 0/2 attempted |
| observed wallclock | 783s |

### 7.4 与上一轮对比

| 指标 | 上一轮结果 | 本轮结果 | 变化 | 判断 |
|---|---:|---:|---:|---|
| testsPassed | on 60/72, off 53/72 | partial 10/12 | 不可直接横比 | full run 未完成 |
| repairSuccess | 未作为主结论 | 0/2 attempted | 不明 | 样本不足 |
| hard-fail count | 3 个 hard-fail 待复审 | 至少 1 个仍回归 | 未闭环 | `rh-test-dashboard-version` 阻塞 |
| high-variance count | 5 个关注项 | 未覆盖完整集合 | 不明 | 需定向 N=3 |
| wallclock | full replicated run | 783s partial | 不可比 | 已中断 |
| Project Card on vs off | on 83.3% vs off 73.6% | on 6/7 vs off 4/5 | 方向仍正向但样本太小 | 不作为新宣称 |

### 7.5 hard-fail / high-variance 分析

- `pi-bugfix-count-defs`: partial replicated on 3/3, off 3/3 PASS，复审信号正向。
- `rh-test-dashboard-version`: partial replicated card_on 0/1、card_off 0/1。card_on 文件创建断言通过，但 Maven 测试因 `VersionUpdateAppServiceTest` NPE 失败；card_off 出现 no-change 失败。该 fixture 阻塞 Phase 3 退出。
- `rh-refactor-branch-orchestrator` 拆分 fixtures 与 loam high-variance 组未完整覆盖。

## 8. Phase 3 退出条件检查

| 条件 | 是否满足 | 证据 | 备注 |
|---|---|---|---|
| ProjectIntelligence 唯一主路径 | 部分满足 | `scanner.ts` 不存在；主路径使用 ProjectIntelligence | 已补 semantic tests |
| README / BLUEPRINT / ledger 状态一致 | 本地满足 | README / BLUEPRINT / project-ledger | GitHub 可见 README 需 push 后复核 |
| 最新 N=3 replicated benchmark 达标 | 未确认 | full run 12/168 后中断 | 不产生新 full 指标 |
| hard-fail smoke 修复经过复审 | 不满足 | `rh-test-dashboard-version` regressed | Phase 3 blocker |
| failure matrix 机器可读 | 满足 | `packages/eval/src/failure-matrix.json` | 有 schema/test |
| legacy scanner 防回流 | 满足 | `legacy-scanner-guard.test.ts` | 生产路径 guard |
| `dsh run` / `dsh doctor` 入口通过测试 | 满足 | CLI tests | `runCommand` / `doctorCommand` covered |
| build / typecheck / lint / test | 满足 | `pnpm run scan` | 通过 |

## 9. 执行过的质量命令

- `pnpm --filter @dsh/repo run test`
- `pnpm --filter @dsh/eval run test`
- `pnpm -r run typecheck`
- `pnpm -r run build`
- `pnpm -r run test`
- `pnpm run scan`
- `./packages/core/node_modules/.bin/tsx scripts/benchmark-pie-replicated.ts --reps=3 --lanes-per-repo=2`（12/168 后中断）

## 10. 当前仍存在的问题

1. `rh-test-dashboard-version` 在 partial replicated 环境回归，single smoke 不能作为稳定证据。
2. full 168 trials 未完成，本轮不能给出新的全量稳定率宣称。
3. orchestrator 拆分 fixtures 与 high-variance loam fixtures 仍需定向 N=3。

## 11. 是否建议进入 Phase 4

不建议。Phase 3 退出条件中的 hard-fail replicated 复审不满足，且本轮没有完成新的 full replicated benchmark。

## 12. 下一轮优先级建议

1. 优先修复 `rh-test-dashboard-version` 的 semantic NPE / no-change 失败模式。
2. 只对 hard-fail / high-variance 集合跑定向 N=3，避免直接消耗 168-trial full run。
3. blocker 收敛后再跑一次 full replicated benchmark，作为 Phase 3 退出判定。
