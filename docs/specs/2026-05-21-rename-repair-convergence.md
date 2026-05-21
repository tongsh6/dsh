# Rename / Repair 收敛机制

> 状态: draft | 日期: 2026-05-21 | 作者: Codex
>
> 目标: 让 rename / move / multi-file reference update 类任务的 repair 从验证语义和工具反馈中稳定收敛，避免空 patch、错误 shell 写操作、CREATE/DELETE 复制漂移和只覆盖文件不保证语义正确的问题。

## 1. 问题定义

### 1.1 当前状态

Patch pipeline 已通过 `PatchCoverageValidator` 把 `plan.files` 转成 required target coverage，并能在缺 required 文件时进入 `patch_partial` / repair。这个机制解决的是「是否触达必要文件」。

rename / repair 当前仍依赖以下信号：

- `plan.files` 作为 required target 的主要来源。
- `PatchRecord.files` / `createdFiles` / `renamedFiles` / `patchedFiles` / `deletedFiles` 作为 coverage 输入。
- 验证失败输出作为 repair prompt 的自然语言上下文。
- `exec_shell`、`read_file`、`grep_files` 三个只读工具用于 repair 诊断；实际编辑仍必须通过 `<CREATE>` / `<PATCH>` / `<SEARCH_REPLACE>` / `<INSERT>` / `<DELETE>` / `<RENAME>` content change block 交付。

因此当前系统可以发现「还没碰到某些 required 文件」，但不能稳定表达「这个任务本质是 rename，应保留原文件内容并迁移引用」或「验证失败说明旧文件仍存在 / 新文件内容不等价 / 引用仍指向旧路径」。

### 1.2 痛点 / 实证证据

`loam-refactor-rename-distill-state` fixture 是有效任务，不是 fixture 设计缺陷：它要求把 `state.ts` rename 为 `distill-state.ts`，保持 228 行内容不变，并更新所有 `./state.js` / `../state.js` import。fixture 同时以结构化验证断言约束：

- 新文件存在。
- 旧文件不存在。
- 新文件内容与基准旧文件内容一致。
- 所有 import 引用迁移到新路径。

近期证据：

- `docs/reports/runlogs/260521050607-pie-replicated/summary.md`：targeted N=3，Project Card on `1/3`，off `1/3`。失败主类为 `repair_exhausted` 和 `model_protocol_plan_invalid`，不是 Project Card Unknowns 的稳定负 lift。
- 同一 run 的 patch telemetry 显示：card_on `emptyPatchRecords=5`、`repairEmptyPatchStalls=3`；card_off `emptyPatchRecords=6`、`repairEmptyPatchStalls=4`。多个失败 trial 初始 patch 为空，repair 继续输出空 patch 或在只读 shell 工具上消耗预算。
- `docs/reports/runlogs/260521045538-project-card-ablation/summary.md`：修正后的 `full_minus_unknowns` 仍失败，说明删掉 Unknowns 不足以解决 rename/repair 收敛。
- `packages/core/src/patch-coverage.ts` 只验证 required target files 是否被 touched。对于 rename，它把 `old -> new` 拆成两端 path 参与覆盖，但不验证旧文件已消失、新文件内容等价、引用全部迁移。
- `packages/core/src/tool-executor.ts` 正确禁止 `rm` / `cp` / `mv` 等写 shell，但错误反馈只说明命令被禁止，未把模型明确导向 content change block 协议。实跑中 repair 会反复尝试 `rm`、`cp`、管道、错误 `cd` 等，导致工具预算消耗后仍空 patch。

结论：rename-distill-state 的失败不是 Project Card 单点问题，而是 patch/repair 对「语义验证失败 + 编辑协议选择」缺少收敛契约。

### 1.3 与最终目标的关系

本问题属于 BLUEPRINT Phase 3 的执行稳定性问题，直接影响复杂 refactor fixture 的 `testsPassed` 稳定性。它承接 `docs/specs/2026-05-19-patch-pipeline-coverage-state-machine.md` §9 中的 `patch-correctness-repair`：coverage 状态机解决 completeness，本 spec 解决 correctness repair 的第一类高频失败簇。

