# 会话总结：2026-05-04 → 2026-05-06（审计 → 治理 → 架构 → 全量验证 → 自动终止）

> 类型: session summary | 日期: 2026-05-06 | 涉及 commits: `267c971..02da580`（22 条）
>
> 注意：本文件覆盖两段连续会话，共约 20+ 小时。前段 12 条 commit（审计→治理→架构 plan）见 §2 阶段 A-D。后段 10 条 commit（全量 benchmark → 报告修复 → 根因分析 → P1+P2 自动终止 → allow-list 扩展 → Phase 2 复审）见 §2 阶段 E。
>
> 必读伴生文档：
> - `docs/project-ledger.md` §8 长期跟踪事项（21 行，5 resolved / 1 cancelled / 1 ready / 14 waiting）
> - `CONSTITUTION.md` v1.1（含原则 8）
> - `BLUEPRINT.md` v1.1（含 §3.1 Phase 退出复审协议）
> - `docs/reports/phase-2-exit-review.md`（2026-05-06 Phase 2 退出复审）

---

## 1. 起点

用户运行了一份「项目证据对账审计指令 v2.2」（项目根级提示），要求：
- 不依赖历史会话记忆
- 基于当前项目真实证据建立证据地图、状态台账、Top 3 推进建议
- 不得把已完成 / 已废弃 / 已验证事项误判为未开始

会话进入时仓库有 5 个未提交改动 + 6 个未追踪文件（前一次工作残留）。

## 2. 时间线（4 个阶段）

### 阶段 A：审计 + 诊断闭环（commits 267c971 / f1b0aa6 / 1d68e75）

**输入证据**：
- 最新 benchmark `260504-140432`（run on commit `c86e790`，工具系统**之前**）
- 报告显示工具调用 0 次 → 字面读会得出「da7c554 工具采纳率修复未生效」

**真实诊断链**（详见 `docs/reports/260504-183633/analysis.md`）：

| 探针 | 结论 |
|------|------|
| A `scripts/diagnose-tool-calls.ts` | DeepSeek API + provider 健康 |
| B `scripts/diagnose-real-prompt.ts` | 真实 PATCH_PROMPT 不抑制工具调用 |
| C `scripts/diagnose-realistic-patch.ts` | 完整 user message（含 top-10 文件全文）下模型仍调工具 |
| Disk inspection | task-state.json 实际记录了 5 轮 11 次 tool 调用 |

**Bug 链**：
- **Bug A**：`benchmark-runner.ts` 在 `runPatch` throw 时 catch 块跳过 toolRounds 赋值（→ results.json 误报 0）
- **Bug C**：`task-state.ts` schema 强制 `arguments` 是 `Record<string, string>`，但模型传 `read_file({offset: 580, limit: 60})` 数字字段。zod 静默 fail → readTaskState 返 null → verify/repair/handoff 全部 throw "尚未初始化"

**修复**（commit 267c971）：
- pipeline.ts：tool args 写 state 前 string-coerce（最小改动，schema 不变）
- benchmark-runner.ts：catch 路径从 disk 读 task-state 恢复统计

**验证**（reports 260504-173531 / 183633 / 185028）：3 次 run 数据一致显示 5 轮 12 次 tool 调用、PATCH 协议首次实际触发。

**揭露的真实行为缺口**（Bug B）：模型工具用得对，但 patch 输出阶段不稳——3 次中 1 次出 1/3 文件、2 次空块。这是 patch-loop spec 的根因来源。

### 阶段 B：治理盲点发现 → 治理体系设计 + 实施（commits ffa5acb / 2463504 / 3ec001f / 7ad1341 / 4eceebd）

**触发**：用户提出「随着本次推进结束，没有人或者机制还能唤起本次 spec 里还有遗留的内容需要处理」——指出 spec 的 non-target / future work 没有主动唤起出口。

**决定**：跳过补丁式修法，新建独立治理体系：

