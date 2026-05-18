# Patch Pipeline Coverage State Machine SPEC

> 状态: draft | 日期: 2026-05-19 | 作者: 人类设计指令 + AI 落盘
>
> 目标: 把 patch loop 从「大 while + 多出口」的混合逻辑，重构为 contract-first /
> validator-driven / repair-aware 的 patch 状态机，使 patch 阶段的收口由
> **required target file coverage 的确定性验证**驱动，而不是由「模型还动不动得了」的
> 行为信号驱动。
>
> **关联文档:** BLUEPRINT §2.1（Phase 3 工具化收口）| CONSTITUTION 原则 1/2/3/5 |
> 前序 spec `docs/specs/2026-05-07-patch-completeness.md`、
> `docs/specs/2026-05-18-plan-contract-finalization.md`

## 1. 背景与问题

### 1.1 实证证据

runlog `docs/reports/runlogs/260518171207-pie-replicated/`，fixture `loam-refactor-provider-dedup`：

- **card_off**：`plan.files` 正确列出 3 个目标文件（`shared.ts` / `openai-compatible.ts` / `anthropic.ts`）。patch loop 跑满 30 轮（约 24 轮 `read_file`，仅 3 个 change block），**`anthropic.ts` 一个 change block 都没产出**。completeness 检测正确算出未覆盖并打印 `未修改: [anthropic.ts]`，但 loop 仍以「轮数耗尽」退出，状态转 `patched`。
- **card_on**：3 文件全覆盖，但 `anthropic.ts` 改错（无 `buildAuthHeaders`）+ `typecheck` 失败。属 correctness 问题，**不在本 spec 范围**（见 §2.2）。

### 1.2 根因：退出逻辑没有绑定 coverage

当前 patch loop（`pipeline.ts:866-1089`，`runPatch`）有 5 个出口：

| 出口 | 触发 | 是否看 coverage |
|------|------|----------------|
| 1 | `<DONE/>` 且全覆盖 | 看（仅作 gate） |
| 2 | `<DONE/>` 但有未覆盖 | 看了却 accept + 退出 |
| 3 | 连续 3 invalid | 不看 |
| 4 | 连续 N 轮 tools-only | 不看 |
| 5 | round == `MAX_PATCH_ROUNDS` | 不看 |
| 收尾聚合 | `okChanges > 0` | 不看（未覆盖也转 `patched`） |

只有出口 1 看 coverage，其余 4 条 + 收尾聚合（`pipeline.ts:1091-1150`）只判「模型是否还在动」。`consecutiveToolsOnly`（`pipeline.ts:862`）在**每个** change 清零，模型「挤牙膏」式每隔几轮交一个无关 change 即可永久绕过停滞红线。

**结论**：一个 required 文件可以从头到尾没被改，而 loop 照样「正常退出」为 `patched`，把不完整的 patch 当成功向下游传。

### 1.3 明确不该做的修法

- **只修 `consecutiveToolsOnly`**：治标。出口 2/3/5 + 聚合都不经过 coverage。
- **恢复「未覆盖 plan.files 即 `patch_failed`」硬门**：`patch-completeness` spec §3.3 试过，被议题 C 软化。原因（runlog `260509-040502`）是 `plan.files` 会多列根本不用改的文件，硬门会误伤、触发连续 invalid 被砍。
- **让模型自报 coverage**：不可信，不能作为真相。

## 2. 目标与非目标

### 2.1 目标

1. patch 阶段拆成显式状态：`patch_explore` → `coverage_finalization` → `patch_validate` → `decide_result`。
2. 引入**内部模型** PlanFileContract v2（required/optional/context 三角色 + confidence + source）。legacy `plan.files` 经 adapter 转成 medium-confidence required_target。
3. coverage 由 PatchCoverageValidator 基于**实际 applied diff** 确定性计算，不依赖模型自报。
4. `<DONE/>` 必须经过 coverage validator；未覆盖不能 clean accept。
5. 停滞 / `<DONE/>`-未覆盖 / 接近 maxRounds 时，进入 **no-tools** 的 `coverage_finalization`，由 orchestrator 主动注入缺失文件内容。
6. patch 结束仍缺 required 文件 → 返回结构化 `patch_partial` / needs_repair，不返回 clean `patched`。
7. legacy contract 第一版只 **soft gate**，不 hard fail；strict hard gate 仅对 explicit_v2 high-confidence 且 flag 打开时生效。

