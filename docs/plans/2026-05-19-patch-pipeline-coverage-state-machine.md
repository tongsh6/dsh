# Patch Pipeline Coverage State Machine — 实现计划

> 状态: draft | 日期: 2026-05-19 | 对应 spec: `docs/specs/2026-05-19-patch-pipeline-coverage-state-machine.md`
>
> 分支: `feat/patch-coverage-state-machine`（commit 1 已为 fixture 修正 `56ee778`）

## 1. 文件映射

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/core/src/plan-file-contract.ts` | 新增 | PlanFileContract v2 类型、`buildPlanFileContract`、`normalizePath` |
| `packages/core/src/plan-file-contract.test.ts` | 新增 | 契约 / adapter / normalize 单测 |
| `packages/core/src/patch-coverage.ts` | 新增 | `PatchCoverageValidation` 类型、`validatePatchCoverage`、`computeCoverageDelta` |
| `packages/core/src/patch-coverage.test.ts` | 新增 | coverage validator 单测 |
| `packages/core/src/patch-pipeline.ts` | 新增 | patch 状态机 v2：`runPatchPipeline` / explore / finalization / validate / decide |
| `packages/core/src/patch-pipeline.test.ts` | 新增 | 状态机 / DONE 语义 / finalization / card_off regression 单测 |
| `packages/core/src/task-state.ts` | 修改 | `TaskStatus` 加 `patch_partial`；`VALID_TRANSITIONS` 加边；`patchRecordSchema` 加结构化字段 |
| `packages/core/src/pipeline.ts` | 修改 | `runPatch` 按 flag 分派新状态机；`runRepair` 入口守卫接受 `patch_partial`；legacy loop 保留 |
| `packages/core/src/repair-loop.ts` | 修改 | repair 消费 `missing_required_files` 作为权威补全输入 |
| `packages/repo/src/config-loader.ts`（或实际 config 模块） | 修改 | 4 个 feature flag 的 schema + env 覆盖 |
| `packages/core/src/index.ts` | 修改 | 导出新增公共类型 / 函数 |
| `packages/eval/src/benchmark-runner.ts` | 修改 | `writeDshConfig` 透传 flag；`TaskResult` 记录 `patch_partial` / coverage telemetry |
| `docs/project-ledger.md` | 修改 | §8 登记 §10 跟踪事项；进行中事项更新 |

> Commit 3 落地前确认：状态机放新模块 `patch-pipeline.ts`，`runPatch` 保留为 `pipeline.ts` 的薄分派入口；legacy loop 不迁移、不删除。

## 2. 分阶段任务

### Commit 1 — PlanFileContract v2

- [ ] 新增 `plan-file-contract.ts`：`PlanFileRole` / `PlanFileConfidence` / `PlanFileContractSource` / `PlanFileContractEntry` / `PlanFileContract` 类型
- [ ] `normalizePath`：posix 分隔符、去前导 `./`、折叠冗余段；不大小写折叠
- [ ] `buildPlanFileContract`：显式 v2 优先；否则 legacy adapter → `required_target` / `medium` / `legacy_files`
- [ ] path normalize 后去重、保序
- [ ] `plan-file-contract.test.ts`：legacy adapter（medium / legacy_files / strictFailureEligible 前置）、normalize、dedupe
- [ ] `pnpm --filter @dsh/core test` + `pnpm run scan`

### Commit 2 — PatchCoverageValidator

- [ ] 新增 `patch-coverage.ts`：`PatchCoverageValidation` 类型、`validatePatchCoverage`、`computeCoverageDelta`
- [ ] coverage 只认实际 applied diff；no-op / 未 apply 不计；重改已覆盖不计新进度
- [ ] `fullRequiredCoverage` 只看 required；optional / context 不阻断
- [ ] `strictFailureEligible`：全部 required entry `explicit_v2 + high` 才 true
- [ ] `patch-coverage.test.ts`：context 不要求 coverage、optional 不阻断、重改/改非计划文件不算进度、覆盖新 required 才重置
- [ ] `pnpm --filter @dsh/core test` + `pnpm run scan`

### Commit 3 — patch 状态机 v2

- [ ] `task-state.ts`：`TaskStatus` 加 `patch_partial`；`VALID_TRANSITIONS` 加 `patch_partial` 入边/出边；`patchRecordSchema` 加 `coverage` / `covered_required_files` / `missing_required_files` / `coverage_finalization_attempted` / `plan_file_contract_version` / `patch_partial_reason`
- [ ] 新增 `patch-pipeline.ts`：`runPatchPipeline` + `runPatchExplore` + `validatePatchCoverage` 接线 + `decidePatchResult`
- [ ] `PatchLoopState` + coverage progress stall（只有覆盖新 required 才重置）
- [ ] DONE 语义重写：删除「未覆盖即 accept」出口，DONE 必过 validator
- [ ] `pipeline.ts`：`runPatch` 按 `PATCH_STATE_MACHINE_V2` 分派；legacy loop 保留；`runRepair` 守卫接受 `patch_partial`
- [ ] `patch-pipeline.test.ts`：DONE-with-missing 进 finalization、coverage progress stall、状态机转移
- [ ] `pnpm --filter @dsh/core test` + `pnpm run scan`

### Commit 4 — coverage_finalization

- [ ] `maybeRunCoverageFinalization` / `shouldEnterCoverageFinalization`（§5 触发条件 + 阈值常量）
- [ ] finalization 调用：no-tools（不传 tool definitions）
- [ ] orchestrator 注入 `missingRequiredFiles` 内容，`maxBytesPerFile = 20_000` 截断 + 标注
- [ ] finalization 输出 DONE 仍跑 validator；invalid / no-op / 仍 missing → `patch_partial` / needs_repair
- [ ] `repair-loop.ts`：repair 消费 `missing_required_files` 作为权威补全输入
- [ ] 单测：finalization 成功救回、finalization no-op/invalid → `patch_partial`、DONE-after-finalization → `patch_partial`
- [ ] `pnpm --filter @dsh/core test` + `pnpm run scan`

### Commit 5 — telemetry / flags / regression

- [ ] 4 个 feature flag：config schema + env 覆盖；默认值见 spec §4.9
- [ ] `PatchTelemetry`：TaskState 字段 + `.dsh/patch-coverage-telemetry.json` sidecar；只记 path/计数/状态/reason
- [ ] strict hard gate：四条件全满足才 `patch_partial`→`patch_failed`
- [ ] `benchmark-runner.ts`：`writeDshConfig` 透传 flag；`TaskResult` 记录 coverage 字段
- [ ] card_off regression test（spec §6.1 第 13 条）
- [ ] strict gate 单测：legacy 不 hard fail、explicit_v2 high 可 hard fail
- [ ] `docs/project-ledger.md` §8 登记跟踪事项；注释更新
- [ ] `pnpm run scan` 全绿

## 3. 验证方式

- 每个 commit：`pnpm --filter @dsh/core test`（局部）+ `pnpm run scan`（lint + typecheck + test 全量）。
- 全部 commit 完成后：`pnpm --filter @dsh/eval test`。
- 行为验收（独立步骤，不在本分支 commit 内）：定向 benchmark `loam-refactor*` × on/off × N≥3，对照 `260518171207` 基线（spec §6.2）。

## 4. 依赖关系

```
Commit 1 (contract)  ──┐
                       ├──> Commit 3 (状态机) ──> Commit 4 (finalization) ──> Commit 5 (flags/telemetry/regression)
Commit 2 (validator) ──┘
```

- Commit 1、2 互相独立，可并行实现，但都先于 Commit 3。
- Commit 3 依赖 1+2。
- Commit 4 依赖 3。
- Commit 5 依赖 4。
- 行为验收 benchmark 依赖 Commit 5 + fixture 修正 commit `56ee778`（已在本分支）。

## 5. 不在本计划范围

- card_on 类 correctness 失败修复（spec §2.2）。
- 外部 plan schema 升级到 v2（spec §10 `plan-file-contract-v2-schema`）。
- legacy patch loop 删除（spec §10 `patch-loop-legacy-coexist`，benchmark 稳定后再议）。
- Phase 4 Agent Loop。
