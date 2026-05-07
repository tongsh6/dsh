# Patch 闭环完整性 SPEC

> 状态: draft | 日期: 2026-05-07 | 作者: tongshuanglong
>
> 目标: 把"plan.files 全覆盖"作为 patch 阶段的 hard invariant，让多文件任务"少改一个文件"在 patch 边界就被发现，而不是漏给 verify / repair 兜底。

## 1. 问题定义

### 1.1 当前状态

DSH 核心闭环：Plan → Patch → Verify → Repair → Handoff。

各阶段现行契约：
- **Plan**：模型输出 `<PLAN>` / `<FILES>` / `<RISKS>` / `<VERIFY>`，`state.plan.files` 记录待改文件清单
- **Patch**：进入 patch loop（`packages/core/src/pipeline.ts:304+`），多轮 tools/change/done/invalid。循环终止条件：
  - `<DONE/>` / `MAX_PATCH_ROUNDS=30` / `MAX_CONSECUTIVE_INVALID=3` / 首次 change 后 `MAX_CONSECUTIVE_TOOLS_ONLY=5`
  - 终止后只要 ≥1 change 应用成功就转 `patched`，否则 `patch_failed`
- **Verify**：执行配置的 verify 命令；含一个"scope-completeness 兜底"（pipeline.ts:510-517），但被 `apply_status !== "ok"` 卡死
- **Repair**：消费 verify 失败信号，再产出 patch 尝试

### 1.2 痛点 / 实证证据

实证报告：`docs/reports/260507-225620/`、`260507-230057/`、`260507-232926/`

Fixture `rh-mixed-dashboard-generated-at-backend` 要求改 2 文件（DashboardController.java + DashboardAppService.java）。三次 run 行为：

- patch loop 12-14 轮，模型只产出 1-2 个 change block，**全部落在 DashboardAppService.java 一个文件**
- patch loop 命中 `MAX_CONSECUTIVE_TOOLS_ONLY=5` 强制 break；由于 ≥1 change 成功，状态转 `patched`
- verify 阶段：scope-completeness 兜底因 `apply_status === "ok"` 不触发，verify 命令实际执行，最终断言失败
- repair 2 轮均未补 Controller.java，`filesChanged` 终态仍只有 AppService.java

**断层位置**：

1. patch loop 终止条件不含"plan.files 全覆盖"——模型可以 5 轮 tools-only 自然 break，留下未覆盖的 plan 文件
2. patch loop 接受 `<DONE/>` 时也不校验 plan.files 覆盖
3. verify 的 scope-completeness 兜底被 `apply_status !== "ok"` 限定，仅覆盖"全失败 + 未覆盖"边角，"成功 1 + 漏 1"这种最常见的部分覆盖完全漏过
4. repair 在 verify 输出里拿不到"哪个文件没改"的明确信号（普通 verify 命令通常不会暴露这个事实），逆向推断不可靠

### 1.3 与最终目标的关系

CONSTITUTION 原则 2「验证闭环」要求每个阶段产出必须经过验证才能进入下一阶段。"patch 阶段产出 = 模型在 plan.files 上的实际变更集合"——这个集合不完整等于 patch 阶段未完成。

BLUEPRINT Phase 2 退出条件「完成率 >60%」、Phase 3「Agent Loop」都依赖 patch 阶段契约稳定。如果 patch 完成定义模糊（部分覆盖也算完成），后续每一轮模型升级、prompt 调整产出的实证数据都会被这个口子污染——分不清是模型退化还是 patch 边界变松。

这是 Phase 2 收口问题，不是 Phase 3+ 才做的事。

## 2. 目标与非目标

### 2.1 目标

1. patch 阶段把"plan.files 全覆盖"作为产出的 hard invariant
2. 模型尝试 `<DONE/>` 时若 plan.files 未全覆盖，反馈"剩余 X, Y"并要求继续，不允许 done
3. patch loop 自然终止（tools-only guard / max rounds）时若 plan.files 未全覆盖，状态转 `patch_failed`，不进 verify
4. `patch_failed` 路由到 repair 时，repair 任务首条 hint 明确指出"补全缺失文件 X, Y"
5. 解锁 verify 阶段的 scope-completeness 兜底（去掉 `apply_status !== "ok"`），作为最后防线

### 2.2 非目标

1. ❌ 不重写 verify 协议（断言结构化是议题 B，独立 spec，详见 §9 跟踪事项）
2. ❌ 不动 plan 阶段（plan.files 的产生方式不变；本 spec 假定 plan.files 已包含模型应该改的全部文件）
3. ❌ 不增加新的失败检测器（detectScopeShortfall）——patch 阶段拦截后，repair 信号已结构化，不需要从 verify 输出反推
4. ❌ 不引入新状态机状态（复用现有 `patch_failed`，仅扩展进入条件）
5. ❌ 不调整 patch loop 的轮数阈值（`MAX_*` 常量），是独立调优议题

