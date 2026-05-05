# Patch Loop 架构升级（协议 v0.4）

> 状态: draft | 日期: 2026-05-05 | 作者: loong
>
> 目标: 取消 PATCH 阶段「一次响应 = 全部变更」的契约，引入按轮迭代的 Patch Loop —— 每轮模型只产出一个变更或一次工具调用，pipeline 增量 apply，直到模型显式 `<DONE/>`。

## 1. 问题定义

### 1.1 当前状态（协议 v0.3）

`runPatch` 的契约：模型在**单次响应**里输出 PLAN + 全部变更块（CREATE/PATCH/INSERT/DELETE/RENAME 任意组合）+ VERIFY + RISKS。pipeline 一次性 `parseChanges` + `applyChanges`。

工具系统（cca44ee, 2026-05-04）在 PATCH 之前加了多轮工具调用，但**最终一次响应仍要承担「输出全部变更」**。

### 1.2 实证证据（2026-05-04 的 3 次 fixture run）

同一 fixture（`loam-bugfix-cli-error-handling`，3 文件 bugfix）：

| run_id | commit | 工具调用 | 实际改动 | 结果 |
|--------|--------|---------|---------|------|
| 260504-173531 | da7c554 | 5 轮 11 次 | 0/3 文件，patch="<empty>" | parse failed |
| 260504-183633 | da7c554 | 5 轮 12 次 | 1/3 文件（只 capture.ts）| testsPassed=false |
| 260504-185028 | da7c554 + Bug A/C 修复 | 5 轮 12 次 | 0/3 文件，patch="<empty>" | parse failed |

工具调用阶段稳定（3 次都正确探索了所有 3 个目标文件 + 错误类定义 + CLI 入口）。**问题在最终输出阶段**：3 次出现 3 种不同失败模式（部分输出 / 全空 / 全空），方差极高。

### 1.3 根因分析

「单次响应输出全部变更」这条契约在以下条件叠加时本质不可靠：

1. **多文件任务** —— 单次响应必须包含 N 个 PATCH 块（含 unified diff 行号），错误率随 N 上升
2. **工具循环之后** —— 5 轮 read_file 累积 ≥19K tokens 上下文，思考与输出预算被压缩
3. **MAX_TOOL_ROUNDS 触发后** —— 强制注入"output XML"提示，模型在已经"累"的状态下产出更不稳定

无论 PATCH_PROMPT 措辞如何，让模型同时承担 "exploration done" 与 "multi-file complete patch" 两个目标都是不稳定的。这条契约在 Phase 1（无工具）合理；在 Phase 2（有工具）已不合理。

### 1.4 与「最终目标」的关系

BLUEPRINT 第 1 节定位 DSH 是「DeepSeek-native Coding Agent」，对标 Claude Code、对比 OpenCode。compare-20260502-120419 报告显示 OpenCode 在同一 bugfix 任务上是 **每轮一个最小动作**（read_test → grep → fix），DSH 是 **batch**。这条契约差异是 DSH 在 benchmark 上落后 OpenCode 的核心原因之一。

继续打补丁（调 prompt、改 retry）只能让方差减小一点，无法解决"单次响应承担多目标"的本质。

## 2. 目标与非目标

### 2.1 目标

1. **PATCH 阶段从 batch 改为 loop**：每轮模型选择「工具调用 / 单个变更块 / `<DONE/>`」之一
2. **变更增量应用**：pipeline 每轮 apply 后把结果注入下一轮，模型基于真实 disk 状态决策下一步
3. **协议升级 v0.4**：定义 `<DONE/>` 块、单轮单变更约束、单变更块对应单文件约束
4. **失败局部化**：单个变更块失败不再让整轮 patch 失败；已成功 apply 的不丢失
5. **可观测性**：task-state 记录 patch_rounds 序列，benchmark 报告每轮的工具/变更/apply/verify 结果
6. **与现有体系兼容**：`runPlan`、`runVerify`、`runRepair`、`runHandoff` 接口签名不变，只 `runPatch` 内部重构

### 2.2 非目标

