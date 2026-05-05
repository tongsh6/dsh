# 工具采纳率修复诊断闭环

> 日期: 2026-05-04 | 关联 commit: `da7c554`（修复）, 待提交（统计修复）
>
> 本文档记录从「报告显示工具零调用」到定位真因为「benchmark-runner 统计 bug」的完整诊断过程。

## 1. 起点

`docs/reports/260504-173531/`（commit `da7c554`，单 fixture `loam-bugfix-cli-error-handling`）报告：

- 工具调用 0 次
- 任务 parse failed
- 完成 ✗

字面读：工具采纳率修复（spec `2026-05-04-tool-adoption-fix.md`）未生效。

## 2. 三层诊断

### 2.1 探针 A — DeepSeek API 是否支持 function calling

`scripts/diagnose-tool-calls.ts` 用最简 system + 强引导 user message：

| 探测 | finish_reason | tool_calls |
|------|--------------|-----------|
| tools + thinking | tool_calls | ✓ 1 个 read_file |
| tools, no thinking | tool_calls | ✓ 1 个 read_file（缓存命中） |
| no tools, thinking | stop | 模型自己捏造 `<tool_call>` 假 XML |

**结论**：API + provider 完全正常。

### 2.2 探针 B — 真实 PATCH_PROMPT 是否阻断工具调用

`scripts/diagnose-real-prompt.ts` 用 `buildSystemPrompt('patch')`（6.3K 字符）+ 极简 user message：

- 模型立刻返回 1 个 `read_file` tool_call

**结论**：6K 字符的 PATCH_PROMPT 没有淹没工具引导。

### 2.3 探针 C — 复刻 benchmark 真实调用

`scripts/diagnose-realistic-patch.ts` 完全复刻 `runPatch` 的 prompt 装配（4 层 context、loadTopFiles top 10、fixture taskPrompt），单次 client.chat：

- system=6294 chars, user=62028 chars, total=68K
- finish_reason: tool_calls
- 返回 **3 个 read_file**（capture.ts / distill.ts / daemon.ts）

**结论**：68K 长 prompt + 含完整文件内容的 user message 下，模型仍然主动调工具。

### 2.4 直查 disk

`~/dsh-bench/repos/loamlog/.dsh/task-state.json`：

```
status: planned
patches: 1 [(round=1, apply_status='failed', patch='<empty>')]
tool_rounds: 5 轮，11 次调用：
  round 1: 3 × read_file (capture.ts / distill.ts / daemon.ts)
  round 2: 2 × grep_files (LLMAuthError 等错误类)
  round 3: 2 × read_file (core/index.ts L580+, daemon.ts)
  round 4: grep_files + read_file (CLI 入口)
  round 5: grep_files + read_file (CLI index.ts)
```

**事实**：工具采纳率修复实际生效，模型主动调用了 11 次工具进行深入代码探索。

## 3. 根因定位

`packages/eval/src/benchmark-runner.ts` 旧代码（修复前）：

```ts
try {
  state = await runPatch({...});         // 当 patch 应用失败时抛 throw
  result.toolRounds = state.tool_rounds?.length ?? 0;  // 永远到不了
  result.toolCalls = ...;                              // 永远到不了
  // ...
} catch (err) {
  result.error = err.message;             // 只设了 error，忽略 disk 上的 task-state
}
```

`pipeline.ts:508-512` 在 patch apply failed 时先 `writeTaskState(cwd, state)` 把 5 轮 tool_rounds 写盘，然后 `throw new Error("变更应用失败 — ...")`。benchmark-runner 的 catch 块没有读这份 disk 状态，导致 results.json/report.md 把所有 patch-failed fixture 都误报成 `toolRounds: 0`。

历史的 260504-140432 报告（commit c86e790, 工具系统提交之前）和 260504-173531（commit da7c554）都受此 bug 影响 —— 任何 patch 失败的 fixture 工具统计都不可信。

## 4. 修复

`packages/eval/src/benchmark-runner.ts` catch 块加 5 行：从 disk 读 task-state，恢复 toolRounds / toolCalls / filesChanged / actualProtocolOps：