同时本 spec 受 CONSTITUTION 原则 9 约束：不得通过 fixture 特判、prompt 填答案、硬编码 loam 路径、跳过验证或降低断言来制造通过率；所有改动必须提升类别级机制。

## 2. 目标与非目标

### 2.1 目标

1. 把结构化验证失败转成 repair 可执行的语义 hints：文件应存在 / 不应存在、内容等价失败、引用残留、shell 断言失败等。
2. 当 repair 尝试被禁止的写 shell 命令时，反馈必须明确指出：shell 只读，文件修改应通过 content change block 输出；rename 应优先用 `<RENAME from="..." to="..." />` 保留内容，再用 `<SEARCH_REPLACE>` 更新引用。
3. 空 patch / 工具预算耗尽后的最终 repair 指令必须更具体：禁止继续探索，必须输出合法 change block，并在存在 rename/move 语义时提示优先选择 `<RENAME>` 而不是复制整文件。
4. coverage 和 semantic repair 的职责边界保持清晰：coverage 仍负责 required target touched；semantic repair 负责把验证失败转成下一轮可操作约束。
5. 所有新增逻辑以通用任务语义和验证输出为输入，不读取 fixture 答案、不注入 benchmark-only path。

### 2.2 非目标

1. ❌ 不实现 Phase 4 native edit tools；编辑仍走现有 content change block 协议。
2. ❌ 不强制所有 `CREATE + DELETE` 组合改写成 `RENAME`；只有任务语义或验证失败表明是 rename/move 且内容应保留时才提示优先 `<RENAME>`。
3. ❌ 不把 fixture `expectedProtocolOperations` 或 `expectedFiles` 作为生产 runtime 答案来源。
4. ❌ 不降低、跳过或改写验证断言来提高通过率。

## 3. 设计

### 3.1 Semantic Repair Hints

新增一层 repair hint builder，从当前 `TaskState` 可见信息中提取语义约束：

- 结构化 verification assertions 的失败结果。
- shell verify 输出中可归类的文件断言失败。
- patch record 的 applied operations。
- repair stall 原因。

第一版只做低风险、可解释的 hints：

| 输入信号 | repair hint |
|----------|-------------|
| `file_exists(path)` 失败 | `path` 必须被创建、rename 到或 patch 到存在状态 |
| `file_not_exists(path)` 失败 | `path` 必须通过 `<DELETE path="..."/>` 或 `<RENAME from="path" to="..."/>` 移除 |
| 内容等价断言失败 | 不要手写复制大文件；若任务是 rename/move，使用 `<RENAME>` 保留原内容 |
| grep / contains 断言显示旧 import 残留 | 用 `<SEARCH_REPLACE>` 更新引用，不只改文件名 |
| empty patch stall | 下一轮必须输出至少一个合法 change block |

hint 必须是「如何修」而不是「答案是什么」。例如可以说「旧文件仍存在，使用 DELETE 或 RENAME 移除」，不能从 fixture 直接注入「把 packages/loam/src/state.ts 改成 packages/loam/src/distill-state.ts」。

### 3.2 写 shell 拒绝反馈升级

`exec_shell` 继续保持只读安全边界。被拒绝命令若命中 `rm` / `cp` / `mv` / redirect / pipe 写风险，错误消息追加协议指导：

- 不要重试写 shell。
- 用 `<RENAME from="old" to="new" />` 交付 rename。
- 用 `<DELETE path="..." />` 删除旧文件。
- 用 `<SEARCH_REPLACE path="...">` 更新引用。
- change block 必须放在 assistant content，不是 tool call。

这不是放宽安全策略，而是把拒绝反馈变成下一步可执行协议。

### 3.3 最终 repair 请求收敛

repair 工具轮耗尽时，`buildFinalRepairRequest()` 需要携带：

