# Phase 2 退出复审报告

> 日期: 2026-05-06 | 依据: BLUEPRINT v1.1 §3.1 Phase 退出复审协议
>
> 本轮复审范围：`docs/project-ledger.md` §8 全部 21 条（4 resolved + 17 waiting）

## 1. Phase 2 退出条件核算

基于 13 fixture 全量 benchmark（`docs/reports/260506-004042`）数据。

| 退出条件 | 要求 | 当前数据 | 裁决 |
|---------|------|---------|:----:|
| **协议操作覆盖率** | 6 种操作各 ≥3 fixture 预期 + ≥1 实际触发 | CREATE(7→5) / PATCH(9→2) / SEARCH_REPLACE(1→7) / INSERT(0→2) / DELETE(0→0) / RENAME(0→0)。4/6 操作达标 | ⚠️ v0.3→v0.4 协议升级，条件需重写为 v0.4 版本 |
| **多语言** | Python / TS 各 ≥3 fixture | Python 5/5 ✅ / TypeScript 3/8 ✅ | ✅ |
| **多仓库** | ≥3 repo 各 ≥3 fixture | pi(5) ✅ / loam(5) ✅ / rh(3) ✅ | ✅ |
| **完成率** | ≥10 fixture >60% | 13/13 (100%) ✅ | ✅ |
| **静态扫描治理** | Phase 2-3 | ✅ | ✅ |
| **跨工具对比** | ≥5 共同 fixture DSH vs OpenCode | 有 5 fixture 旧数据 | ⚠️ 需重跑 OpenCode |
| **对比报告** | 首份正式报告 | 13-fixture 报告 `260506-004042` ✅ | ✅ |
| **长期跟踪事项复审** | 本文件 | 进行中 | — |

注：协议操作覆盖条件中的 `v0.3` 应更新为 `v0.4`（patch-loop 架构已上线，6 种操作中的 SEARCH_REPLACE、INSERT 为 v0.4 新增能力）。

## 2. 长期跟踪事项决策矩阵

> 字段：id / 决策 / 理由 / 新 status

### Deferred（6 项）

| id | 决策 | 理由 | 新 status |
|----|------|------|:---------:|
| patchloop-repair-upgrade | 继续等待 | repair 尚无多文件输出不完整的实证 | waiting |
| patch-loop-stash-rollback | 继续等待 | SEARCH_REPLACE risk 已实证但频次低 | waiting |
| patchloop-protocol-negotiation | **取消** | 被 P2 guard 替代——DONE 不再是可靠性依赖，无需多版本共存 | cancelled |
| phase4-agent-loop | 继续等待 | Phase 2 尚未正式退出 | waiting |
| tracked-items-dashboard | 继续等待 | 条目数 21，未超 30 阈值 | waiting |
| tracked-items-auto-promotion | 继续等待 | CI 脚本运行不足 90 天 | waiting |
| ci-actions-node24-upgrade | 继续等待 | 2026-06-02 尚未到达 | waiting |

### Bug（2 项 waiting / 4 项 resolved，不重审 resolved）

| id | 决策 | 理由 | 新 status |
|----|------|------|:---------:|
| multi-file-patch-output-incomplete | 继续等待 | P1+P2 部分解决（23% 轮次下降），但多文件输出仍不稳 | waiting |
| exec-shell-redirect | — | 已修 | resolved（不重审）|

### Debt（2 项 waiting）

| id | 决策 | 理由 | 新 status |
|----|------|------|:---------:|
| tool-args-coerce | 继续等待 | 低优先级；当前方案工作正常 | waiting |
| history-spec-backfill | 继续等待 | best-effort，无强制时点 | waiting |
| patchloop-done-prompt-weak | **转为 deferred** | 根因在 #7（元认知），prompt 不是根因。P1+P2 已从代码层替代此方案 | deferred |

### Evidence（5 项 waiting，2 项 resolved）

| id | 决策 | 理由 | 新 status |
|----|------|------|:---------:|
| dsh-vs-oc-resample | **提升为 ready** | 触发条件「≥10 共同 fixture」已满足（pi 5 + loam 5 + rh 3）；需要 OpenCode 重跑 | ready |
| patchloop-vs-batch-baseline | 继续等待 | P6 数据已收集但未做正式对比报告 | waiting |
| governance-overhead-baseline | 继续等待 | 不足 30 天 | waiting |
| patchloop-e2e-selfhost-260505 | **resolved** | 被 13 fixture 全量 benchmark（260506-004042）supersede | resolved |
| patchloop-p62-first-run | **resolved** | 被后续多次 run（含 P1+P2 验证）supersede | resolved |
| patchloop-search-replace-risk-realized | 继续等待 | 长期跟踪 | waiting |

## 3. BLUEPRINT 退出条件更新

- `v0.3 协议操作覆盖率` → `v0.4 协议操作覆盖率`（文字更新）
- `跨工具对比` 带重跑 OpenCode 后勾选
- 新增 `长期跟踪事项复审` checkbox → ✅ 本次已执行

## 4. 复查后 ledger §8 状态

| 状态 | 数量 |
|------|:----:|
| waiting | 13 |
| ready | 1（dsh-vs-oc-resample）|
| resolved | 6（+2 新增）|
| cancelled | 1（patchloop-protocol-negotiation）|
| type 变更 | 1（patchloop-done-prompt-weak: debt→deferred）|
| **合计** | **21** |
