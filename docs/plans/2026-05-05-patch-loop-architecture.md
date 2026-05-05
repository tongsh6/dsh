# Patch Loop 架构（v0.4）实施计划

> 状态: draft | 日期: 2026-05-05 | Spec: `docs/specs/2026-05-05-patch-loop-architecture.md` v1.1
>
> 把 v0.4 patch loop 协议拆为 P1–P6 六个 Phase，按依赖顺序推进。每个 Phase 对应 1 个 task 卡片（`docs/tasks/2026-05-05-patchloop-pN-*.md`）。

## 总览

```
P1 schema ─┬─→ P2 parser ─┐
           │              ├─→ P4 pipeline ─→ P5 benchmark ─→ P6 e2e
           └──────────────┤   (uses 1+2+3)    (uses 1+4)
              P3 prompt ──┘
```

- **P1 / P3 独立**，可并行
- **P2 依赖 P1**（共用 schema 类型）
- **P4 依赖 P1 + P2 + P3**（pipeline 是装配点）
- **P5 依赖 P1 + P4**（benchmark-runner 读 schema 字段，触发 pipeline）
- **P6 依赖 P5**（端到端验证，最后一步）

P1 + P3 可同 PR；P2 单独；P4 单独（核心改动）；P5 + P6 可同 PR。

---

## Phase P1: task-state schema 扩展

### Step P1.1: 新增 patchRoundSchema

**文件**: `packages/core/src/task-state.ts`

加 schema：
```ts
const patchRoundSchema = z.object({
  round: z.number(),
  action: z.enum(["tools", "change", "done", "invalid"]),
  tool_calls: z.array(toolCallRecordSchema).optional(),
  change: z.object({
    op: z.enum(["CREATE", "PATCH", "SEARCH_REPLACE", "INSERT", "DELETE", "RENAME"]),
    file: z.string(),
    apply_status: z.enum(["ok", "failed"]),
    apply_error: z.string().optional(),
    raw_block: z.string(),
  }).optional(),
  invalid_reason: z.string().optional(),
  reasoning_excerpt: z.string().optional(),
  duration_ms: z.number(),
});

// 顶层 taskStateSchema 加字段：
patch_rounds: z.array(patchRoundSchema).default([]),
```

### Step P1.2: 扩展 status 与 apply_status 枚举

`taskStateSchema.status` 加 `"patch_failed"` 值；状态机表：
```
"planned": ["patched", "patch_failed"],
"patch_failed": ["repairing", "repair_exhausted"],  // 直接进 repair 兜底
```

`patchRecordSchema.apply_status` 加 `"partial_ok"` 值。

### Step P1.3: 导出新类型

`task-state.ts` 顶部导出：
- `PatchRoundRecord` (z.infer of patchRoundSchema)
- 同时 `index.ts` 加 export

### Step P1.4: 测试（向后兼容 + 新字段）

`packages/core/src/task-state.test.ts` 加 ≥3 测试：
- 旧 task-state.json（无 patch_rounds）能被解析（zod default 兜底）
- 新 task-state.json 含 patch_rounds 数组能被解析
- patch_failed 状态可从 planned 转入

### 验证

```bash
pnpm --filter @dsh/core run typecheck
pnpm --filter @dsh/core run test
./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts
```

---

## Phase P2: parsePatchTurn 解析器

### Step P2.1: 新增 parsePatchTurn

**文件**: `packages/core/src/patch-parser.ts`

加 discriminated union 类型 + 函数：
```ts
type PatchTurnAction =
  | { kind: "tools" }
  | { kind: "change"; change: ChangeBlock }
  | { kind: "done" }
  | { kind: "invalid"; reason: string };

export function parsePatchTurn(content: string): PatchTurnAction;
```

校验规则（spec §3.5）：
- 0 个 change + 0 个 `<DONE/>` + caller 已知无 tool_calls → `invalid("no action")`
- ≥2 个 change → `invalid("multiple change blocks")`
- 1 个 change 跨多文件（unified diff `--- a/x` 出现 ≥2 个）→ `invalid("change block must target single file")`
- `<DONE/>` 出现 → `done`（同轮其他被忽略，记 invalid_reason 用于审计）

注意：tool_calls 信号在 chat response.choices[0].message.tool_calls 字段，调用方传给 parsePatchTurn 通过参数（避免在 parser 内重复 chat schema 知识）。

签名调整：
```ts
parsePatchTurn(content: string, hasToolCalls: boolean): PatchTurnAction;
```