- 已知 missing required files。
- 上一轮 stall reason。
- 如果任务文本、patch record 或 verification hint 中出现 rename/move 语义，提示优先 `<RENAME>` 保留内容，再更新引用。
- 明确禁止 `<DONE/>`、纯 prose、继续调用工具。

### 3.4 验证失败归类边界

本 spec 不把 verify runner 变成完整语义证明器。它只把已经存在的失败输出结构化给 repair 使用。若某类断言无法可靠解析，保留原始 verify 输出，不猜测答案。

### 3.5 Telemetry

新增可选 telemetry 字段，便于 benchmark 归因：

- `repair_semantic_hints`: hint 类型列表，不记录文件内容。
- `blocked_write_shell_guidance`: 被拒绝写 shell 后是否追加协议指导。
- `rename_intent_detected`: 是否从任务 / 验证 / patch record 中检测到 rename/move 语义。

## 4. 数据模型 / 契约变更

`PatchRecord` 可新增可选字段：

- `repair_semantic_hints?: string[]`
- `blocked_write_shell_guidance?: boolean`
- `rename_intent_detected?: boolean`

如实施时发现现有 `PatchRecord` schema 不适合扩展，可先把同等信息写入 repair prompt metadata 或 sidecar telemetry，但必须保留机器可读字段，不能只靠自然语言日志。

## 5. 成功标准

### 5.1 功能验收

- [x] 写 shell 被拒绝时，错误反馈包含 content change block 协议指导。
- [x] empty patch stall 的 repair prompt 要求输出具体 change block。
- [x] rename/move 语义出现时，repair prompt 提示优先 `<RENAME>` 保留内容，而不是复制整文件。
- [x] 结构化 file exists / file not exists / contains 类失败能生成 repair hints。

### 5.2 行为验收（数据驱动）

- [x] `loam-refactor-rename-distill-state` targeted N≥3 复跑，记录 card_on/off 的 `emptyPatchRecords`、`repairEmptyPatchStalls`、`repair_exhausted`、`actualProtocolOps` 分布。
- [x] `loam-refactor-*` batch N≥3 复跑，聚合 `testsPassed` 不低于当前基线。
- [x] 若单 fixture 仍高方差，报告必须按机制指标解释，不把单次 PASS 当作收口证据。

### 5.3 性能 / 成本验收

- [ ] 单轮 repair prompt 增量保持在 1KB 以内。
- [x] 不新增额外 LLM 调用。
- [x] 不放宽 shell 安全策略。

### 5.4 Canonical wiring 验收

不适用：本 spec 不替代既有入口。

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| rename intent 误判导致本该 copy 的任务被引导成 rename | 中 | 中 | 只在任务 / 验证 / patch 证据出现 rename/move/旧文件不应存在/内容应保留时提示“优先”，不强制改写 |
| repair hints 过长稀释核心失败信息 | 中 | 中 | hints 做类型化摘要，不塞文件内容，控制 1KB 增量 |
| 工具拒绝反馈变成协议噪音 | 低 | 中 | 仅对写 shell / 编辑工具误调用追加指导，只读命令失败保持原样 |
| 只优化 loam fixture | 中 | 高 | 禁止 fixture path 特判；验收覆盖 loam-refactor batch 和 telemetry 指标 |

## 7. 实施策略

### 7.1 分 Phase

| Phase | 目标 | 关键产物 |
|-------|------|---------|
| P1 | 工具拒绝反馈与 final repair prompt 收敛 | `tool-executor.ts` 写 shell guidance；`repair-loop.ts` final/stall hint 增强；单元测试 |
| P2 | Semantic repair hint builder | 从结构化 verification / failure detection 输出生成机器可读 hints；单元测试 |
| P3 | Telemetry 与 benchmark 归因 | `PatchRecord` / report 输出 hints 指标；targeted N≥3 + loam-refactor batch |

### 7.2 回退策略

若 P1 或 P2 数据显示退化，回退对应提示生成逻辑和 telemetry 字段，不降低验证断言、不删除安全拦截、不改 fixture。回退依据必须是同一 fixture set 的 A/B 或 replicated benchmark，不以单次 run 决定。

