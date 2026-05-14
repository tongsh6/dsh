# DSH Phase 3 Benchmark Failure Matrix

> 日期: 2026-05-14 | 状态: active | 数据集: `docs/reports/runlogs/260514020257-pie-replicated/results.json`
>
> 目的: 用 replicated benchmark 证据约束 Phase 3 后续修复顺序，避免在没有复现和失败分类的情况下泛化改 prompt 或扩展外围能力。

## 1. Baseline

| 项 | 数据 |
|---|---|
| Phase 3 起点 baseline | testsPassed `11/24 = 45%` (`260508-003359` / `260509-165142`) |
| Phase 3 目标 | testsPassed `>60%`，最低等价 `15/24` |
| 最新 replicated evidence | Project Card on `60/72 = 83.3%`，24 fixtures × 3 reps |
| 对照组 | Project Card off `53/72 = 73.6%` |
| 当前判定 | Project Card on 已超过 Phase 3 目标；仍需调查 3 个 hard-fail fixture 和 5 个高方差 fixture |

## 2. Failure Matrix

| fixture | repo | 当前结果 | 失败类型 | 根因 | 修复策略 | 预计收益 | 修复后结果 |
|---|---|---|---|---|---|---|---|
| `pi-bugfix-count-defs` | `pi-proof-forge` | on 0/3, off 0/3 | `semantic_incorrect` | fixture 原提示要求 `^def` 第 0 列匹配，但真实 expected definitions 中 `post_json` / `extract_content` 是类方法，前面有缩进；模型按提示实现会漏计 | 已把 fixture source-context hint 改为 `^\s*` 可缩进匹配，并说明类方法边界 | +1 fixture | ✅ single smoke PASS `docs/reports/runlogs/260515-015045` |
| `rh-refactor-branch-orchestrator` | `release-hub` | on 0/3, off 0/3 | `patch_apply_failure` | single smoke `260515-015346` 仍 PARTIAL：30 patch rounds 全是 tool calls、0 change；模型还多次向 `read_file` 传 `offset/limit`，旧工具忽略该参数导致整文件重复读和上下文膨胀 | 已补 protocol-tool misuse guidance、初始调研过长后暂停工具、暂停后拒绝 tool_calls、`read_file(offset, limit)`；仍需重跑或拆 fixture | +1 fixture | partial mitigation；single smoke 仍 PARTIAL `docs/reports/runlogs/260515-015346` |
| `rh-test-dashboard-version` | `release-hub` | on 0/3, off 0/3 | `wrong_verification_command` | 文件创建断言通过，但 Maven 命令 `cd backend && mvn test -pl releasehub-application -am -Dtest="DashboardAppServiceTest,VersionUpdateAppServiceTest" -q -DfailIfNoTests=true` 失败，确认是 `-am` 触发上游模块 no-tests 误伤 | 已改为结构化 `maven_test`，保留 `-am` 但移除 `-DfailIfNoTests=true`，使用 `-Dsurefire.failIfNoSpecifiedTests=false` | +1 fixture | ✅ single smoke PASS `docs/reports/runlogs/260515-013524` |
| `loam-refactor-rename-distill-state` | `loamlog` | on 1/3, off 0/3 | `patch_apply_failure` | 高方差，常见 empty / failed patch 或 rename 任务补丁不稳定 | 分析失败 patch turn；只在模式稳定时补 rename-specific guard | 稳定性 +1 | pending |
| `loam-bugfix-cli-error-handling` | `loamlog` | on 2/3, off 2/3 | `semantic_incorrect` | 高方差，部分语义修复后 verify 仍失败 | 复盘共同 verify output；只有重复模式明确才加 detector 或 hint | 稳定性 | pending |
| `rh-bugfix-csv-export` | `release-hub` | on 3/3, off 0/3 | `context_missing` | Project Card on 有决定性优势；off 组失败说明上下文识别是关键变量 | 保持 Project Card 默认开启；不作为当前 blocker 修 | 已兑现 +3/3 on | accepted |
| `loam-refactor-provider-dedup` | `loamlog` | on 3/3, off 2/3 | `context_missing` | Project Card on 提升稳定性 | 保持 Project Card 默认开启 | 无需立即修 | accepted |
| `loam-refactor-reorganize-tests` | `loamlog` | on 3/3, off 2/3 | `context_missing` | Project Card on 提升稳定性 | 保持 Project Card 默认开启 | 无需立即修 | accepted |
| `rh-mixed-remove-starter-ping-demo-frontend` | `release-hub` | on 3/3, off 2/3 | `context_missing` | Project Card on 提升稳定性 | 保持 Project Card 默认开启 | 无需立即修 | accepted |

## 3. Top Failure Types

1. `patch_apply_failure`: hard-fail / 高方差 fixture 的最高杠杆类型，常见表现是 empty patch、failed patch 或多文件 refactor 只改一部分文件。
2. `wrong_verification_command`: `rh-test-dashboard-version` 是明确 Maven verify blocker，应优先做 targeted fix。
3. `semantic_incorrect`: `pi-bugfix-count-defs` 需要单 fixture 复现后再修，不做泛化 prompt 改写。
4. `context_missing`: Project Card on 已证明有效，当前策略是保持默认开启，而不是继续扩展外围能力。

## 4. Benchmark 前后对比

| 口径 | 修复前 | 修复后 |
|---|---|---|
| Phase 3 起点 | `11/24 = 45%` | not rerun in this task |
| 最新 replicated Project Card on | `60/72 = 83.3%`，约等价 `20/24` | not rerun in this task |
| hard-fail fixture | 3 个：`pi-bugfix-count-defs`、`rh-refactor-branch-orchestrator`、`rh-test-dashboard-version` | pending targeted rerun |

本报告仅建立 failure matrix；未修改 benchmark fixture 或 repair-loop 行为，因此没有触发新的 benchmark 结果声明。

## 5. Transactional Self-Correction P1 Evidence

| 证据 | 状态 |
|---|---|
| Local unit tests | `pnpm --filter @dsh/core run test` 已在本轮前序修复中通过 |
| Existing smoke evidence | `docs/reports/runlogs/260512-225408/` 和 `docs/reports/runlogs/260513-013656/` |
| 已知能力 | patch / repair checkpoint、managed files、rollback 标记、`done_with_no_changes` guard、`stuck-on-error` hint |
| 剩余证据缺口 | `stuck-on-error` 注入需要本地单测显式覆盖；full 24-fixture repairSuccess 净效应需行为变更后再测 |

## 6. 下一轮最值得修的三类问题

1. `wrong_verification_command`: 先复现并修 `rh-test-dashboard-version`，因为根因最具体、收益清晰。
2. `patch_apply_failure`: 分析 `rh-refactor-branch-orchestrator` 与 `loam-refactor-rename-distill-state` 的 empty/failed patch 共同模式。
3. `semantic_incorrect`: 复现 `pi-bugfix-count-defs`，确认是 fixture hint 缺口还是模型 Python AST 推理上限。