1. **不做完整 Agent Loop**（BLUEPRINT Phase 4） —— 模型不能自主分解任务、不能调度子 Agent，patch 仍由用户单 task 驱动
2. **不动 PLAN 阶段** —— PLAN 仍是单轮响应（`<PLAN>`/`<FILES>`/`<VERIFY>`/`<RISKS>` 一次性给出）
3. **不动 REPAIR 阶段（本期）** —— repair 仍沿用现协议；若 D 部分完成度检查使 repair 触发频次上升、且 repair 也表现出同样不稳，再扩到 repair（v0.5）
4. **不做协议自动版本协商** —— v0.4 prompt 是硬切换，老 prompt 删除而非保留
5. **不做事务回滚** —— 单轮 apply 失败不自动 rollback；由模型在下一轮自行修正（v0.5 可加 stash/restore）
6. **不引入新的工具类型** —— 仍只 `read_file` / `grep_files` / `exec_shell`
7. **不改 verify 命令体系** —— verify 仍跑 plan.verify_commands

## 3. 设计

### 3.1 协议 v0.4

PATCH 阶段每轮模型响应可包含：

| 内容 | 数量 | 说明 |
|------|------|------|
| 工具调用（OpenAI function calling） | 0 个或多个 | 同 v0.3，与变更块互斥 |
| 单个变更块 | 0 个或 1 个 | CREATE / PATCH / INSERT / DELETE / RENAME 之一 |
| `<DONE/>` | 0 个或 1 个 | 显式终止信号 |
| `<NOTE>...</NOTE>` | 0 个或 1 个 | 可选，模型说明为什么这样改（仅审计，pipeline 忽略） |

**约束**：
- 一轮响应**最多 1 个**变更块。多于 1 个 → pipeline 拒绝整轮、注入提示重试
- 一个变更块**只允许一个文件**（CREATE/PATCH/INSERT/DELETE 一文件、RENAME 一对路径）
- 工具调用和变更块**互斥**（同轮不能既调工具又出变更块）
- `<DONE/>` 出现 → 该轮其他内容被忽略

### 3.2 Pipeline 循环

```
runPatch():
  state = readTaskState
  layers = buildLayers
  messages = buildMessages(phase: "patch", protocol: "v0.4")
  
  for round in 1..MAX_PATCH_ROUNDS:
    response = client.chat({ messages, tools, thinking })
    parsed = parsePatchTurn(response)  // 新解析器
    
    record = { round, response_excerpt, action }
    
    switch parsed.kind:
      case "tools":
        execute tools, push results to messages
        record.action = "tools"
        record.tool_calls = ...
      
      case "change":
        apply_result = applyChange(parsed.change, cwd)
        record.action = "change"
        record.change = parsed.change
        record.apply_status = apply_result.status
        push apply_result message back  // "✓ applied capture.ts" 或 "✗ failed: ..."
      
      case "done":
        record.action = "done"
        break loop
      
      case "invalid":
        push correction message  // "you must output ONE of: tool calls, ONE change block, or <DONE/>"
        record.action = "invalid"
    
    state.patch_rounds.push(record)
    writeTaskState
  
  // 循环结束后
  state = transition(state, "patched")  // 即使部分应用，进入 verify 阶段
  return state
```

**关键差异 vs v0.3**：
- 不再有 `parseChanges` + `applyChanges` 一次性大块
- 每轮独立 apply，apply 结果直接注入下一轮上下文
- patch 总成功 = 至少一个 change apply 成功 + 模型主动 done 或自然终止

### 3.3 数据模型

#### 3.3.1 task-state.ts schema 扩展

```ts
// 新增
const patchRoundSchema = z.object({
  round: z.number(),
  action: z.enum(["tools", "change", "done", "invalid"]),
  // for action="tools"
  tool_calls: z.array(toolCallRecordSchema).optional(),
  // for action="change"
  change: z.object({
    op: z.enum(["CREATE", "PATCH", "SEARCH_REPLACE", "INSERT", "DELETE", "RENAME"]),
    file: z.string(),  // RENAME 时存 "from -> to"
    apply_status: z.enum(["ok", "failed"]),
    apply_error: z.string().optional(),
    raw_block: z.string(),  // 模型输出的原始 XML，便于审计
  }).optional(),
  // for action="invalid"
  invalid_reason: z.string().optional(),
  // 通用
  reasoning_excerpt: z.string().optional(),  // reasoning_content 前 500 字
  duration_ms: z.number(),
});

// task-state 顶层加字段
patch_rounds: z.array(patchRoundSchema).default([]),
```