## 3. 设计

### 3.1 patch 完成定义

| 状态 | 条件 |
|------|------|
| `patched` | ≥1 change 应用成功 **且** plan.files 全覆盖 |
| `patch_failed` | 0 change 成功 **或** plan.files 未全覆盖 |

文件覆盖判定复用现有 endsWith 容差匹配（pipeline.ts:514-516），抽出为 helper `computeUncoveredPlanFiles(planFiles, changedFiles): string[]`。

### 3.2 patch loop 终止门控

**路径 A：模型输出 `<DONE/>`**

当前 (`pipeline.ts:409-414`)：
```ts
case "done": {
  record.reasoning_excerpt = ...;
  state.patch_rounds.push(record);
  writeTaskState(cwd, state);
  round = MAX_PATCH_ROUNDS; // exit loop cleanly
}
```

升级后：
- 计算 `uncovered = computeUncoveredPlanFiles(plan.files, allChangedFiles)`
- `uncovered.length === 0` → 同现行，cleanly exit
- `uncovered.length > 0` → done 视为 invalid，向 messages 注入 user 反馈：
  > `<DONE/> rejected: plan.files 还有未覆盖文件 [X, Y]。继续输出对应的 change block；不要重复修改已完成的文件 [A]。`
  
  `consecutiveInvalid++`，不退出循环。round 仍计入 `state.patch_rounds`，action 标 `invalid`，invalid_reason="done_with_uncovered_plan_files"。

**路径 B：tools-only guard 命中**（`pipeline.ts:440-442`）

不增加门控（仍然 break）；状态由 §3.3 的 aggregate 决定。

**路径 C：max rounds / consecutive invalid**

不增加门控（这两条路径已经是模型卡住，不能再要求继续）；状态由 §3.3 的 aggregate 决定。

### 3.3 状态聚合（pipeline.ts:447-482）升级

当前：
```ts
if (okChanges.length > 0) state = transition(state, "patched");
else state = transition(state, "patch_failed");
```

升级后（伪代码）：
```ts
const planFiles = state.plan?.files ?? [];
const uncovered = computeUncoveredPlanFiles(planFiles, allChangedFiles);
const lastPatch = state.patches[state.patches.length - 1];

if (okChanges.length === 0) {
  state = transition(state, "patch_failed");
} else if (uncovered.length > 0) {
  lastPatch.patch_incomplete_reason = `uncovered plan files: ${uncovered.join(", ")}`;
  state = transition(state, "patch_failed");
} else {
  state = transition(state, "patched");
}
```

### 3.4 patch_failed → repair 路由信号

`runRepair`（pipeline.ts:565+）已在 repair 入口接受 `verification_failed | patch_failed`，本 spec 不动控制流。

`runRepairLoop`（`repair-loop.ts:117+`）升级：
- 若 `last patch.patch_incomplete_reason` 非空，在 taskDescription 顶部追加：
  > `PATCH INCOMPLETE: 上一轮 patch 阶段未覆盖以下 plan 文件：[X, Y]。请优先输出针对这些文件的 change block。已修改文件 [A, B] 不要重复修改。`
- 失败检测器（DETECTORS）不增加 detectScopeShortfall——patch_incomplete_reason 已经是结构化信号，detector 是用来从非结构化 verify 输出做模式识别的，本场景下用不上

### 3.5 Verify scope-completeness 兜底解锁

`pipeline.ts:510-517` 当前：
```ts
if (uncovered.length > 0 && lastPatch && lastPatch.apply_status !== "ok") {
  // partial_ok or failed + uncovered plan files → verification_failed
  ...
}
```

升级后：
```ts
if (uncovered.length > 0 && lastPatch) {
  // 任何 apply_status 下，plan.files 未覆盖即 fail
  ...
}
```

§3.3 落地后，runVerify 几乎不会再看到"plan.files 未覆盖"的状态进入（patch 阶段已经路由去 patch_failed），但保留这条作为最后防线——预防 plan.files 在 patch 后被人工修改、或未来引入绕过 §3.3 的新 patch 路径。

## 4. 数据模型 / 契约变更

`PatchRecord` schema（`packages/core/src/task-state.ts:28-34`）增加可选字段：

```ts
const patchRecordSchema = z.object({
  // ... 现有字段
  patch_incomplete_reason: z.string().optional(),
});
```

`DshConfig`：无变更。
verify 协议：无变更（议题 B 范围）。
状态机 `VALID_TRANSITIONS`：无变更（复用现有 `patched` / `patch_failed`）。

## 5. 成功标准

### 5.1 功能验收