### 7.3 不在本 spec 范围

- Phase 4 edits-as-native-tool：由 `docs/specs/2026-05-20-edits-as-native-tool.md` 跟踪。
- plan schema v2：由 `plan-file-contract-v2-schema` 跟踪。
- no-op coverage 排除：由 `patch-coverage-noop-exclusion` 跟踪。

## 8. 不在本 spec 范围

同 §7.3。

## 9. 本 spec 引发的跟踪事项

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
| bug | rename-repair-convergence | 实施 P1-P3：写 shell guidance、semantic repair hints、telemetry；不含 fixture 特判 | P1 | 承接 `patch-correctness-repair` 的 rename/move 子类 |
| evidence | rename-repair-convergence-benchmark | P1-P3 实施完成后收集 targeted N≥3 + loam-refactor batch N≥3，并对 empty patch / repair stall / protocol ops 做归因 | P0 | 不以单次 loam PASS 作为收口证据 |

## 10. 实施与验证记录

### 10.1 已实施

- P1：`exec_shell` 写 shell 拒绝反馈追加 content change block 协议指导；`sed -i` 被明确禁止；repair stall / final repair prompt 在 rename/move 语义下提示优先 `<RENAME>`。
- P2：新增 semantic repair hints，把结构化 `file_exists` / `file_not_exists` / `file_contains` / 内容等价失败转成 repair 可执行提示。
- P3：`PatchRecord`、benchmark diagnostics 和 replicated summary 增加 `repairSemanticHintRecords`、`blockedWriteShellGuidanceRecords`、`renameIntentDetectedRecords`。
- 追加 `rename-intent` 共享 helper，支持英文 rename/move、ASCII/Unicode arrow、中文“重命名为 / 移动到 / 迁移到”等表达，并同时用于 repair 与 coverage finalization。
- P4：新增 deterministic rename repair：当任务存在 rename pair，结构化验证证明引用未更新或内容未保持，且当前工作区能安全推出旧引用 / 源文件内容时，生成受控 `<PATCH type="search">` 或 `<RENAME>`，仍走现有 parser / applyChanges，不读取 fixture 答案。
- P5：当旧源文件已经被删除，但失败的结构化 shell 断言明确要求 `git show HEAD:<old> | cmp - <new>` 内容保持时，从 Git 基线读取 `<old>` 的权威内容，生成受控 full-file `<PATCH type="search">` 修复 `<new>`；触发条件限定为 rename pair + content-preservation assertion 失败 + Git 基线可读。

### 10.2 验证