| 层 | 产物 |
|----|------|
| 宪法层 | CONSTITUTION v1.1 原则 8「长期跟踪事项可追溯」+ 4 类条目（deferred / bug / debt / evidence）|
| 索引层 | project-ledger.md §8（CLAUDE.md 引导新会话 AI 必读） |
| 复审层 | BLUEPRINT v1.1 §3.1 Phase 退出复审协议（每 Phase 退出强制遍历 ledger §8）|
| CI 层 | scripts/check-tracked-items.ts（~340 行 + 10 测试）|

**4 phase 实施**（G1-G4，全部 commit + push + CI 绿）：
- G1：CONSTITUTION + ledger §8 + BLUEPRINT 退出 checkbox
- G2：spec 模板 + patch-loop spec §9 回填
- G3：CI 脚本 + fence-aware 解析（脚本第一次跑就抓出治理 spec 自身 §8 的 3 条漏登记！）
- G4：scan.yml 集成 + 红绿验证

**治理上线后立即捕获 4 个真实 bug 并自我修复**（commits a8c3ee8 / 9a43c2f / 4f4cbf5 / 4c95a1a）：
- bug-1：scan.yml `branches:[main]` ≠ 项目主分支 `master`（CI 从未在 master push 时触发）
- bug-2：exec_shell `/>/` 误把 `2>&1` 视为危险（fd 复制不是文件写）
- bug-3：CI 上 pnpm/action-setup 缺 packageManager 字段（bug-1 修复后暴露）
- bug-4：CI 上 typecheck 缺 build step（bug-3 修复后暴露）
- 同时登记 `deferred ci-actions-node24-upgrade`（CI annotation 暴露的 2026-09-16 时点）

**意义**：4 层防护机制（宪法 / ledger / phase 退出 / CI）是设计冗余但不浪费——bug-1 漏过宪法和 ledger 但 CI 一开就抓；bug-2 是脚本扫描捕获；bug-3/4 是连锁暴露。**治理体系自身验证了它的必要性。**

### 阶段 C：patch-loop 架构设计（commit ffa5acb 中的 spec）

**起点**：用户明确「不按最小变更原则进行补丁式修复，要从根源上、架构上彻底解决 [Bug B]」

**关键架构决策**：取消「单次响应 = 全部变更」的契约，引入 patch loop——每轮模型只能输出三选一（多个 tool calls / 一个 change block / `<DONE/>`）。Pipeline 增量 apply、把结果反馈给下一轮。

**spec**: `docs/specs/2026-05-05-patch-loop-architecture.md` v1.1，372 行（v1.0 草稿 + v1.1 加 §9 跟踪事项回填）

**核心契约变更**：
- v0.3：1 次响应 / 多文件 / unified diff 行号 / parse-or-fail
- v0.4：N 次响应 / 单文件单 change / SEARCH/REPLACE 优先 / 增量反馈

### 阶段 E：全量验证 + 根因分析 + 自动终止 + Phase 2 复审（commits 5661c15..02da580，10 条）

**延续起点**：前一段会话设计的 patch-loop P1-P5 已被另一个 AI 会话实现 + P6.1 e2e 通过。本段从 CLI 测试修复开始，逐步推进到全量 benchmark、报告修复、根因分析、P1+P2 自动终止、allow-list 扩展、Phase 2 退出复审。

**主要成果**：

| 事项 | 状态 |
|------|------|
| CLI 测试 v0.4 适配 | ✅ |
| 报告统计修复（tool 明细不丢失）| ✅ |
| 13 fixture 全量 benchmark | ✅ docs/reports/260506-004042 |
| 根因分析（8 角度）| ✅ 会话记录 |
| 业界方案调研 | ✅ |
| P1 scope-progress 反馈 | ✅ commit e0d0ab2 |
| P2 continuous tools guard | ✅ commit eabcba1（rounds -23%）|
| exec_shell allow-list 扩展 | ✅ commit 02da580 |
| Phase 2 退出条件复审 | ✅ docs/reports/phase-2-exit-review.md |

**Phase 2 退出条件最终状态**：

