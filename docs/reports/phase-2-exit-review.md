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

---

## 5. 复审 v2 (2026-05-08) — 基于 24 fixture 全量数据

> 触发：`docs/reports/260508-003359/` 24 fixture 全量 benchmark + `analysis.md` 归因报告完成。本节追加，原 §1-4 保留作为 v1 历史。

### 5.1 退出条件最终核算

| 退出条件 | 要求 | v1 (13 fixture) | v2 (24 fixture) | 裁决 |
|---------|------|----------------|----------------|:----:|
| **v0.4 协议操作覆盖率** | 6 种各 ≥3 标注 + ≥1 实测 | 4/6（DELETE/RENAME 缺标注+实测） | 6/6 全达标（DELETE 4/4、RENAME 2/4 实测，首次） | ✅ |
| **多语言** | 3 类各 ≥3 通过 | Python 5/5、TS 3/8 ✅；rh Java+Vue 0/0 ❌ | Python 4/7、TS 3/8、rh Java+Vue 4/9 | ✅ |
| **多仓库** | ≥3 repo 各 ≥3 fixture | ✅ | ✅（pi 7、loam 8、rh 9） | ✅ |
| **完成率** | ≥10 fixture >60% | completed 100% | completed 100%；testsPassed 严格口径 45% | ⚠️ 字段口径决议 |
| **静态扫描治理** | Phase 2-3 | ✅ | ✅ | ✅ |
| **跨工具对比** | DSH vs OpenCode ≥5 共同 fixture | 5 fixture 旧数据 | 13 fixture 对比已完成（`oc-motf4q7b/dsh-vs-opencode-comparison.md`） | ✅ |
| **对比报告** | 首份正式 | 260506-004042 ✅ | 升级版 260508-003359 ✅ | ✅ |
| **长期跟踪事项复审** | 本文件 | 已执行 | 本节追加复审 | ✅ |

### 5.2 完成率字段口径决议（待用户裁决）

BLUEPRINT 文字"完成率 >60%"未明确字段。两种解读：

| 口径 | 数据 | 含义 | 优劣 |
|------|------|------|:----:|
| **completed**（pipeline 跑完，无异常） | 24/24 = 100% | DSH 不崩溃、状态机走完 | 宽松；不反映 patch 质量 |
| **testsPassed**（verify 通过） | 11/24 = 45% | 真实交付质量 | 严格；< 60% |

复审建议：
- BLUEPRINT 设计意图按上下文推断更接近 testsPassed（"完成率"伴随 "对比报告"、"协议覆盖率" 等出现，都是质量维度）
- 但若按 testsPassed 严格口径，Phase 2 退出受阻；分析报告已说明 11/24 中含 ≥2 base false-positive 修正后的"真实"数字（13 fixture 真实 5/13 → 24 fixture 严格 11/24，趋势是改善的）
- 可选裁决：
  - **A. 严格口径** → Phase 2 不退出，先做 fixture-false-positive-audit + plan-files-overlist + 模型代码质量改进（议题 C）后重跑
  - **B. 宽松口径** → Phase 2 退出，把质量改进放到 Phase 3 的退出条件里
  - **C. 双口径** → 文档明确两个口径，Phase 2 按 completed 退出，testsPassed 数据作为 baseline 进入 Phase 3

裁决留给用户。AI 不批准 Phase 转阶段（CONSTITUTION 规则 1）。

### 5.3 新跟踪事项（v2 新增 4 条）

| id | type | 状态 | 备注 |
|----|------|:----:|------|
| patch-completeness-baseline | evidence | resolved | 24 fixture 全量已收集 |
| verify-protocol-structured | deferred | **ready** | trigger 已满足；议题 B spec 起草 |
| fixture-false-positive-audit | evidence | waiting | 至少 2 个已确认 false-positive；待全量审 13 旧 fixture |
| plan-files-overlist | debt | waiting | pi-test-aief-l3 暴露，议题 B 同步评估 |

### 5.4 v1 复审项的二次复查（status 变化）

| id | v1 决策 | v2 复查 | 备注 |
|----|---------|---------|------|
| dsh-vs-oc-resample | ready | resolved | OpenCode 13 fixture 对比已在 commit 504b08a 完成 |
| 其他 v1 waiting 项 | — | 维持 waiting | 触发条件未变化 |

### 5.5 复查后 ledger §8 状态（v2 终态）

| 状态 | 数量 |
|------|:----:|
| waiting | 14（v1 13 + v2 新增 2 - dsh-vs-oc-resample 转 resolved -1） |
| ready | 1（verify-protocol-structured） |
| resolved | 9（+3 新增：patch-completeness-baseline / dsh-vs-oc-resample / patchloop-search-replace-risk-realized 维持） |
| cancelled | 1（无变化） |
| **合计** | **25** |

### 5.6 退出建议（待用户决议）

**P1-P4 patch-completeness 实施 + 24 fixture 全量数据后**，Phase 2 退出条件状态：

- 7/8 条件无争议（包括 v0.4 协议覆盖率、多语言、跨工具对比首次满足）
- 1/8（完成率）字段口径待决议（§5.2）

如选 §5.2 B/C 口径，Phase 2 可宣告退出，进入 Phase 3（工具化的实证打磨 + 议题 B verify 协议升级）。

如选 §5.2 A 口径，需先做：
1. fixture-false-positive-audit（清理 base 残留误判）
2. plan-files-overlist 修补（plan prompt 强化）
3. 议题 C（模型 Java 代码质量改进，目前 spec 未起草）

### 5.7 用户决议（2026-05-08）

**口径裁决：C — 双口径**
- Phase 2 退出条件按 `completed=24/24=100%` 满足
- `testsPassed=11/24=45%` 作为 Phase 3 起点 baseline，质量提升纳入 Phase 3 议题
- BLUEPRINT 的"完成率"条文需补注双口径说明

**Phase 转阶段**：Phase 2 → Phase 3 已批准；项目进入 Phase 3「工具化」阶段。

后续动作：
1. ledger §1 当前阶段目标更新为 Phase 3
2. BLUEPRINT.md：Phase 2 标 ✅；§3 阶段表 Phase 3 状态 📋 → 🔧
3. ledger §8 ready 项 verify-protocol-structured 起草 spec（议题 B）
4. fixture-false-positive-audit + plan-files-overlist 进入 Phase 3 work pool