### 2.2 非目标

1. ❌ 不改外部 plan schema（`<FILES>` 仍是 `string[]`）；v2 contract 是内部模型，外部 schema 升级是未来工作。
2. ❌ 不修 card_on 那类 correctness 失败（文件改了但改错 / 编译不过）—— 属验证体系维度（BLUEPRINT §2.4），独立议题。
3. ❌ 不做 Phase 4 Agent Loop（repair 内联 patch、子 Agent、自主分解）。本 spec 只重构 patch 收口逻辑。
4. ❌ 不改 plan 阶段产生 `plan.files` 的方式。
5. ❌ 不删 legacy patch loop 代码；通过 feature flag 与新状态机共存，保证可回退。

## 3. 设计依据

- **为什么 contract-first**：把「patch 的目标」从隐式的 `plan.files` 字符串数组，提成显式、带角色与置信度的 contract，才能区分「required 必须覆盖」与「context 仅供参考、不要求覆盖」。退出逻辑需要一个明确的「目标状态」才能绑定。
- **为什么 validator-driven**：coverage 必须确定性、可单测、不被模型自报污染。validator 的唯一输入是 PlanFileContract + 实际 applied diff。
- **为什么 repair-aware**：收口产出结构化 `missing_required_files` 清单直接交给 repair，解决前序观察到的「incomplete 信号在 repair 里只活一轮」问题（repair 拿到的是确定性清单，不是只能从一条 patch record 上读的旁注）。
- **为什么 legacy 先 soft gate**：见 §1.3。`plan.files` 不可全信（会多列），第一版对 legacy contract 一律走 `patch_partial` / needs_repair，先用 telemetry 观察 missing 分布，再决定是否对高置信度 contract 收紧。

## 4. 架构与数据模型

### 4.1 PlanFileContract v2（内部模型）

新增 `packages/core/src/plan-file-contract.ts`：

```ts
type PlanFileRole = "required_target" | "optional_target" | "context";
type PlanFileConfidence = "high" | "medium" | "low";
type PlanFileContractSource = "explicit_v2" | "legacy_files" | "derived";

type PlanFileContractEntry = {
  path: string;            // normalize 后的 repo-relative path
  role: PlanFileRole;
  confidence: PlanFileConfidence;
  source: PlanFileContractSource;
};

type PlanFileContract = {
  requiredTargetFiles: PlanFileContractEntry[];
  optionalTargetFiles: PlanFileContractEntry[];
  contextFiles: PlanFileContractEntry[];
  version: "legacy" | "v2";
};

function buildPlanFileContract(plan: TaskState["plan"]): PlanFileContract;
function normalizePath(p: string): string;
```

`buildPlanFileContract` 行为：

1. 如果 plan 已带显式 v2 contract 字段 → 优先读取，`source = "explicit_v2"`，`version = "v2"`。
2. 否则用 legacy `plan.files` 经 adapter 转换，每条：`{ role: "required_target", confidence: "medium", source: "legacy_files" }`，`version = "legacy"`。
3. legacy `plan.files` **不得**标 high confidence。
4. v1 不因 legacy missing required file 直接 hard fail（见 §4.6 / §4.8）。
5. 所有 path 经 `normalizePath` 规范化后去重、保序。

`normalizePath` 规则：统一为 posix 分隔符；去除前导 `./`；折叠冗余段。**不做大小写折叠** —— Linux 区分大小写，折叠会引入错误匹配；若路径大小写不一致成为真实问题，另立处理（登记 §10）。

### 4.2 PatchCoverageValidator

新增 `packages/core/src/patch-coverage.ts`：

```ts
type PatchCoverageValidation = {
  fullRequiredCoverage: boolean;
  coveredRequiredFiles: string[];
  missingRequiredFiles: string[];
  coveredOptionalFiles: string[];
  missingOptionalFiles: string[];
  touchedContextFiles: string[];
  strictFailureEligible: boolean;
};

function validatePatchCoverage(args: {
  contract: PlanFileContract;
  appliedChangedFiles: string[];
}): PatchCoverageValidation;
```