| 条件 | 状态 |
|------|:----:|
| v0.4 协议操作覆盖率 | ⚠️ 4/6 |
| 多语言 | ⚠️ Python ✅ TS ❌ |
| 多仓库 | ✅ |
| 完成率 13/13 | ✅ |
| 静态扫描治理 | ✅ |
| 跨工具对比 | ⚠️ 待重跑 |
| 对比报告 | ✅ |
| 长期跟踪事项复审 | ✅ |

**plan**：`docs/plans/2026-05-05-patch-loop-architecture.md`（~390 行）

**6 phase 依赖图**：
```
P1 schema  ─┬─→ P2 parser ─┐
            │              ├─→ P4 pipeline ─→ P5 benchmark ─→ P6 e2e
            └──────────────┤
              P3 prompt ───┘
```

**任务卡片**（全部 frontmatter / AC / steps 完备）：
- P1 state-schema [ready, no deps]
- P2 turn-parser [backlog, deps=P1]
- P3 prompt-v04 [ready, no deps]
- P4 pipeline-rewrite [backlog, deps=P1+P2+P3]
- P5 benchmark-adapt [backlog, deps=P1+P4]
- P6 e2e-validation [backlog, deps=P5]

## 3. Commits（master 时间序）

```
da7c554  fix(core): unblock tool adoption — 多轮协议 + retry tools (会话之前)

267c971  fix(eval+core): repair tool-call statistics tracking
f1b0aa6  feat(scripts): add diagnostic scripts for DeepSeek tool-calls
1d68e75  docs(reports): 3 benchmark runs proving tool-adoption-fix verified
b6e59ce  docs: sync ledger and task status after tool-adoption-fix verified
ffa5acb  docs(specs+plans+tasks): tracked-items governance & patch-loop architecture
2463504  docs(governance): G1 — CONSTITUTION 原则 8 + ledger §8 + BLUEPRINT
3ec001f  docs(governance): G2 — spec template + backfill patch-loop §「跟踪事项」
7ad1341  feat(scripts): G3 — check-tracked-items.ts CI script for 原则 8
4eceebd  ci(governance): G4 — integrate check-tracked-items into scan workflow
a8c3ee8  fix(ci+core): resolve scan-workflow-branch-mismatch and exec-shell-redirect
9a43c2f  fix(ci): pin pnpm version via packageManager field
4f4cbf5  ci: add `pnpm -r run build` step before scan (cross-package types)
4c95a1a  docs(ledger): register ci-actions-node24-upgrade deferred item
7afc3b5  docs(plans+tasks): patch-loop architecture plan + 6 phase task cards
```

12 条会话内 commit，全部 origin/master 同步，最近一次 CI run 25368754580 ✓ success。

## 4. 测试统计

| 包 | 测试数 | 变化 |
|----|--------|------|
| cli | 23 | 不变 |
| provider | 23 | 不变 |
| repo | 45 | 不变 |
| core | 272 | +1（exec_shell `2>&1` allow case）|
| eval | 24 | 不变 |
| scripts/check-tracked-items | 10 | 新增 |
| **合计** | **397** | **+11** |

## 5. ledger §8 状态摘要

```
17 行（resolved 4 / waiting 13）
```

**resolved**（本会话内修复）：
- bug exec-shell-redirect
- bug scan-workflow-branch-mismatch
- bug ci-pnpm-version-missing
- bug ci-missing-build-step

**waiting 中 P1 等级**（最高优先级）：
- bug multi-file-patch-output-incomplete（patch-loop 实施后预期 → resolved）
- evidence patchloop-vs-batch-baseline（patch-loop P6 时收集）

**waiting 中 P2/P3** 含：repair-loop-upgrade / patch-loop-stash-rollback / phase4-agent-loop / dsh-vs-oc-resample / tool-args-coerce / history-spec-backfill / tracked-items-dashboard / auto-promotion / governance-overhead-baseline / ci-actions-node24-upgrade

详见 `docs/project-ledger.md` §8 完整表格。

## 6. 文档版本号

