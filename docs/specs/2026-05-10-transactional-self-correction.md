# Spec: 事务级自愈与工程一致性约束 (Transactional Self-Correction)

> 状态: Draft | 日期: 2026-05-10 | 议题编号: PHASE-3-D

## 1. 背景与动机

目前的 `dsh` 在遇到连续修复失败或越改越错的情况时，倾向于在"错误的现场"继续堆砌补丁。这不仅导致 Token 浪费，还会导致上下文噪音过载。

我们需要引入**"事务级自愈"**机制，让 Agent 具备"推倒重来"的能力；同时引入**"工程一致性约束"**，让 Agent 在提交代码前进行自我审计。

### 1.1 目标 (Goals)
*   实现物理级的工作区回滚，消除 Regression。
*   建立清晰的代码所有权界限，防止误伤用户代码。
*   提高修复成功率，减少无效循环。

### 1.2 非目标 (Non-goals)
*   **不跨阶段回滚**：Repair 阶段的回滚不会撤销 Patch 阶段已确认的修改。
*   **不追踪系统副作用**：回滚仅限于文件内容和 Git 索引，不涵盖 `exec_shell` 产生的数据库变更或网络副作用。
*   **不作为通用版本控制**：Checkpoint 仅为 Task 内部临时快照，不替代用户 Git 操作。

## 2. 核心设计

### 2.1 事务快照与回滚 (Change Snapshots & Rollback)
在 Patch 循环的每一轮，系统会自动管理 Git 状态，采用**双轨快照策略**：

*   **策略 A: Git Stash 模式（优先）**:
    *   在每一轮 Patch 应用前，执行 `git stash push -m "dsh-checkpoint-${phase}-round-${round}" --include-untracked`。
    *   **生命周期清理**: 在每个 Phase (Plan/Patch/Repair) 正常或异常退出时，系统必须自动执行 `git stash list` 并清理所有带 `dsh-checkpoint-` 前缀且属于当前 Task 的记录，防止栈溢出。
*   **策略 B: 文件级备份模式（降级）**:
    *   针对非 Git 项目，仅备份 `managed_files` 列表中的文件到 `.dsh/snapshots/` 目录。
*   **Rollback 行为**: 
    *   如果 `Failure Detector` 检测到严重的增量回归（Regression）或修复停滞（Stagnation），执行物理回滚。
    *   **Round 处理**: 回滚后，**Round 号不递增**。当前 Round 被视为一次无效尝试，Agent 将带着失败原因重新进入该 Round 决策，确保 30 轮上限代表的是“有效改动尝试”。

### 2.2 变更所有权与隔离 (Ownership & Isolation)
*   **托管文件清单填充规则 (Managed Files Rules)**:
    *   **注入时机**: 只有当 Patch 协议块（CREATE, PATCH, RENAME, DELETE）被**首次成功应用**到某个文件时，该文件路径才被加入 `TaskState.managed_files`。
    *   **持久化**: 该清单在 Task 生命周期内单调递增，Handoff 报告中将显式列出此清单。
*   **错误归因 (Error Attribution)**: 
    *   **初始基准 (Baseline)**: 在第一轮 Patch 前执行 `initial_verify`。
    *   **开关控制**: `config.yml` 中可通过 `verify.initial_preflight: boolean` 控制（默认为 `true`）。
*   **冲突保护 (Integrity Guard)**: 应用 Patch 前校验 `managed_files` 的哈希。若发生外部篡改，立即挂起并转入人工介入或冲突合并模式。

### 2.3 数据模型 (CheckpointRecord Schema)

```typescript
interface CheckpointRecord {
  id: string;              // dsh-checkpoint-uuid
  phase: "patch" | "repair";
  round: number;
  strategy: "git-stash" | "file-snapshot";
  files_tracked: string[]; // 本次受影响的文件
  created_at: string;
  rolled_back: boolean;
  rollback_reason?: "regression" | "stagnation";
}
```

### 2.4 自动审计工具 (Self-Audit Tools)
... (保持原样) ...

### 2.5 策略化重试 (Strategic Retry)
... (保持原样) ...

## 3. 实施计划

