# 24 Fixture 全量 Benchmark — 分析报告

> 日期: 2026-05-08 | 作者: tongshuanglong | run-id: 260508-003359
>
> 范围: P1-P4 patch-completeness 实施后首份全量 benchmark；24 个 fixture（13 旧 + 11 新）；用于评估 Phase 2 退出条件 + patch-completeness 实证 baseline。

## 1. 数据总览

| 指标 | 数值 | 基线 (260506-004042) | Δ |
|------|------|---------------------|---|
| fixture 数 | 24 | 13 | +11（新 fixture pool） |
| completed | 24/24 (100%) | 13/13 (100%) | 0 |
| testsPassed | 11/24 (45%) | 7/13 (53%) | -8 pp |
| 修复成功率 | 1/14 (7%) | 0/6 (0%) | +7 pp |
| 平均 patch round | 15.5 | — | — |
| done 主动终止率 | 33% | — | — |

均分 79.2，rh 仓库 4/9，pi 4/7，loam 3/8。

## 2. Phase 2 退出条件评估

### 2.1 v0.4 协议操作覆盖率 ✅

按 BLUEPRINT 标准（每种 op ≥3 标注 + ≥1 实测）：

| 操作 | 标注 | 实测 | 达标 |
|------|------|------|------|
| CREATE | 8 | 9 | ✓ |
| PATCH | 10 | 5 | ✓ |
| SEARCH_REPLACE | 4 | 11 | ✓ |
| INSERT | 4 | 2 | ✓ |
| DELETE | 4 | 4 | ✓（首次） |
| RENAME | 4 | 2 | ✓（首次，rh-mixed-rename-* fixture 触发） |

6 种全达标，可勾选。

### 2.2 多语言 ✅

| 仓库 | 语言 | 通过 fixture |
|------|------|-------------|
| pi-proof-forge | Python | 4/7 |
| loamlog | TypeScript | 3/8 |
| release-hub | Java + Vue 混合 | 4/9（前端 TS 3/3、后端 Java 1/3、混合操作 0/3） |

3 仓库 × 各 ≥3 通过，可勾选。

### 2.3 完成率 ⚠️

按 BLUEPRINT 字面（"≥10 fixture 完成率 >60%"）：
- 按 `completed` 字段：24/24 = 100% ✓
- 按严格 `testsPassed`：11/24 = 45% ✗

字段口径未明确。建议在 ledger 里标注两个口径数据，待退出复审决议。

## 3. P1-P4 回归归因（vs 260506-004042 基线）

13 个共有 fixture：
- 回归 (✓→✗): 4 — pi-bugfix-count-defs, pi-refactor-read-text, pi-test-aief-l3, rh-test-dashboard-version
- 改善 (✗→✓): 1 — loam-docs-provider-readme
- 稳定 ✓→✓: 3
- 稳定 ✗→✗: 5

逐个归因（基于 patchRoundActions 的 invalid/done 计数 + filesChanged vs expectedFiles）：

| Fixture | 类别 | 详情 |
|---------|------|------|
| pi-bugfix-count-defs | **A1 偶发** | filesChanged 1 == expectedFiles 1，invalid=0 done=0；new 11 轮就退出（base 30 轮）。patch-completeness 没参与。模型代码生成行为差异（同 commit 多次重跑也会有波动）。 |
| pi-test-aief-l3 | **A2 plan 多列** | filesChanged 1 == expectedFiles 1，但 invalid=3 done=0。说明模型尝试 done 3 次都被 reject — 唯一可能是 `plan.files` 包含了不止 1 个文件（plan 阶段产出多列），patch-completeness 据此循环拒绝 done。模型在 reject 后没产出新 change（filesChanged 仍 1 个），最终被 `MAX_CONSECUTIVE_INVALID=3` 截断 → repair 救不回 |
| pi-refactor-read-text | **B false-positive 修正** | filesChanged 2 ⊊ expectedFiles 3（缺 extract_evidence_llm.py）。base 也是 2 个（同样缺），但 testsPassed=true — base 是 false-positive：旧 verify 命令对漏掉的文件不严格。new 强制 plan.files 全覆盖 → patch_failed → repair 没修对 → 真实失败暴露 |
| rh-test-dashboard-version | **B false-positive 修正** | filesChanged 1 ⊊ expectedFiles 2（缺 VersionUpdateAppServiceTest.java）。base 也是 1 个但 testsPassed=true（同上 false-positive）。new 暴露真实问题 |