| 文档 | 版本 |
|------|------|
| CONSTITUTION.md | v1.1（加原则 8）|
| BLUEPRINT.md | v1.1（加 §3.1 Phase 退出复审协议）|
| docs/specs/2026-05-05-patch-loop-architecture.md | v1.1（加 §9 跟踪事项）|
| docs/specs/2026-05-05-tracked-items-governance.md | v1.0（治理 spec）|

## 7. 关键文件入口（按导航顺序）

```
新会话 AI 启动顺序：
  1. /CLAUDE.md                                    ← 项目宪法 + 蓝图导航
  2. /CONSTITUTION.md                              ← 8 项原则
  3. /BLUEPRINT.md                                 ← 7 阶段路线 + 退出复审
  4. /docs/project-ledger.md                       ← 项目事实台账（含 §8 跟踪事项）
  5. /docs/reports/session-260505-summary.md       ← 本文件
  6. /docs/TASK-SPEC.md §6                         ← 当前 task 索引
```

## 8. 下次会话起点（推荐顺序）

按依赖图 + 优先级，下次会话有 2 个并行入口：

### 入口 A：P1 state schema 扩展（约 30 分钟）
- task: `docs/tasks/2026-05-05-patchloop-p1-state-schema.md`
- 改 `packages/core/src/task-state.ts`：加 patchRoundSchema、扩 status / apply_status 枚举
- 改 `packages/core/src/index.ts`：导出新类型
- 测试：≥3 测试覆盖向后兼容
- 自检：`pnpm --filter @dsh/core run test`
- 触发解锁：P2 进 ready

### 入口 B：P3 PATCH_PROMPT v0.4（约 1-2 小时）
- task: `docs/tasks/2026-05-05-patchloop-p3-prompt-v04.md`
- 改 `packages/core/src/prompt-builder.ts`：删 v0.3 PATCH_PROMPT、写新 v0.4 prompt（5 个 section）
- 新建 `prompt-builder.test.ts`：≥3 测试
- 在 task Notes 区填 token 估算实际数值
- 触发解锁：P4 准备就绪（同时需要 P1 + P2）

### 推荐策略
- **快速建议**：先 P1（基础类型，30 min），再 P2（解析器，1-2h）；P3 留到 P2 之后做（与 P4 一起想 prompt 与 pipeline 配合）。这样 P4 启动时 schema/parser/prompt 全到位。
- **并行建议**：让另一个 session / 人手并行 P1 + P3，待 P1 完成后启动 P2（P3 不阻塞 P2）。

## 9. 风险 / 注意事项（带入下次会话）

1. **CI 注解**：CI 仍跑在 actions/* @ Node.js 20，2026-09-16 后 deprecated。已登记 `deferred ci-actions-node24-upgrade`，但下次 PR 时若 CI 绿但有此 warning，是已知项不要重新分析。

2. **patch-loop 实施风险**：spec §6 的最大风险是「模型不熟悉新协议，前几次 fixture 全 invalid」。spec §7.2 回退路径已写明（保留 schema、PATCH_PROMPT 切回 v0.3、env flag 选 batch 模式）—— 不是补丁式修复。

3. **不要重做的事**：
   - ❌ 不要再写 `2>&1` 之类正则修复（exec-shell-redirect 已 resolved）
   - ❌ 不要补 v0.3 → v0.4 的协议自动协商（spec §2.2 第 4 项明确 non-target）
   - ❌ 不要在 patch-loop P4 中改 repair-loop（spec §2.2 第 3 项明确不做）
   - ❌ 不要把 scripts/ 加进 lint（会话中讨论过：scripts/ 是非生产代码，G3 的 check-tracked-items 单独纳管即可）

4. **必须做的事**：
   - ✅ 任何新发现的 bug / debt / evidence 必须立即登记 ledger §8（CONSTITUTION 原则 8 强制）
   - ✅ 每个 PR commit 后跑 `./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts` 本地自检
   - ✅ patch-loop 实施过程中如新增 spec 修订，按治理 spec §3.6 加 §9 跟踪事项章节

## 10. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-05 | v1.0 | 初始会话总结 |