`patches: PatchRecord[]`（旧字段）保留，仅在 patch loop 全部完成后写一条聚合记录（向后兼容下游 benchmark/handoff）。

#### 3.3.2 PatchRecord 聚合规则

patch loop 结束时合成一条 `PatchRecord`：
- `round`：保留语义为 `repair_rounds + 1`（即第几次进入 patch 阶段，与现状一致）
- `patch`：所有 change.raw_block 串联
- `apply_status`：所有 change.apply_status 全 ok → "ok"，部分失败 → "partial_ok"（新枚举值），全失败 → "failed"
- `files_changed`：所有 change.file 去重

#### 3.3.3 新增枚举

`apply_status` 增加 `"partial_ok"`：表示至少一个 change 成功但有 change 失败。下游 verify 仍跑（status="patched"）；scope-completeness check 在 verify 层判定。

### 3.4 Prompt 设计（v0.4 PATCH_PROMPT 骨架）

```
You are a DeepSeek-native Coding Agent in PATCH LOOP MODE.

## Loop Protocol

This is a multi-turn loop. Each turn, output EXACTLY ONE of:

  (a) Tool calls — to explore the codebase. Multiple tool calls per turn allowed.
  (b) ONE change block — CREATE, PATCH, INSERT, DELETE, or RENAME for ONE file.
  (c) <DONE/> — when all required changes are complete.

The system applies your change immediately and tells you the result on the next turn.
Build up your changes one file at a time.

## Termination

Output <DONE/> when:
  - All files in <FILES> have been modified per the plan
  - You have nothing more to add

The system will run verify after <DONE/>. If verify fails, you'll re-enter via REPAIR.

## Change Block Rules

Each turn outputs at most ONE change block, scoped to ONE file.

[CREATE / PATCH / INSERT / DELETE / RENAME 详细格式 — 与 v0.3 同]

## Tool Rules

[与 v0.3 同 — read_file / grep_files / exec_shell]

## After-Apply Feedback

After each change block, the system replies with:
  "✓ change applied: <file> (op=PATCH, +X -Y lines)"   on success
  "✗ change failed: <reason>"                          on failure
You can read the result, decide your next action.
```

### 3.5 patch-parser.ts 修改

新增 `parsePatchTurn(content: string)` 返回 discriminated union：

```ts
type PatchTurnAction =
  | { kind: "tools" }                              // 由 tool_calls 字段判断，content 可空
  | { kind: "change", change: ChangeBlock }
  | { kind: "done" }
  | { kind: "invalid", reason: string };

type ChangeBlock = {
  op: ProtocolOp;
  file: string;
  raw_block: string;
  // op-specific payload (复用现有 CreateBlock/SearchReplaceBlock 等结构)
  payload: ...;
};
```

校验规则：
- 0 个变更块 + 0 个 `<DONE/>` + 无 tool_calls → `invalid("no action")`
- ≥2 个变更块 → `invalid("multiple change blocks; output one per turn")`
- 1 个变更块跨多文件（如 unified diff 含多个 `--- a/...`）→ `invalid("change block must target a single file")`
- `<DONE/>` 出现 → `done`（即使同时有变更块，变更块被忽略，记录 invalid_reason 用于审计）

`parseChanges`（旧批量解析器）仍保留，供 repair-loop（暂不改）使用。

### 3.6 与工具系统的关系

每轮模型可单独发工具调用（多个工具一轮 OK）。工具调用与变更块互斥（同轮二选一）。工具结果立刻进 messages，下一轮模型基于结果决策。

工具调用次数不再有独立 `MAX_TOOL_ROUNDS` 上限，统一用 `MAX_PATCH_ROUNDS` 控制总轮数。