### Phase 1: 基础设施与所有权 (P0)
*   实现 `TaskState.managed_files` 追踪。
*   封装双轨回滚工具类（Git/File-based）。
*   在 `pipeline.ts` 中集成 `initial_verify` 逻辑。

### Phase 2: 引导式自省与审计 (P1)
*   开发 `dsh lint-check` 基础能力（包名/路径校验）。
*   更新 `prompt-v04`，加入"发布前 Checklist"和回滚复盘模板。

### Phase 3: 语义化审计引擎 (P2)
*   针对 Java/TS 提供更深层的静态一致性校验。

## 4. 预期收益与成功标准

### 4.1 量化指标
*   **修复成功率 (repairSuccess)**: 从目前的 0% 提升至 **≥ 25%**。
*   **回滚有效性**: Regression 触发后，回滚并重试的通过率达到 **≥ 50%**。
*   **无效轮数**: 由于 Stagnation 导致的无效循环减少 **≥ 30%**。

### 4.2 非量化收益
*   **交接质量**: Handoff 报告能清晰区分 `dsh-modified` 与 `original-broken` 代码。
*   **Token 节省**: 及时止损，防止模型在错误路径上越走越远。

## 5. 风险与限制
*   **性能**: 大型 Repo 频繁 Stash 可能耗时，需设置 30s 超时保护。
*   **副作用**: `exec_shell` 产生的系统级副作用（如数据库修改）无法回滚。
*   **冲突**: 用户并行修改可能导致 Stash Pop 冲突，需通过 `Integrity Guard` 拦截。

---

## 6. Review 意见 (2026-05-10，第二轮)

> 审核人: Claude Code (deepseek-v4-pro) | 上一轮反馈采纳情况：双轨快照 ✅、量化指标 ✅、风险清单 ✅、审计工具推迟 ✅、--include-untracked ✅

### 6.1 第一轮反馈采纳确认

以下第一轮 review 中提出的问题已被 spec v2 采纳，无需再议：

| 原反馈 (§5.x) | 采纳位置 | 状态 |
|--------------|---------|------|
| §5.3-A: `--include-untracked` | §2.1 策略 A | ✅ 已写入 spec |
| §5.3-C: 审计工具推迟 Phase 2 | §3 Phase 2 | ✅ 已调整 |
| §5.3-D: 废弃路径标记 | §2.4 "标记废弃路径" | ✅ 已明确 |
| §5.4: 非 Git 项目双轨策略 | §2.1 策略 A/B | ✅ 已写入 spec |
| §5.5: 风险清单 | §5 | ✅ 已写入 spec |
| §5.6: 量化指标 | §4.1 | ✅ 已写入 spec |

### 6.2 第二轮：新增 §2.2「变更所有权与隔离」评审

这是 v2 最重要的新增内容，引入三个机制：`managed_files`、`initial_verify`、`Integrity Guard`。

#### managed_files —— 设计合理，需明确填充规则

**核心价值**：解决了"哪些文件是 DSH 改的"这个关键问题——物理回滚和 Integrity Guard 都依赖此清单。

**当前 spec 未明确的问题**：`managed_files` 的填充规则是什么？

建议明确为：

```
managed_files = plan.files ∪ 所有 change round 中 apply_status="ok" 的实际变更文件
```

- `plan.files` 覆盖"计划要改的"（含尚未修改的——用于 pre-checkpoint）
- 实际变更覆盖"计划外但实际改了"的（模型可能超出 plan 范围修改）
- 并集去重，不重不漏

**与现有 `patches[].files_changed` 的关系**：`patches` 记录的是 aggregate，`managed_files` 需要实时更新（每轮 change 后追加），两者数据同源但用途不同。

#### initial_verify —— 有价值但增加 pipeline 复杂度

**核心价值**：建立错误基线，区分"项目本来就坏的"和"DSH 改坏的"。这让 Regression 判定更精准——只有 DSH 引入的新错误才算 Regression。

**当前 pipeline 流程是**：`runPlan → runPatch → runVerify → runRepair`

加入 initial_verify 后的建议流程：

```
runPlan → [initial_verify] → runPatch → runVerify → runRepair
              ↑
        在 runFullPipeline 中，plan 之后、patch 之前插入
```