- 静态验证：`pnpm --filter @dsh/core test` 557/557 pass；`pnpm --filter @dsh/eval test` 81/81 pass；`pnpm run typecheck` pass；`pnpm run lint` pass；`./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts` pass；`pnpm -r run build` pass。
- Targeted benchmark：`docs/reports/runlogs/260521072442-pie-replicated/results.json`，`loam-refactor-rename-distill-state`，`--reps=3 --lanes-per-repo=2 --seed=26052114`。
- 结果：Card ON `1/3`，Card OFF `1/3`；两侧失败均为 `repair_exhausted=2/3`。
- 机制变化：失败样本的 `actualProtocolOps` 从前一轮常见 `CREATE` / CREATE-only 漂移，收敛为 `RENAME` only；`renameIntentDetectedRecords` 在失败样本中稳定记录为 `2`，说明 rename intent 已进入 repair telemetry。
- 残留问题：失败样本仍缺 `packages/distill/src/engine.ts`、`packages/distill/src/index.ts`、`packages/distill/src/index.test.ts`、`packages/distill/src/dag-runner.test.ts` 的引用更新；repair 仍连续输出空 patch（`repairEmptyPatchStalls=2`、`failedEmptyPatchRecords=2`）。因此本 spec 的提示与观测层已落地，但行为层尚未关闭。
- Follow-up benchmark：`docs/reports/runlogs/260521081359-pie-replicated/results.json`，`--seed=26052115`。结果 Card ON `1/3`、Card OFF `2/3`；`deterministicReferenceRepairRecords` 在 6/6 trial 中触发，证明引用更新机制生效。残留失败转移到 content equality：模型初始用 `<CREATE>` 复制了错误 destination 后，第二轮 repair 无法稳定用内容保持的 rename 修复。
- Final targeted benchmark：`docs/reports/runlogs/260521085144-pie-replicated/results.json`，`--seed=26052116`。结果 Card ON `3/3`、Card OFF `3/3`；6/6 `testsPassed`，无 `repair_exhausted`，无 empty repair stall。所有通过样本均完成 `RENAME + SEARCH_REPLACE`；4/6 触发 deterministic reference repair，1/6 触发 `deterministic_content_preserving_rename` 修复 CREATE-copy 内容漂移。
- Batch benchmark：`docs/reports/runlogs/260521093000-pie-replicated/results.json`，`loam-refactor-*`，`--reps=3 --lanes-per-repo=2 --seed=26052117`。结果 Card ON `8/9`、Card OFF `6/9`；`reorganize-tests` 6/6 PASS；`rename-distill-state` 5/6 PASS，唯一失败是 `card_off rep1` 的 `CREATE+DELETE+SEARCH_REPLACE` 分支，deterministic reference repair 已补引用，但旧源已删除导致内容等价仍失败；`provider-dedup` 3/6 FAIL，失败主因是 `anthropic.ts withRetry` 覆盖缺失后的 empty repair stall，属于 provider-dedup repair 目标选择问题，不是 rename deterministic repair 回归。
- Final targeted rerun：`docs/reports/runlogs/260521103511-pie-replicated/results.json`，`--seed=26052118`。补充 Git HEAD content repair 后，rename-distill-state Card ON `3/3`、Card OFF `3/3`；6/6 均为 `RENAME + SEARCH_REPLACE`，0 `repair_exhausted`，0 empty repair stall，3 个 deterministic reference repair records。
- 结论：对 rename/reference-update 子问题，当前 targeted N≥3 已两轮全通过，且 loam-refactor batch 中唯一 rename 残余已被通用 Git-baseline content repair 覆盖。card_on/off 仍应作为防回归分层保留，但机制归因主轴已转为 protocol ops、deterministic repair records、empty patch、repair exhaustion 和 failed assertion residuals；不再把 card_on/off 胜负作为单独解释。

### 10.3 下一步方向

当前根因从“rename 语义识别失败 / CREATE copy 漂移”收敛到“结构化断言驱动的 deterministic repair”。本 spec 在 targeted rename fixture 上已收敛；`loam-refactor-*` batch 也未显示 rename deterministic repair 误伤其它 fixture。后续重点转向 provider-dedup 的 repair 目标选择，而不是继续提示增强：

- 单独分析 `loam-refactor-provider-dedup`：当前失败集中在 `anthropic.ts` 未补 `withRetry` 后 repair 连续空 patch。
- 检查 deterministic repair 的触发边界：只允许 rename pair + 结构化失败 + 当前文件内容可安全推出时介入。
- Phase 4 native edit tools 仍可继续评估，但不再作为该 fixture 的必要前置。

## 11. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-21 | v1.0 (draft) | 初始 spec：定义 rename/repair 收敛问题、设计 semantic hints、写 shell 拒绝反馈、final repair prompt 收敛和 benchmark 验收 |
| 2026-05-21 | v1.1 | 记录 P1-P3 实施与 targeted benchmark 260521072442；确认 rename intent/telemetry 生效，但 reference update repair 仍未关闭 |
| 2026-05-21 | v1.2 | 记录 deterministic reference/content-preserving rename repair 与 targeted benchmark 260521085144；rename-distill-state N=3 on/off 全通过 |
| 2026-05-21 | v1.3 | 记录 loam-refactor batch 260521093000、Git HEAD content repair、targeted rerun 260521103511；rename 子问题收敛，provider-dedup 另列残余 |