### Step P2.2: 保留旧 parseChanges

旧 `parseChanges` 保留供 repair-loop 使用（spec §2.2 明确 repair 不动）。新 parser 与旧 parser 共存。

### Step P2.3: 单元测试

`packages/core/src/patch-parser.test.ts` 新增 ≥15 测试：
- 单个 CREATE 块 → `kind=change, op=CREATE, file=...`
- 单个 PATCH 块（含 unified diff）→ `change, op=PATCH`
- 单个 PATCH（type=search, SEARCH/REPLACE）→ `change, op=SEARCH_REPLACE`
- 单个 INSERT → `change, op=INSERT`
- 单个 DELETE → `change, op=DELETE`
- 单个 RENAME → `change, op=RENAME`
- `<DONE/>` 闭合自标签 → `done`
- `<DONE>...</DONE>` 开闭标签 → `done`
- DONE + 同轮变更块 → `done`，但 invalid_reason 记录"DONE present, change ignored"
- 0 块 + hasToolCalls=true → `tools`
- 0 块 + hasToolCalls=false → `invalid("no action")`
- 2 个 CREATE 块 → `invalid("multiple change blocks")`
- 1 个 PATCH 跨多文件（多个 `--- a/`）→ `invalid("multi-file")`
- 含 `<NOTE>...</NOTE>` 注释 → 注释被忽略，正确解析变更
- malformed unified diff → `invalid("unified diff parse failed")`

### Step P2.4: 导出

`patch-parser.ts` 加 export `parsePatchTurn`、`PatchTurnAction`、`ChangeBlock`；`index.ts` 同步。

### 验证

```bash
pnpm --filter @dsh/core run test  # ≥ 271 + 15 = 286 测试
```

---

## Phase P3: PATCH_PROMPT v0.4

### Step P3.1: 新增 PATCH_PROMPT_V4 字符串

**文件**: `packages/core/src/prompt-builder.ts`

按 spec §3.4 骨架写出新 prompt（中文备注允许，但 prompt 主体英文以匹配 DeepSeek 偏好）：
- Loop Protocol section（每轮三选一：tools / 1 change / DONE）
- Termination section（何时输出 DONE）
- Change Block Rules（保留 v0.3 的 6 操作格式描述）
- Tool Rules（保留 v0.3）
- After-Apply Feedback section（系统会反馈 ✓ applied / ✗ failed）

### Step P3.2: buildSystemPrompt 路由

```ts
export function buildSystemPrompt(phase: PromptPhase): string {
  if (phase === "plan") return PLAN_PROMPT;
  if (phase === "repair") return REPAIR_PROMPT;
  if (phase === "patch") return PATCH_PROMPT_V4;  // v0.4 硬切换，删 v0.3
  ...
}
```

旧 `PATCH_PROMPT`（v0.3）删除（不保留），与 spec §2.2 第 4 项「不做协议自动版本协商」一致。

### Step P3.3: token 估算

跑 `estimateTokens(PATCH_PROMPT_V4)` 与 v0.3 对比，记录到 plan 实施 notes。预期 v0.4 略短（少了大量 batch-mode 规则文本，多了 loop 描述）。

### Step P3.4: 测试

`packages/core/src/prompt-builder.test.ts`（如不存在则新建）测试：
- buildSystemPrompt("patch") 返回 v0.4 字符串（含 "DONE" 标记）
- buildSystemPrompt("plan") / ("repair") 不变

### 验证

```bash
pnpm --filter @dsh/core run test
grep -c "DONE" packages/core/src/prompt-builder.ts  # ≥ 2
grep -c "Loop Protocol" packages/core/src/prompt-builder.ts  # = 1
```

---

## Phase P4: runPatch 循环重写

### Step P4.1: runPatch 主循环

**文件**: `packages/core/src/pipeline.ts`

按 spec §3.2 重写：
```ts
const MAX_PATCH_ROUNDS = 30;
const CONTEXT_BUDGET_CHARS = 800_000;

while (round < MAX_PATCH_ROUNDS) {
  const response = await client.chat({ messages, tools, thinking });
  const choice = response.choices[0];
  const hasToolCalls = (choice.message.tool_calls?.length ?? 0) > 0;
  const action = parsePatchTurn(choice.message.content, hasToolCalls);

  switch (action.kind) {
    case "tools": /* execute, push results */ break;
    case "change": /* apply, push feedback */ break;
    case "done": /* break loop */ break;
    case "invalid": /* push correction message; if 3 consecutive → break with patch_failed */ break;
  }

  state.patch_rounds.push({...});
  writeTaskState(cwd, state);
  round++;

  if (totalCharCount(messages) > CONTEXT_BUDGET_CHARS) break;
}
```