```ts
} catch (err) {
  result.completed = false;
  result.error = err instanceof Error ? err.message : String(err);
  const stateOnDisk = readTaskState(repoPath);
  if (stateOnDisk) {
    result.toolRounds = stateOnDisk.tool_rounds?.length ?? 0;
    result.toolCalls = (stateOnDisk.tool_rounds ?? []).flatMap((tr) =>
      tr.calls.map((c) => ({ name: c.name, status: c.status })),
    );
    const lastPatch = stateOnDisk.patches.at(-1);
    if (lastPatch) {
      result.filesChanged = lastPatch.files_changed;
      result.actualProtocolOps = detectProtocolOpsFromText(lastPatch.patch);
    }
  }
}
```

## 5. 修复验证（本目录 260504-183633）

重跑同一 fixture：

| 指标 | 修复前 (260504-173531) | 修复后 (260504-183633) |
|------|----------------------|----------------------|
| commit | da7c554 | da7c554 |
| toolRounds | 0（误报） | **5** |
| toolCalls 次数 | 0（误报） | **12**（read_file × 6 + grep_files × 6） |
| 调用成功率 | N/A | **100%** |
| completed | false（误报） | **true** |
| filesChanged | (无) | **packages/cli/src/capture.ts** |
| actualProtocolOps | [] | **["PATCH"]** |
| 耗时 | 321s | 443s |

注：本次重跑模型未走到 patch apply failed 分支（成功路径），因此修复后的 catch 路径仍是代码评审通过、未实际触发执行。下次有 fixture 走 patch-failed 路径时可顺便验证。

## 6. 揭露的真实行为缺口（Bug B）

修复 Bug A 后看清楚的事实：

- 模型 5 轮 12 次工具调用 ✅ 全部成功，深入到 `packages/core/src/index.ts:580+` 验证错误类是否存在、grep 了 CLI 入口的命令调用方式
- 但最终输出的 patch **只改了 3 个目标文件中的 1 个**（capture.ts），distill.ts 和 daemon.ts 未动
- 因此 `testsPassed: false`，但 `repairRounds: 0` —— repair 也没跑（pipeline 流程中 verify 失败后应该自动进 repair；handoff 报「尚未初始化」也指向 .dsh 目录路径相关问题）

行为缺口候选：

1. PATCH_PROMPT/REPAIR_PROMPT 的「最后一轮 only XML」与「探索 1-2 次」之间没有「现在就是 final turn」的明确触发器，模型对何时停止工具循环的判断不稳定
2. 5 轮工具上限触发 force output 后，模型 token budget 被前面 19K+ 上下文挤压，输出能力下降
3. 多文件任务（一次涉及 3 个文件）的批量 patch 体量超过模型一次输出舒适区
4. 修复未触及的 handoff/repair 流程在 patch 部分应用时的状态机衔接

这些已超出当前 spec `2026-05-04-tool-adoption-fix.md` 范围，需要单独 spec。

## 7. 历史报告影响

| 报告 | 是否受 Bug A 影响 | 修复后该如何看待 |
|------|------------------|-----------------|
| `260502-211318` 等早期 | 是（patch-failed 项工具数被误报零） | 工具系统提交前，零调用本来就是事实，不影响结论 |
| `260502-234445` (8 fixtures, 75%) | 是 | 工具系统提交前；零调用是事实 |
| `compare-20260502-120419` (DSH vs OC) | 是 | 工具系统提交前；不影响对比结论 |
| `260504-140432` (commit c86e790) | 是 | commit 在工具系统提交之前；零调用是事实 |
| `260504-173531` (commit da7c554) | **是** | **本目录的诊断起点；零调用是 bug，实际 5 轮 11 次** |
| `260504-183633` (commit da7c554, 本目录) | 否 | 首份带可信工具统计的报告 |

后续所有 benchmark 报告均基于修复版 benchmark-runner，工具统计可直接采用。

## 8. 待办

- [ ] commit 修复（benchmark-runner.ts + scripts/diagnose-*.ts + 本 analysis.md + ledger 更新）
- [ ] 单开 spec 处理 Bug B（模型工具用对了但 patch 输出不完整）
- [ ] 更新 `docs/project-ledger.md` §2 已完成事项：工具采纳率修复 → 已验证（含本报告）
- [ ] 更新 `docs/project-ledger.md` §6 Top Priority：P0 由「跑 benchmark 验证工具采纳率修复」→「Bug B：多文件 patch 完整性」