**净效应**：
- 2 个回归是修正既有 false-positive（**正向价值**）
- 1 个回归是 plan 多列引发的副作用（pi-test-aief-l3）
- 1 个偶发（pi-bugfix-count-defs）

也就是说：260506-004042 的 7/13 通过率含至少 2 个 false-positive，**真实通过率 5/13 ≈ 38%**。新 24 fixture 的 11/24 = 45% 在严格口径下高于修正后基线。

## 4. 新 fixture（11 个）首次实测

通过 6/11：
- ✓ loam-docs-readme-distill-observability（docs，DELETE 触发）
- ✓ pi-clean-duplicate-matching-report（DELETE 触发）
- ✓ pi-docs-prune-stale-report-reference
- ✓ rh-mixed-dashboard-generated-at-frontend
- ✓ rh-mixed-remove-starter-ping-demo-{backend, frontend}
- ✓ rh-mixed-rename-settings-controller-backend（RENAME 触发，单文件 backend Java rename）

失败 5/11：
- ✗ loam-refactor-rename-distill-state（RENAME 标注但被识别为 SEARCH_REPLACE）
- ✗ loam-refactor-reorganize-tests（多文件 reorganize）
- ✗ rh-mixed-dashboard-generated-at-backend（Java unnamed class 误用，已知）
- ✗ rh-mixed-rename-entity-dialog-frontend（scope violation，多改了 GroupDialog.vue）

混合 fixture 倾斜：rh 后端 Java 难度明显高于前端 TS 与混合操作；这与 rh-mixed-dashboard-generated-at-backend 单 fixture 3 次重跑数据吻合（模型在 Java 编译约束上反复出错）。

## 5. 关键发现

### 5.1 false-positive 全量审计需求

至少 2 个 fixture 在基线就是 false-positive（pi-refactor-read-text、rh-test-dashboard-version）。可能还有其他类似 fixture（plan.files vs verify 命令对应不严格）。需要全量审计 13 旧 fixture 的 verify 命令是否对所有 expectedFiles 都做断言。

### 5.2 plan 阶段产出"多列文件"问题

pi-test-aief-l3 暴露：模型在 plan 阶段产出的 `<FILES>` 块可能包含不实际需要改的文件。在 patch-completeness invariant 下，这导致 done 反复被 reject、模型卡死。

需要决定：
- (a) plan prompt 强化"只列必须改的文件"
- (b) patch-completeness 接受 plan.files 的"软上界"（允许 plan.files 比实际多，只对 expectedFiles 子集做硬约束）

(b) 偏离了 spec §1 "plan.files = 模型计划改的文件" 的契约定义。建议走 (a)。

### 5.3 议题 B 启动条件成立

`verify-protocol-structured` deferred 跟踪事项的 trigger："patch-completeness 上线 ≥1 周 + ≥10 fixture 实测后启动"。本报告已满足 ≥10 fixture 实测条件（24 个）。即可从 waiting 转 ready 并起草议题 B spec。

## 6. 本报告引发的跟踪事项

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
| evidence | fixture-false-positive-audit | 全量审计 13 旧 fixture 的 verification commands 是否对所有 expectedFiles 做断言；列出 false-positive 候选 + 修正建议 | P1 | §5.1；至少 pi-refactor-read-text、rh-test-dashboard-version 已确认 |
| debt | plan-files-overlist | plan prompt 加约束"`<FILES>` 仅列出确实需要修改的文件，不要把要读取/参考的文件列入"；议题 B spec 起草时同步评估 | P2 | §5.2；pi-test-aief-l3 暴露；patch-completeness 副作用 |

## 7. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-08 | v1.0 | 初始报告 |
