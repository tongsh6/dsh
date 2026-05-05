# Pipeline 自动终止 + 安全网（P1+P2 增量实施计划）

> 状态: draft | 日期: 2026-05-06 | 关联 Spec: `docs/specs/2026-05-05-patch-loop-architecture.md` §3.2 / §3.8
>
> 在 v0.4 的 patch loop 中增加两层代码控制的终止机制：pipeline 不再依赖模型判断"是否完成"，由代码层自动判断。

## 1. 目标

当前 patch loop 的终止取决于模型输出 `<DONE/>`。13 fixture 全量 benchmark 显示 DONE 率仅 38% —— 即使模型已经产出正确 change (如 loam-docs-provider-readme 在 round 14 改好了文件，但后面 16 轮不会停)。

根本原因已在根因分析中确认（第 7 条：自我终止是元认知任务，LLM 不擅长）。解决方式不是调 prompt，而是把终止决策从模型移到代码。

## 2. 两层改动

### 2.1 P2（安全网）— 连续 tools guard

**文件**: `packages/core/src/pipeline.ts`

pipelines.ts 已有的 `consecutiveInvalid` 计数器旁边，加 `consecutiveToolsOnly` 计数器：

```ts
const MAX_CONSECUTIVE_TOOLS_ONLY = 5;  // 连续 5 轮 tools 无 change → break
```

在 `case "tools"` 分支加：如果是 tools 且上轮也是 tools → 计数器自增。在 `case "change"` 分支重置。

循环外层 guard 已检查 `consecutiveInvalid`，加同样逻辑检查 `consecutiveToolsOnly`：

```ts
if (consecutiveToolsOnly >= MAX_CONSECUTIVE_TOOLS_ONLY) {
    break;
}
```

**改动量**：~5 行。

不补测试（loop guard 在 mock-driven pipeline.test.ts 已有测试模式，但 P2 触发需要 5 轮连续 tools 的 mock 序列，单独做一个 fixture 测试 ROI 低）。

### 2.2 P1（结构） — scope completeness guard + 进度反馈

**文件**: `packages/core/src/pipeline.ts`

在 `case "change"` apply 成功后（line ~384），注入进度反馈消息，同时做范围检查：

```ts
case "change": {
    // 现有 apply 逻辑不变
    const result = applySingleChange(cwd, action.change, !!dryRun);
    
    // 新增：注入进度反馈
    const planFiles = state.plan?.files ?? [];
    const patchedFiles = [...allChangedFiles]; // 已累积的
    const covered = planFiles.filter(f => patchedFiles.some(pf => pf === f || pf.endsWith(path.sep + f)));
    const uncovered = planFiles.filter(f => !covered.includes(f));
    
    const progressMsg = uncovered.length > 0
        ? `✓ change applied: ${action.change.file} (op=${action.change.op})\n进度: plan.files 覆盖 ${covered.length}/${planFiles.length} (剩余: ${uncovered.join(", ")})`
        : `✓ change applied: ${action.change.file} (op=${action.change.op})\n进度: plan.files 已全部覆盖，可输出 <DONE/>`;
    
    messages.push({ role: "user", content: progressMsg });
    
    // 新增：全部覆盖 → 自动 break（替代 <DONE/>）
    if (uncovered.length === 0 && action.change.op !== "DELETE") {
        // files 全部已覆盖，本轮可以停
        // 已经注入"可输出 DONE"消息，给模型一轮机会自动 DONE
        // 但不再等它——下轮如果是 tools 且无新 change，由 tools guard 兜底
    }
}
```

关键设计：**不做硬中断**，而是注入进度信息让模型看到。如果模型仍不 DONE，tools guard（P2）兜底。

**改动量**：~30 行。

### 2.3 测试

`pipeline.test.ts` 加 1-2 个 mock 测试覆盖：
- 模型做 5 轮 tools 无 change → 自动 break （测试 P2 触发）
- 模型做出 change 覆盖所有 plan.files → 下一轮自动停止（可选，需要 mock 序列匹配进度注入）

### 2.4 不做的

- 不改 prompt（PATCH_PROMPT_V4 不变）
- 不改 parser（parsePatchTurn 不变）
- 不改 schema（task-state 不变）
- 不改 benchmark-runner（不涉及）

## 3. 验证

```bash
pnpm --filter @dsh/core run typecheck
pnpm --filter @dsh/core run test    # 314+ → 约 316
pnpm run scan
./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts
```

行为验证：跑 `--filter=loam-bugfix-cli-error-handling` 看是否不会 30 轮耗尽——tools guard 应在 5 轮无新 change 后自动 break。

## 4. 依赖关系

P2 和 P1 是独立的，可一起实施（同一文件不同段）。推荐顺序：先写 P2（3 行代码），再写 P1（~30 行），再跑 scan 确认。

## 5. 不在本 plan 范围

- 上下文 compaction（P3）——独立 task
- `complete_task` 工具（P0）——不做
- stateless 改造（P4）——不做
- prompt 调优 —— 已有 benchmark 数据证明 prompt 不是根因