### 3.7 与 verify / repair 的衔接

- **patch loop 退出后**：`runVerify` 不变。
- **scope-completeness check（D 必选项）**：`runVerify` 在跑命令前先比对 `plan.files` vs 本次 patch loop 累计 `files_changed`。落差非零 → 直接 `verification_failed`（即使没跑命令）。
- **repair loop 不变**：仍按 v0.3 协议（一次响应 + 全部变更）。理由：repair 通常只改少数文件，问题规模小；本期数据不足以证明 repair 也需要 loop。

### 3.8 终止条件

| 条件 | 处理 |
|------|------|
| 模型输出 `<DONE/>` | 正常退出，进入 verify |
| 达到 MAX_PATCH_ROUNDS（建议 30） | 强制退出，进入 verify（带提示） |
| 累计 messages 长度超 800K 字符 | 强制退出（与 v0.3 budget warning 同阈值） |
| 连续 3 轮 invalid | 强制退出 patch，标 status="patch_failed"（新状态）→ 直接 repair |
| client.chat 抛 API 错 | 异常向上抛，由 benchmark-runner 捕获 |

新 status `"patch_failed"` 加入 task-state schema：表示 patch loop 走完但无任何 change 成功 apply。状态机：`planned → patching → patched | patch_failed → ...`。

### 3.9 文件结构

```
packages/core/src/
├── pipeline.ts          # runPatch 重写为 loop（其他函数不变）
├── patch-parser.ts      # 新增 parsePatchTurn；parseChanges 保留
├── prompt-builder.ts    # PATCH_PROMPT v0.4；PLAN/REPAIR_PROMPT 不变
├── task-state.ts        # 加 patch_rounds + patch_failed status + partial_ok
├── tool-executor.ts     # 不变
└── ...
packages/eval/src/
├── benchmark-runner.ts  # 适配 patch_rounds 字段、partial_ok、scope-completeness
└── ...
```

## 4. 数据模型迁移

### 4.1 旧 task-state.json 兼容

新 schema 必填 `patch_rounds: []` (default)。旧文件经过 zod 解析时会自动补 default。无需迁移脚本。

### 4.2 旧 benchmark 报告

历史报告 metadata 不含 patch_rounds。展示层（`formatEvaluationReport`）容错：字段缺失时按 0 处理。

## 5. 成功标准

### 5.1 功能验收

- [ ] `runPatch` 在 patch loop 协议下端到端跑通（dsh 自身仓库自托管 ≥1 任务）
- [ ] 单文件任务：1-3 轮完成（1 轮 change + 1 轮 done，可能含 1 轮 tool）
- [ ] 多文件任务：N + 1 ~ N×3 轮完成（每文件 1-3 轮 + 最后 done）
- [ ] `<DONE/>` 块被正确识别终止循环
- [ ] 多变更块违规、跨文件变更块被识别为 invalid 并提示重试
- [ ] task-state.json 含完整 patch_rounds 数组、可被 readTaskState 解析
- [ ] 现有 ≥386 测试继续通过（patch-parser 测试需新增 ≥10 个 v0.4 用例）

### 5.2 行为验收（benchmark 数据）

跑 `loam-bugfix-cli-error-handling`（3 文件）+ `loam-test-distill-engine`（1 文件）+ `pi-bugfix-count-defs`（1 文件）至少 3 次：

- [ ] 3 文件任务完成率 ≥ 67% (≥2/3 次正确改完 3 文件)
- [ ] 1 文件任务完成率 ≥ 95%（不退化）
- [ ] 工具调用平均轮数不超过 v0.3 基线 + 50%
- [ ] 单 fixture API 调用次数 ≤ 30 轮
- [ ] partial_ok（部分成功）案例 verify 阶段能进入 repair（不再静默失败）

### 5.3 性能验收