规则：

1. `appliedChangedFiles` 必须来自**实际 apply 成功后**的 changed files（仓库现有 `applySingleChange` 仅在 `result.ok` 时回填 `result.files_changed`，`pipeline.ts:989-995`）。
2. change block 解析成功但未 apply → 不算 coverage。
3. apply 后 no-op（文件内容未变）→ 不算 coverage。若 apply 报告了文件但 diff 为空，validator 侧排除。
4. 重改已覆盖文件 → 不算新的 coverage progress。
5. 改 optional file → 不影响 required coverage。
6. context file → 不要求 coverage。
7. `fullRequiredCoverage` 只看 `requiredTargetFiles`。
8. `strictFailureEligible = true` 当且仅当**所有** `requiredTargetFiles` 都满足 `source === "explicit_v2" && confidence === "high"`。legacy_files 默认 `strictFailureEligible = false`。

### 4.3 Patch 状态机 v2

新增 `packages/core/src/patch-pipeline.ts`。`runPatch`（`pipeline.ts:834`）保留为公共入口，根据 `PATCH_STATE_MACHINE_V2` flag 分派：flag off → 现有 legacy loop（保留不动）；flag on → 新状态机：

```
runPatchPipeline:
  contract        = buildPlanFileContract(plan)
  exploreResult   = runPatchExplore({ contract, ... })
  finalizedResult = maybeRunCoverageFinalization({ contract, exploreResult, ... })
  validation      = validatePatchCoverage({ contract, appliedChangedFiles: finalizedResult.appliedChangedFiles })
  return decidePatchResult({ validation, exploreResult, finalizedResult })
```

函数名可等价，但**责任边界必须清晰**：explore 不再拥有最终成功判定权；validate 是唯一的确定性判定；decide 是唯一的状态产出。

### 4.4 coverage progress 追踪（patch_explore）

```ts
type PatchLoopState = {
  round: number;
  maxRounds: number;
  hasStartedPatching: boolean;
  coveredRequiredFiles: Set<string>;
  missingRequiredFiles: Set<string>;
  invalidStreak: number;
  consecutiveToolsOnly: number;
  roundsSinceCoverageProgress: number;
  validChangesWithoutCoverageProgress: number;
  coverageFinalizationAttempted: boolean;
};
```

`computeCoverageDelta(appliedChangedFiles, missingRequiredFiles)`：对每个 applied file 取 `normalizePath`，命中 `missingRequiredFiles` 才计入 delta。

- delta 非空 → 命中文件从 missing 移到 covered；`roundsSinceCoverageProgress = 0`、`validChangesWithoutCoverageProgress = 0`。
- delta 为空且 `hasStartedPatching` → `roundsSinceCoverageProgress++`；本轮若有 valid applied change（但未推进 required 覆盖）则 `validChangesWithoutCoverageProgress++`。

**关键规则**：「是否交了 change block」不再是真实进度；只有「本轮 applied diff 覆盖了之前未覆盖的 required target」才是。重改已覆盖 required、改 optional/context/非计划文件、invalid、tools-only —— 均**不**重置 stall 计数。

### 4.5 coverage_finalization 触发

```
shouldEnterCoverageFinalization(state):
  if state.coverageFinalizationAttempted: return false
  if state.missingRequiredFiles.size == 0: return false
  roundsLeft = state.maxRounds - state.round
  return (
    modelSaidDoneWithMissingRequiredFiles
    || (hasStartedPatching && (
         roundsSinceCoverageProgress >= 5
         || validChangesWithoutCoverageProgress >= 2
         || consecutiveToolsOnly >= 8
         || roundsLeft <= 3))
    || (invalidStreak >= 3 && hasStartedPatching)
  )
```

阈值常量（第一版）：`maxRoundsWithoutCoverageProgress = 5`、`maxValidChangesWithoutCoverageProgress = 2`、`maxConsecutiveToolsOnlyAfterPatch = 8`、`triggerWhenRoundsLeftLTE = 3`、`maxCoverageFinalizationAttempts = 1`。