- [ ] 单测：patch loop 收到 `<DONE/>` 但 plan.files 未全覆盖时，记 invalid + 注入反馈消息 + consecutiveInvalid++（不直接 exit）
- [ ] 单测：patch loop 自然终止 + ≥1 change 成功 + plan.files 未全覆盖 → 状态转 `patch_failed` + last patch 含 `patch_incomplete_reason`
- [ ] 单测：patch loop 自然终止 + ≥1 change 成功 + plan.files 全覆盖 → 状态转 `patched`（旧行为不变）
- [ ] 单测：`runRepairLoop` 在 last patch 含 `patch_incomplete_reason` 时把 hint 注入 taskDescription 顶部
- [ ] 单测：`runVerify` scope-completeness 兜底在 `apply_status === "ok"` 但 uncovered 非空时也触发

### 5.2 行为验收（数据驱动）

- [ ] 重跑 `rh-mixed-dashboard-generated-at-backend` 3 次：
  - patch 阶段不再 3/3 以 `patched` 终止（基线：当前 3/3 patched 但 plan.files 未全覆盖）
  - repair 至少 1/3 次成功补上 DashboardController.java（`filesChanged` 终态含 2 文件）
  - `testsPassed` 至少 1/3 次为 true
- [ ] 重跑 13 fixture 完整 benchmark（基线：`260506-004042`）：
  - 完成率不低于基线 ±5%
  - 之前 `testsPassed=true` 的 fixture 不变红
  - 期望出现的变化：原来"patched 但 plan 未覆盖"的 fixture 现在标 `patch_failed`，进入 repair；可见量化体现在 patchRoundActions 与 invalid 计数

### 5.3 性能 / 成本验收

- 不引入额外 API 调用（done 拒绝路径会延长循环，但只在原本"提前 done"的 case 才发生；patch_failed 路径不增加循环）
- 单 fixture 平均耗时变化 ±20% 以内

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| plan.files 不准确（plan 阶段漏列文件） | 中 | 多文件 fixture 卡在 patch_failed → repair 死循环 | repair 在 patch_incomplete_reason 路径允许 plan.files 列表外的文件不计 scope-creep；超过 maxRepairRounds 仍 fail 是预期 |
| 现有"patched 状态 + plan 未覆盖"的 fixture 行为变化 | 高 | 个别 fixture 基线变红 | 这是设计目标：暴露被掩盖的不完整。逐 fixture 复审，必要时修正 plan.files 或 maxRepairRounds，不削弱 invariant |
| done 拒绝后模型仍坚持 done | 中 | 循环到 `MAX_CONSECUTIVE_INVALID=3` 退出 | 走路径 C，aggregate 阶段判 `patch_failed`，repair 接管，符合预期 |
| `patch_incomplete_reason` 字段在旧 task-state.json 反序列化失败 | 低 | 字段是 optional，兼容；旧文件 schema 接受 |

## 7. 实施策略

### 7.1 分 Phase

| Phase | 目标 | 关键产物 |
|-------|------|---------|
| P1 | schema + helper：`PatchRecord.patch_incomplete_reason` + `computeUncoveredPlanFiles` | `task-state.ts`、`pipeline.ts` 顶部 helper + 单测 |
| P2 | patch loop done 拒绝 + aggregate 升级 | `pipeline.ts` patch loop 主体 + 单测 |
| P3 | repair-loop hint 注入 | `repair-loop.ts` + 单测 |
| P4 | verify scope-completeness 解锁 | `pipeline.ts` runVerify + 单测 |
| P5 | 实证：rh-mixed-dashboard 3 次重跑 + 13 fixture 全量重跑 | `docs/reports/<run-id>/` |

### 7.2 回退策略

每 Phase 一个 commit。若实证退化（完成率掉 >5%），按 P4 → P3 → P2 → P1 顺序 revert。

### 7.3 不在本 spec 范围

- verify 协议结构化升级（议题 B，独立 spec，跟踪事项 §9）
- patch loop tools-only guard 阈值调整
- plan 阶段 plan.files 推导改进（更上游问题）

## 8. 不在本 spec 范围

同 §7.3。

## 9. 本 spec 引发的跟踪事项

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
| deferred | verify-protocol-structured | patch-completeness 上线 ≥1 周 + ≥10 fixture 实测后启动 | P1 | 议题 B：verify 命令从 shell string 升级为结构化断言（file_contains / exit_code / shell 等）；本 spec §3.5 只解锁兜底，不重写协议 |
| evidence | patch-completeness-baseline | spec P5 完成时收集 | P1 | `rh-mixed-dashboard-generated-at-backend` 3 次重跑 + 13 fixture 全量 benchmark vs `260506-004042` 基线对比 |

## 10. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-07 | v1.0 (draft) | 初始 spec |
