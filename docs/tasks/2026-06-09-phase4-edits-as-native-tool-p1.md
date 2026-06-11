---
id: "phase4-edits-as-native-tool-p1"
status: done
priority: p0
type: deferred
spec_ref: "docs/specs/2026-05-20-edits-as-native-tool.md"
dependencies: ["phase4-agent-loop"]
created: "2026-06-09"
updated: "2026-06-11"
assignee: "ai"
---

# Phase 4 Route X P1: apply_patch 工具通道最小切片

## Objective
在 feature flag 保护下，把 patch 阶段的文件编辑接入 DeepSeek-native `apply_patch` tool_call 通道，同时保留 content-XML 作为默认回退路径。

## Context
2026-06-09 核验结果：

- 实施前 `ToolName` 只有 `read_file` / `grep_files` / `exec_shell`。
- 实施前 patch phase policy 只暴露 `read_file` / `grep_files`。
- 实施前 `tool-executor.ts` 仍把写文件工具判为未知/错误，并引导模型回到 content change block。
- provider 已支持 `tools` / `tool_calls`，provider 层不是 blocker。
- Phase 3 final baseline `260521151313` 已退出阶段：168 trials，Project Card on `64/84 = 76.2%`。Route X 当前目标不是修单一 fixture，而是消除编辑动作仍走 content-XML 的通道分裂。

## Acceptance Criteria
- [x] 新增 `PATCH_EDITS_AS_NATIVE_TOOL` / `patch.edits_as_native_tool` flag，默认 `false`。
- [x] flag off 时 patch phase 不暴露 `apply_patch`，content-XML 路径行为保持当前 baseline。
- [x] flag on 时 patch phase 暴露单一 `apply_patch` 工具，支持 `CREATE` / `PATCH` / `SEARCH_REPLACE` / `INSERT` / `DELETE` / `RENAME`。
- [x] 单个 `apply_patch` tool_call 转为现有 `SingleChange` 并通过 `applySingleChange`、checkpoint/rollback、coverage validator 和 managed_files 路径应用。
- [x] 多个 edit tool_calls、edit + read/grep 混合、edit + content change block 均 invalid，且不写文件。
- [x] patch round telemetry 记录编辑来源，并保留 `actualProtocolOps` / `dsml_salvage_applied` 口径。
- [x] flag on 时 patch prompt 切换为 native edit contract，要求编辑轮使用 `apply_patch` 而不是 content-XML change block。
- [x] native edit 模式下，探索停滞保护只暂停 read/grep 等探索工具，不关闭 `apply_patch` 编辑通道。
- [x] `pnpm run scan` 通过。

## Implementation Notes
- `packages/core/src/tool-definitions.ts`: 新增 `apply_patch` JSON schema；默认 `getToolPolicy("patch")` 不暴露，只有 opt-in 才暴露。
- `packages/core/src/patch-pipeline.ts`: 新增 `editsAsNativeTool` flag 解析、`apply_patch` tool_call 转 `SingleChange`、混合调用拒绝、tool result 回写和 `change.source` telemetry。
- `packages/core/src/patch-pipeline.ts`: post-prompt A/B 后补 `apply_patch` 参数兼容，直接构造 `ChangeBlock`，接受常见 operation alias / inference，并允许 structured INSERT anchor 含引号或换行。
- `packages/core/src/prompt-builder.ts` / `packages/core/src/pipeline.ts`: flag on 时切换 native edit prompt，并用同一 flag 同步控制工具暴露。
- `packages/core/src/patch-pipeline.ts`: native edit 模式下，analysis-paralysis guard 暂停探索工具时仍保留 `apply_patch`，避免运行时关掉唯一编辑通道。
- `packages/core/src/patch-pipeline.ts`: invalid native edit round 记录脱敏后的 tool-call arguments，便于下一轮 benchmark 追踪真实参数形态；大段 edit payload 只记录长度。
- `packages/core/src/tool-executor.ts`: generic executor 明确拒绝执行 `apply_patch`，防止绕过 patch pipeline 写文件。
- `packages/eval/src/benchmark-runner.ts` / `scripts/benchmark-pie-replicated.ts`: replicated benchmark metadata/report 记录 `patch.edits_as_native_tool` flag，并保留 native edit observability 与 invalid tool-call argument summaries，供后续 A/B 区分 successful native apply、apply error 与 invalid attempts。
- 验证：`pnpm --filter @dsh/core typecheck`、`pnpm --filter @dsh/core test`、`./packages/core/node_modules/.bin/tsx --test scripts/benchmark-pie-replicated.test.ts`、`pnpm run scan`。

## Non-goals
- 不删除 content-XML 协议。
- 不默认开启 `apply_patch` 工具通道。
- 不恢复 code-result deterministic assertion repair。
- 不新增 fixture-specific hint。
- 不做子 Agent / repair 内联 patch / TUI。