### Step P4.2: 增量 apply 单 change

新辅助函数 `applySingleChange(cwd, change)`：复用现有 `applyChanges` 但只接受单 change。返回 `{ ok, error?, files_changed }`。

### Step P4.3: After-apply feedback message

每次 apply 后向 messages 推：
```ts
messages.push({
  role: "user",
  content: ok
    ? `✓ change applied: ${change.file} (op=${change.op}, +${added} -${removed} lines)`
    : `✗ change failed: ${error}`
});
```

### Step P4.4: PatchRecord 聚合

循环结束后，把所有成功的 `change` 合成一条 `PatchRecord` push 到 `state.patches`，apply_status:
- 全部 ok → `"ok"`
- 部分失败 → `"partial_ok"`
- 全部失败/无 change → `"failed"`

`files_changed` 去重合并。

### Step P4.5: 状态机

- ≥1 change apply ok → `transition(state, "patched")`
- 0 change ok → `transition(state, "patch_failed")`
- 然后正常进入 verify

### Step P4.6: 删除旧 batch 路径

删 v0.3 的 `MAX_TOOL_ROUNDS` 工具循环 + `parseChanges` 调用 + retry 路径（v0.3 retry 不再适用，因为单轮失败由下一轮自然修复）。

### Step P4.7: 测试

`packages/core/src/pipeline.test.ts` 加 ≥6 测试（用 mock client）：
- 单文件任务：1 轮 change + 1 轮 done → status=patched，patch_rounds=2
- 多文件任务：3 轮 change + 1 轮 done → status=patched
- 模型不出 done 但用满 30 轮 → status=patch_failed
- 模型连续 3 轮 invalid → status=patch_failed（早终）
- 工具调用穿插：tool round → change round → done → status=patched
- 单 change apply 失败：下一轮模型修复 → status=patched, partial_ok 不触发（因最终全部 ok）

### 验证

```bash
pnpm --filter @dsh/core run test
pnpm --filter @dsh/core run typecheck
```

---

## Phase P5: benchmark-runner 适配

### Step P5.1: 读 patch_rounds 字段

**文件**: `packages/eval/src/benchmark-runner.ts`

result 接口加：
```ts
patchRounds: number;
patchRoundActions: { round: number; action: string }[];
```

赋值（在 try 块成功路径 + catch 路径都做）：
```ts
result.patchRounds = state.patch_rounds?.length ?? 0;
result.patchRoundActions = (state.patch_rounds ?? []).map(r => ({
  round: r.round, action: r.action,
}));
```

### Step P5.2: scope-completeness check（spec §3.7 / §「§D 必选项」）

在 `runVerify` 调用之前 / 包装：
```ts
const planFiles = state.plan?.files ?? [];
const patchedFiles = state.patches.flatMap(p => p.files_changed);
const missing = planFiles.filter(f => !patchedFiles.includes(f));
if (missing.length > 0) {
  // 强制设 verification_failed，repair 兜底
  state = { ...state, status: "verification_failed" };
  writeTaskState(cwd, state);
}
```

实施位置：考虑放在 pipeline.ts 的 `runVerify` 入口（P5 task 内可以扩展到 pipeline 修改），而非 benchmark-runner 一侧——保证 scope check 是 pipeline 行为而非 benchmark 行为。

### Step P5.3: formatEvaluationReport 加 patch_rounds 报表

报告新增章节：
```
## Patch Loop 行为

| 指标 | 数值 |
|------|-----|
| 平均 patch round 数 | X.X |
| 平均 change 块数 | Y.Y |
| 平均 invalid 轮数 | Z.Z |
| done 主动终止率 | XX% |
```

### Step P5.4: 测试

`packages/eval/src/benchmark-runner.test.ts` 加 ≥3 测试：
- patchRounds 字段从 task-state 正确读取
- scope-completeness check 触发 verification_failed
- formatEvaluationReport 含新章节

### 验证

```bash
pnpm --filter @dsh/eval run test
pnpm run scan
```

---

## Phase P6: 端到端验证 + benchmark 对比

### Step P6.1: 自托管端到端

在 dsh 自身仓库新建 1 个 fixture（或复用 `dsh-test-scanner`），跑通完整 v0.4 流程（plan → patch loop → verify → handoff）。手动观测 task-state.json 中 patch_rounds 数组结构合理。