**需要注意的点**：
- initial_verify 需要一次 API 调用 + shell 执行，增加 pipeline 耗时
- 对于 benchmark fixture，起始状态通常是干净的（git reset --hard 之后），initial_verify 大概率全绿，基线价值有限
- 对于真实项目（可能起始就有测试失败），initial_verify 的价值更大

**建议**：initial_verify 作为可选行为（通过 config 或 CLI flag 控制开关），benchmark 场景默认关闭以节省时间。

#### Integrity Guard —— 防御纵深，但成本需评估

**核心价值**：在每轮 change 应用前，校验 `managed_files` 的哈希，检测外部篡改。

**实际触发场景**：
- Agent 通过 `exec_shell: sed -i managed_file` 修改了托管文件（当前已知限制）
- 用户并行操作（低概率，但防御正确）

**成本评估**：
- 每个 change round 前需要读取并哈希所有 managed_files
- 如果 managed_files 有 10 个文件、每个 5KB，哈希成本可忽略
- 如果 managed_files 有 100 个文件、每个 100KB，成本约 10ms——可接受

**建议**：Phase 1 实现基础版本（哈希对比 + 挂起报错），暂不做自动冲突合并。冲突合并是 Phase 2+ 的工作。

### 6.3 仍未覆盖的问题

| # | 问题 | 状态 | 建议 |
|---|------|------|------|
| 1 | Stash 栈生命周期管理 | ⚠️ spec §2.1 提到双轨但未提及清理 | 补充：phase 退出时 `git stash list \| grep dsh-checkpoint \| xargs git stash drop` |
| 2 | 触发时序：pop 后 round 号处理 | ⚠️ spec 未明确 | 建议：回滚后重新进入当前 round（不递增 round 号），视为本轮修复无效 |
| 3 | `managed_files` 填充规则 | ⚠️ spec 只说"记录"未说规则 | 建议：`plan.files ∪ apply_status="ok" 的 change files` |
| 4 | initial_verify 的开关控制 | ⚠️ spec 未提及 | 建议：config 项 `transactional.initial_verify` 默认 false |
| 5 | `CheckpointRecord` schema 未写入 spec | ⚠️ 仍在 review 建议中 | 建议纳入 spec §2.1 或 §2.2 |
| 6 | 非目标边界仍未定义 | ⚠️ 持续缺失 | 建议补充 §2 末尾 |

### 6.4 更新后的 CONSTITUTION 五要素评分

| 要求 | v1 评分 | v2 评分 | 变化说明 |
|------|--------|--------|---------|
| 目标与非目标 | ⚠️ 缺失 | ⚠️ 仍缺失 | 目标已扩展（含所有权），但非目标仍未明确 |
| 设计依据 | ⚠️ 部分 | ✅ 充分 | 双轨策略已说明选型理由，新增 initial_verify 和 Integrity Guard 有明确动机 |
| 架构与数据模型 | ❌ 缺失 | ⚠️ 部分 | 新增 managed_files、ownership 概念，但 CheckpointRecord schema 仍需正式纳入 |
| 成功标准 | ❌ 缺失 | ✅ 满足 | §4.1 有 3 个量化指标 + 基线数据 |
| 风险与限制 | ❌ 缺失 | ⚠️ 部分 | §5 有 3 条风险但偏简略，建议采纳 §6.3 的补充清单 |

### 6.5 v2 总结

| 维度 | v1 评估 | v2 评估 |
|------|--------|--------|
| 设计方向 | ✅ 正确 | ✅ 正确——新增的 ownership 概念让回滚更精准 |
| Spec 完整度 | ⚠️ 3/5 | ✅ 4/5——量化指标 + 双轨策略 + 风险清单补齐了主要缺口 |
| 新增设计的风险 | — | ⚠️ initial_verify 增加 pipeline 环节、managed_files 的维护一致性需在实现中验证 |
| Task 可执行性 | ⚠️ 步骤有歧义 | ⚠️ 待 task doc 更新后重新评估（Phase 1 新增了 managed_files 和 initial_verify） |
| 建议 | P1 实施 | 可进入实施——优先实现双轨快照 + managed_files 追踪；initial_verify 和 Integrity Guard 建议先以最小可用版本（开关默认关闭）交付 |