### 4.6 coverage_finalization 阶段

独立阶段，不是普通 loop 的下一轮：

1. **tools 必须关闭**（不传 tool definitions）；不允许任何 `read_file` / `grep` / `shell`。
2. orchestrator **主动**读取 `missingRequiredFiles` 当前内容并注入 prompt；超过 `maxBytesPerFile = 20_000` 截断并在 prompt 标注 truncation。
3. prompt 明确：required target 清单、已覆盖、仍缺、本轮只允许输出 missing required 文件的 change block、只有确实无需修改才允许 `<DONE/>`、不准调工具。
4. finalizer 输出 `<DONE/>` 不能直接 clean success，必须再跑 `validatePatchCoverage`。
5. finalizer invalid / no-op / 未覆盖 missing → `patch_partial` / needs_repair。
6. 最多 `maxCoverageFinalizationAttempts = 1` 次。

### 4.7 DONE 语义重写

```
on <DONE/>:
  validation = validatePatchCoverage(...)
  if validation.fullRequiredCoverage:           return finishPatched()
  if not state.coverageFinalizationAttempted:   return runCoverageFinalization()
  return finishPatchPartial({
    reason: "done_with_missing_required_files_after_finalization",
    missingRequiredFiles: validation.missingRequiredFiles,
  })
```

`<DONE/>` 不能绕过 deterministic validator。出口 2（「未覆盖即 accept」）删除。

### 4.8 PatchResult 落地形态（D1 / D2）

仓库无 `PatchResult` 类型；patch 产出是 `TaskState.status` + `PatchRecord`。落地：

- `TaskStatus` enum（`task-state.ts:152-165`）新增 `"patch_partial"`。
- `VALID_TRANSITIONS`（`task-state.ts:204-217`）：`planned` / `preflighted` / `preflight_failed` / `repairing` 的目标集合加 `"patch_partial"`；新增 `"patch_partial": ["repairing", "repair_exhausted"]`。
- `PatchRecord`（patchRecordSchema）新增可选字段：`coverage`（`"full" | "partial"`）、`covered_required_files: string[]`、`missing_required_files: string[]`、`coverage_finalization_attempted: boolean`、`plan_file_contract_version`（`"legacy" | "v2"`）、`patch_partial_reason: string`。现有 `patch_incomplete_reason` 保留不破坏；repair 的权威输入改为 `missing_required_files`。
- `runRepair` 入口守卫（`pipeline.ts:1222`）接受 `patch_partial`。
- **路由**：`patch_partial` 直接进 repair（needs_repair），跳过 `runVerify` —— 已知不完整，先补全再验证。

decide 结果三态：

| status | coverage | 含义 |
|--------|----------|------|
| `patched` | full | required 全覆盖（或剩余全部被 finalization 中显式判为无需修改） |
| `patch_partial` | partial | 仍有 missing required，needsRepair=true，携带 `missing_required_files` |
| `patch_failed` | — | 0 个 change apply 成功（沿用现有语义）；或 strict hard gate（见 §4.9） |

missing required files 不得被静默吞掉；finalization 后仍 missing 不得 clean `patched`。

### 4.9 feature flags（D3）

4 个 flag 落 `.dsh/config.yml`（benchmark 经 `writeDshConfig` 程序化可控），env 同名变量可覆盖：

| flag | 第一版默认 |
|------|-----------|
| `PLAN_FILE_CONTRACT_V2` | true |
| `PATCH_COVERAGE_FINALIZATION` | true |
| `PATCH_STATE_MACHINE_V2` | true |
| `STRICT_REQUIRED_TARGET_COVERAGE` | **false** |

strict hard gate（`patch_partial` 升级为 `patch_failed`）只有以下**全部**满足才允许：

1. `STRICT_REQUIRED_TARGET_COVERAGE = true`
2. `validation.strictFailureEligible = true`
3. `coverage_finalization` 已尝试
4. `missingRequiredFiles` 仍非空

否则一律走 `patch_partial` / needs_repair。

### 4.10 telemetry