## Validation Plan
- Unit: `tool-definitions` / policy flag 测试。
- Unit: `apply_patch` 参数到 `SingleChange` 的 6 op 转换测试。
- Unit: mixed tool_calls / 多 edit tool_calls / edit + content block 拒绝测试。
- Integration: `patch-pipeline` flag on/off 测试，确认 flag off 字符级走旧路径。
- Gate: `pnpm run scan`。

## Evidence Plan
本 task 只完成最小 runtime 切片，不宣称 benchmark 提升。完成后启动 ledger §8 `edits-as-native-tool-benchmark`：先 loam-refactor targeted N>=3 A/B，再决定是否扩大到 28 fixture N>=3。

## Evidence Update (2026-06-09)
- Baseline: `docs/reports/runlogs/260609121703-pie-replicated/`, `PATCH_EDITS_AS_NATIVE_TOOL=false`, 16/18 total, Card ON 9/9, Card OFF 7/9, `repair_exhausted=2`.
- Experiment: `docs/reports/runlogs/260609132227-pie-replicated/`, `PATCH_EDITS_AS_NATIVE_TOOL=true`, 18/18 total, Card ON 9/9, Card OFF 9/9, no failed trials.
- Tracked report: `docs/reports/knowledge/20260609-route-x-native-edit-ab.md`.
- Boundary: both runs recorded 0 native `apply_patch` tool calls. The result is valid no-regression evidence for exposing the tool definition, but not proof that the native edit execution path is being used by the model.
- Follow-up implementation: native edit prompt contract and paused-exploration behavior have been wired after this A/B. Keep default off and continue under ledger §8 until a new targeted A/B shows actual native `apply_patch` calls plus no regression.

## Evidence Update 2 (2026-06-09)
- Baseline: `docs/reports/runlogs/260609145253-pie-replicated/`, `PATCH_EDITS_AS_NATIVE_TOOL=false`, 18/18 total, Card ON 9/9, Card OFF 9/9.
- Experiment: `docs/reports/runlogs/260609155633-pie-replicated/`, `PATCH_EDITS_AS_NATIVE_TOOL=true`, 17/18 total, Card ON 9/9, Card OFF 8/9.
- Boundary: native attempts appeared, but successful native `apply_patch` applications remained 0; 9 native `apply_patch` rounds were invalid across 6 trials.
- Failure: the single failed trial was `loam-refactor-reorganize-tests` / `card_off` / `rep=0`, with `model_protocol_plan_invalid` before patching.
- Follow-up implementation: `apply_patch` args now build `ChangeBlock` directly, support operation aliases/inference and preserve native tool records in benchmark observability. This was superseded by Evidence Update 3.

## Evidence Update 3 (2026-06-10)
- Baseline: `docs/reports/runlogs/260609173815-pie-replicated/`, `PATCH_EDITS_AS_NATIVE_TOOL=false`, 17/18 total, Card ON 8/9, Card OFF 9/9.
- Experiment: `docs/reports/runlogs/260610024705-pie-replicated/`, `PATCH_EDITS_AS_NATIVE_TOOL=true`, 17/18 total, Card ON 9/9, Card OFF 8/9.
- Native adoption: flag-on recorded 72 `apply_patch` tool calls, 68 successful native apply records, 4 apply error records, 7 invalid native rounds, and 0 content-XML change records.
- Boundary: targeted adoption and aggregate no-regression are proven, but default remains off. Remaining work is broader/stability evidence plus invalid/error and plan-contract failure reduction.
- Follow-up: `260610024705` did not retain invalid argument shapes, so local telemetry now preserves redacted invalid `apply_patch` arguments for the next run; this is an observability fix, not new benchmark evidence.
- Excluded partials: `260609165914` (interrupted baseline partial), `260609200316` (interrupted flag-on partial), and `260610024543` (accidental full-shape partial) are not used as A/B conclusions.

## Evidence Update 4 (2026-06-10)
- Precondition: `pnpm -r run build` was required before benchmark because workspace package `main` fields point to `dist`; pre-build run `260610144529` is excluded from current-code telemetry evidence.
- Experiment: `docs/reports/runlogs/260610153758-pie-replicated/`, `PATCH_EDITS_AS_NATIVE_TOOL=true`, 18/18 total, Card ON 9/9, Card OFF 9/9.
- Native adoption: 76 `apply_patch` tool calls, 67 successful native apply records, 9 apply error records, 5 invalid native rounds, and 0 content-XML change records.
- Invalid argument telemetry is now present in benchmark results. Observed invalid native rounds were dominated by terminal intent expressed as tool args, e.g. `protocol_op: "DONE"` and `protocol_op: "<DONE/>"`.
- Boundary: this is strong targeted flag-on evidence, but it is not a default-on decision. Default remains off until broader/stability evidence and invalid/error reduction are reviewed in the ledger.