- [ ] 单次 fixture 总耗时 ≤ v0.3 基线 × 2.5（patch loop 必然增加 API 往返）
- [ ] 单次 fixture token 总成本 ≤ v0.3 基线 × 3
- [ ] 失败模式从「parse failed throw 早终」转为「patch_failed 进 repair」（兜底机会）

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| API 调用次数增加 N 倍，成本上升 | 高 | 中 | 用 `MAX_PATCH_ROUNDS=30` + token budget 双重控制；benchmark 跟踪成本曲线 |
| 模型不熟悉新协议，前几次 fixture 全 invalid | 中 | 高 | prompt 含详细示例 + 第 1 次 invalid 不计入连续 invalid 计数；fallback 路径：连续 invalid 5 次后切回 v0.3 prompt 单轮 |
| `parseChanges` 与 `parsePatchTurn` 双逻辑增加维护成本 | 中 | 中 | parseChanges 仅用于 repair；新增 ADR 记录二者边界；后续 v0.5 一并切换 repair 后删除 parseChanges |
| benchmark 评分体系改动大 | 中 | 中 | partial_ok 单独计分；与 v0.3 报告并存对比；分阶段切换 |
| 增量 apply 后某轮 patch 失败导致后续 patch 行号错位 | 中 | 高 | 优先建议模型用 `<PATCH type="search">`（SEARCH/REPLACE，不依赖行号）；prompt v0.4 把它列为多文件首选 |
| `<DONE/>` 模型乱用 / 提前退出 | 中 | 中 | scope-completeness check 在 verify 层兜底（D 必选）；done 后 plan.files 未覆盖 → verification_failed → repair |
| 重构破坏现有测试 | 高 | 中 | 分 6 个 phase 逐步切换（见 plan）；每 phase 后跑全量测试 |

## 7. 实施策略

### 7.1 分 6 个 Phase

| Phase | 目标 | 关键产物 |
|-------|------|---------|
| **P1** | task-state schema 扩展 | patch_rounds 字段、partial_ok 枚举、patch_failed 状态、向后兼容测试 |
| **P2** | parsePatchTurn 实现 | 新解析器 + ≥15 测试用例（含 invalid 路径） |
| **P3** | PATCH_PROMPT v0.4 + buildSystemPrompt 路由 | 新 prompt 字符串、估算 token 数 |
| **P4** | runPatch 循环重写 | pipeline.ts 主循环；保持 runPlan/runVerify/runRepair 接口不变 |
| **P5** | benchmark-runner 适配 | 读 patch_rounds、scope-completeness check（D）、formatEvaluationReport 加 patch_rounds 报表 |
| **P6** | 自托管端到端验证 + benchmark 对比 | dsh 仓库 1 任务跑通；3 fixtures × 3 次 benchmark 数据 vs v0.3 基线 |

### 7.2 回退策略

如果 P6 数据显示 v0.4 显著退化（完成率 < v0.3 -10%）：
- 回退方案：保留所有 schema 字段（向后兼容），把 PATCH_PROMPT 切回 v0.3，pipeline.ts 加 env flag `DSH_PATCH_PROTOCOL=v0.3` 选 batch 模式
- 不再删除 v0.3 protocol，保留作为对照
- 单独 spec 分析为何 v0.4 没跑通

### 7.3 与其他工作的关系

- **依赖**：基于 da7c554（工具采纳率修复）+ 当前会话已修的 Bug A/C
- **阻塞**：BLUEPRINT Phase 2 退出条件中「v0.3 协议操作覆盖率」需要重写为「v0.4 协议覆盖率」；多仓库/多语言验证需在 v0.4 上重新跑
- **解锁**：BLUEPRINT Phase 4 Agent Loop 的雏形；v0.5 可把 repair-loop 也切换到 v0.4

## 8. 不在本 spec 范围

- repair-loop 协议升级（独立 spec，待 v0.4 数据驱动）
- exec_shell allow-list 调整（Bug D，独立 task，与本 spec 协同）
- 流式输出（BLUEPRINT Phase 5）
- TUI（BLUEPRINT Phase 6）
- MCP / 多 Provider（BLUEPRINT Phase 7）

## 9. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-05 | v1.0 (draft) | 初始 spec：从 batch 协议切换到 patch loop，含 6 phase 实施计划与回退策略 |