结构化 telemetry 写入 TaskState + sidecar `.dsh/patch-coverage-telemetry.json`（与 `plan-contract-diagnostics.json` 同风格）。字段：contract version、required/optional/context 计数、covered/missing required 计数、`missingRequiredFiles`（path 列表）、finalization triggered/succeeded、`doneWithMissingRequiredFiles`、`patchResultStatus`、`repairTriggered`、totalPatchRounds、totalToolCalls、`strictFailureEligible`、`strictFailureApplied`。**只记 path / 计数 / 状态 / reason，不记文件内容或 diff 正文。**

## 5. 与仓库现实的对齐（D1–D5）

- **D1**：无 `PatchResult` 类型 → 落到 `TaskStatus` enum + `VALID_TRANSITIONS` + `PatchRecord` 字段（§4.8）。
- **D2**：`patch_partial` 直接进 `runRepair`，跳过 `runVerify`（§4.8）。
- **D3**：feature flag 落 config，env 可覆盖（§4.9）。
- **D4**：plan schema 未升级前 `buildPlanFileContract` **恒走 `legacy_files` 分支**；`explicit_v2` / `derived` 与 `STRICT_REQUIRED_TARGET_COVERAGE` 在 v1 是**前向兼容空路径** —— 即使该 flag 打开，`strictFailureEligible` 恒 false，hard gate 不会触发。这是预期行为，不是缺陷。
- **D5**：本 spec 是 patch 阶段**行为变更**，按 CONSTITUTION 原则 5 + Phase 3 退出条件，合并后必须有一轮定向 benchmark 回归（见 §6.2）。

## 6. 成功标准

### 6.1 功能验收（单元 / 集成测试，对应人类指令 §11）

- [ ] legacy `plan.files` → medium-confidence `required_target`，`source = legacy_files`，`strictFailureEligible = false`
- [ ] context file 不要求 coverage（required=[A] / context=[B] / applied=[A] → fullRequiredCoverage=true）
- [ ] optional file 不阻断 success（缺 optional 进 `missingOptionalFiles`，不阻断 `patched`）
- [ ] 重改已覆盖文件不算 coverage progress（delta 为空，stall 计数增加）
- [ ] 改非计划文件不算 coverage progress
- [ ] 覆盖新的 required target 才重置 progress，文件从 missing 移到 covered
- [ ] `<DONE/>` with missing required → 进入 `coverage_finalization`，不直接 `patched`
- [ ] `<DONE/>` with missing after finalization → `patch_partial`，携带 `missingRequiredFiles`，不 `patched`
- [ ] finalization 成功救回 → `patched` / coverage=full
- [ ] finalization no-op / invalid → `patch_partial` / needs_repair
- [ ] strict hard gate 不作用于 legacy（即使 `STRICT_*=true`，`strictFailureEligible=false` → 走 `patch_partial`）
- [ ] explicit_v2 high-confidence + `STRICT_*=true` + finalization 已尝试 + 仍 missing → 允许 `patch_failed`
- [ ] card_off regression：构造「读多轮→invalid→改 shared.ts→读→改 openai-compatible.ts→读→重改 shared.ts→继续读」，required=[shared.ts, openai-compatible.ts, anthropic.ts] → 重改 shared.ts 不重置 progress；缺 anthropic.ts 时触发 finalization；**不得耗到 maxRounds 才退出**；终态为 `patched`(full) 或 `patch_partial`(missing=[anthropic.ts])

### 6.2 行为验收（CONSTITUTION 原则 5）

合并后跑一轮定向 benchmark（`loam-refactor*` fixtures × on/off × N≥3），证明：

- `loam-refactor-provider-dedup` card_off 不再以 `MAX_PATCH_ROUNDS` 退出（patchRoundActions 不再是 30 轮 tools 主导）。
- patch 阶段对 missing required 产出 `patch_partial` 或经 finalization 救回。
- `loam-refactor` 聚合 `testsPassed` 不低于 `260518171207` 基线。

### 6.3 质量门禁

`pnpm run scan`（lint + typecheck + test）全绿；旧测试不无故退化。