### Step P6.2: 同 fixture 对比 v0.3 基线

跑 3 个 fixtures（含 `loam-bugfix-cli-error-handling` 多文件）× 3 次：
- 完成率 ≥ 67%（多文件目标）/ ≥ 95%（单文件目标）
- 工具调用平均轮数 ≤ v0.3 基线 + 50%
- API 调用次数 ≤ 30 轮 / fixture
- 总耗时 ≤ v0.3 × 2.5

### Step P6.3: 对比报告

`docs/reports/<run_id>/patchloop-vs-batch.md` 详细对比 v0.4 vs v0.3 基线，结论 ship / 回退。
- 满足 spec §5.2 行为验收 → ship
- 不满足 → 触发 spec §7.2 回退（保留 schema 字段，PATCH_PROMPT 切回 v0.3，env flag 选 batch 模式）

### Step P6.4: 跟踪事项 status 转移

如果 P6 通过：
- `bug multi-file-patch-output-incomplete`（ledger §8）→ `resolved`
- `evidence patchloop-vs-batch-baseline` → `resolved`
- 复审 `deferred patchloop-repair-upgrade`：观察 repair 阶段是否也表现出多文件不完整；若是，启动；若否，更新 last_reviewed

### 验证

数据驱动，无 grep 自检。

---

## 文件变更汇总

| 文件 | Phase | 操作 | 预计行数 |
|------|-------|------|---------|
| `packages/core/src/task-state.ts` | P1 | 修改 | +60 |
| `packages/core/src/task-state.test.ts` | P1 | 修改 | +30 |
| `packages/core/src/index.ts` | P1 | 修改 | +2 |
| `packages/core/src/patch-parser.ts` | P2 | 修改 | +120 |
| `packages/core/src/patch-parser.test.ts` | P2 | 修改 | +200 |
| `packages/core/src/prompt-builder.ts` | P3 | 修改（重写 PATCH_PROMPT） | +100 / -120 净 -20 |
| `packages/core/src/prompt-builder.test.ts` | P3 | 新建 | +50 |
| `packages/core/src/pipeline.ts` | P4 | 修改（runPatch 重写） | +80 / -180 净 -100 |
| `packages/core/src/pipeline.test.ts` | P4 | 修改 | +120 |
| `packages/eval/src/benchmark-runner.ts` | P5 | 修改 | +60 |
| `packages/eval/src/benchmark-runner.test.ts` | P5 | 修改 | +60 |
| `docs/reports/<run_id>/patchloop-vs-batch.md` | P6 | 新建 | ~150 |
| **总计** | | | **~1000 行净增** |

## 验证方式

```bash
# 单 phase 验证
pnpm --filter @dsh/core run test    # P1/P2/P3/P4
pnpm --filter @dsh/eval run test    # P5

# 整体门禁
pnpm run scan
./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts

# 行为验证（P6）
./packages/core/node_modules/.bin/tsx run-benchmark.ts --filter=loam-bugfix-cli-error-handling
# 跑 3 次取平均
```

## 预计风险

| 风险 | 缓解 |
|------|------|
| 模型不熟悉 v0.4 协议，前几次 fixture 全 invalid | spec §6 风险表已覆盖；spec §7.2 回退方案兜底 |
| API 调用次数 ×N 倍，token 成本超预算 | MAX_PATCH_ROUNDS=30 + CONTEXT_BUDGET=800K 双重控制；P6 数据若超 v0.3 × 3 触发回退 |
| `parseChanges`（旧）+ `parsePatchTurn`（新）双逻辑 | 通过 P2 spec 明确边界；后续单独 spec 把 repair 也切到 v0.4 后删旧的 |
| benchmark-runner 字段变化破坏现有报告解析下游 | partial_ok 是新枚举值，下游需兼容；P5 加测试保证 |
| scope-completeness check 误伤（plan 写了文件但实际无需改）| 如果 plan files 实际不需要全改，模型在 done 后 verify 失败转 repair 是预期；不算误伤 |

## 不在本 plan 范围

- repair-loop 协议升级（ledger §8 deferred patchloop-repair-upgrade）
- 事务 rollback / stash-apply（ledger §8 deferred patch-loop-stash-rollback）
- 完整 Agent Loop（ledger §8 deferred phase4-agent-loop）

---

## 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-05 | v1.0 (draft) | 初始 plan：6 phase 拆分 + 文件映射 + 风险 |