## Implementation Update 5 (2026-06-11)
- Residual convergence slice: native `apply_patch` failures now persist `error_class` in patch-round tool records and return `error_class` + `hint` in tool results. This turns the previous undifferentiated apply-error count into auditable classes such as `create_target_exists`, `patch_apply_failed`, and `invalid_protocol_op`.
- Terminal intent: `apply_patch` arguments with `protocol_op: "DONE"` or `protocol_op: "<DONE/>"` are treated as done intent, so covered runs can terminate instead of accumulating invalid native rounds.
- Reporting: `scripts/benchmark-pie-replicated.ts` now emits a Native Edit Error Classes table in `summary.md`.
- Local verification: `pnpm --filter @dsh/core test -- patch-pipeline.test.ts prompt-builder.test.ts`, `pnpm --filter @dsh/eval test -- benchmark-runner.test.ts`, `./packages/core/node_modules/.bin/tsx --test scripts/benchmark-pie-replicated.test.ts`, `pnpm -r run build`, `./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts`, `git diff --check`, and `pnpm run scan` passed.
- External benchmark status: targeted DeepSeek rerun was not completed in this slice. The sandbox blocked `tsx` IPC (`listen EPERM`), and the required escalated rerun was rejected by policy because it would send repository/task context to the external DeepSeek API. A rerun requires explicit user approval after that data-transfer risk is acknowledged.

## Evidence Update 6 (2026-06-11)
- Authorization: user explicitly allowed the external DeepSeek benchmark after the data-transfer risk was stated.
- Experiment: `docs/reports/runlogs/260611121509-pie-replicated/`, `PATCH_EDITS_AS_NATIVE_TOOL=true`, 18/18 completed, Card ON 9/9, Card OFF 7/9.
- Native adoption: 70 `apply_patch` tool calls, 67 successful native apply records, 3 apply error records, 2 invalid native rounds, and 0 content-XML change records.
- Residual impact: `protocol_op: "DONE"` / `"<DONE/>"` no longer appears as a native invalid/error class. Remaining native error classes were `invalid_patch_payload` (2) and `apply_failed` (1).
- Residual failures: both failed trials were `loam-refactor-provider-dedup` Card OFF `repair_exhausted`; they changed `shared.ts` and `openai-compatible.ts` but did not cover `anthropic.ts`.
- Boundary: this validates the residual error-class slice, but it is not a default-on decision. Default remains off until provider-dedup repair convergence and broader/stability evidence are reviewed.

## Implementation Update 7 (2026-06-11)
- Provider-dedup repair slice: failed structured assertion target files are now explicitly repair-authorized even when the original plan omitted them.
- Final repair request now merges prior missing targets with active failed assertion target files, so a tool-budget pause does not drop `anthropic.ts` from the no-tools repair instruction.
- A repair response with no actionable change block now gets one additional no-tools retry that explicitly requires a concrete change block for the failed assertion target.
- Boundary: deterministic code-result assertion repair remains unregistered by default; this slice changes repair orchestration/prompt contract only and adds no fixture-specific code synthesis.
- Local verification: `pnpm --filter @dsh/core test -- repair-loop-prompt.test.ts pipeline.test.ts`, `pnpm --filter @dsh/core typecheck`, `pnpm -r run build`, `git diff --check`, `./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts`, and `pnpm run scan` passed before the focused external reruns.

## Evidence Update 8 (2026-06-11)
- Command shape: `PATCH_EDITS_AS_NATIVE_TOOL=true ./packages/core/node_modules/.bin/tsx scripts/benchmark-pie-replicated.ts --filter=loam-refactor-provider-dedup --reps=3 --seed=26060901 --lanes-per-repo=1`.
- Audit caveat: these focused reruns were diagnostic runs from a dirty local tree based on commit `5493444`; use them to classify residual behavior, not as default-on release evidence.
- `docs/reports/runlogs/260611132524-pie-replicated/`: Card ON 2/3, Card OFF 3/3, failure class `repair_exhausted` 1 on Card ON.
- `docs/reports/runlogs/260611140036-pie-replicated/`: Card ON 3/3, Card OFF 2/3, failure class `repair_exhausted` 1 on Card OFF.
- `docs/reports/runlogs/260611143551-pie-replicated/`: Card ON 2/3, Card OFF 3/3, failure class `repair_exhausted` 1 on Card ON.
- Interpretation: the target authorization/final-target/no-change retry changes improved the original Card OFF omission pattern in some samples, but did not produce stable 6/6 convergence. The residual is now repair empty/no-change behavior despite known failed assertion targets, not lack of native edit adoption.
- Boundary: keep `patch.edits_as_native_tool` default off. Next work should harden repair structured output/empty-response telemetry before another broader benchmark.