## 7. 风险与限制

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| `plan.files` 多列文件 → finalization 反复追一个不需改的文件 | 中 | finalization 浪费一次调用，最终 `patch_partial` | finalization 允许 `<DONE/>`「确无需修改」；`maxCoverageFinalizationAttempts=1` 限一次；legacy 不 hard fail |
| `appliedChangedFiles` 的 no-op 判定不准 → 误判 coverage | 中 | required 误判已覆盖或漏覆盖 | validator 侧排除空 diff；单测覆盖 no-op 场景 |
| 新状态机与 legacy loop 行为漂移 | 中 | flag 切换后 benchmark 不可比 | flag 默认开新状态机但保留 legacy 代码；§6.2 on/off 对比 |
| `patch_partial` 新状态破坏旧 task-state.json 反序列化 | 低 | enum 扩展向后兼容；新字段均 optional | schema 接受旧文件 |
| finalization 注入大文件撑爆上下文 | 中 | token 浪费 / 截断丢信息 | `maxBytesPerFile=20_000` + truncation 标注 |

## 8. 实施策略（Commit 1–5）

对应人类指令 §13。每个 commit 独立、过 `pnpm run scan`。详细文件映射见 `docs/plans/2026-05-19-patch-pipeline-coverage-state-machine.md`。

| Commit | 目标 |
|--------|------|
| 1 | PlanFileContract v2 类型 + legacy adapter + `normalizePath` / dedupe + 单测 |
| 2 | PatchCoverageValidator + 基于 appliedChangedFiles 的确定性 coverage + 单测 |
| 3 | patch 状态机 v2：explore / finalization / validate / decide 拆分；DONE 语义重写；coverage progress stall；`patch_partial` 状态机扩展 |
| 4 | `coverage_finalization` no-tools 调用 + 注入 missing file 内容 + 仍 missing → `patch_partial` / needs_repair |
| 5 | telemetry + feature flags + card_off regression test + 文档/注释更新 |

回退策略：每 commit 一个逻辑单元；若实证退化按 5→4→3→2→1 顺序 revert，或直接关 `PATCH_STATE_MACHINE_V2` flag。

## 9. 禁止事项

1. 不只修 `consecutiveToolsOnly`。
2. 不恢复「未覆盖 plan.files 即 `patch_failed`」硬门。
3. 不让 `<DONE/>` 绕过 coverage validator。
4. 不把模型自报 coverage / coverage manifest 当真相。
5. 不把 valid change block 当真实进展 —— 只有 applied diff 覆盖新 required file 才是。
6. legacy `<FILES>` 必须兼容，第一版只 soft gate，不直接 hard fail。
7. `coverage_finalization` 严禁任何工具调用。
8. finalization prompt 不许只给文件名，必须注入 missing file 内容或明确标注截断。
9. telemetry 不记大段文件内容或敏感 diff。
10. 不破坏 legacy plan parser；不强制外部 plan schema 带 required/optional/context；不删旧逻辑的兼容路径。
11. 不重复造平行体系 —— 复用现有模块，重命名最小化。

## 10. 本 spec 引发的跟踪事项

> 转 in_review 前登记到 `docs/project-ledger.md` §8（CONSTITUTION 原则 8）。

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
| evidence | patch-coverage-state-machine-benchmark | 实施完成同 PR | P0 | §6.2 定向 benchmark 回归，证明 card_off 不再 maxRounds 退出且 loam-refactor 聚合不退化 |
| debt | plan-file-contract-v2-schema | 外部 plan schema 升级时 | P2 | `explicit_v2` / `derived` / `STRICT_REQUIRED_TARGET_COVERAGE` 在 v1 是空路径；plan schema v2 落地后才激活 |
| debt | patch-loop-legacy-coexist | 新状态机 benchmark 稳定 ≥1 轮后 | P2 | legacy patch loop 与 flag 共存；确认稳定后再决定是否删除 legacy 分支 |
| deferred | patch-correctness-repair | Phase 3 收口后 | P1 | card_on 类 correctness 失败（改了但改错 / 编译不过）不在本 spec，归验证体系 |

## 11. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-19 | v1.0 (draft) | 初始 spec：contract-first / validator-driven / repair-aware patch 状态机；PlanFileContract v2、PatchCoverageValidator、coverage_finalization、`patch_partial` |
