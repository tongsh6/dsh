# DSML 泄漏打捞(route Y / Bug A 修复)PLAN

> 状态: draft | 日期: 2026-05-20
>
> **设计依据**:见 ledger §8 `patchloop-dsml-content-leak`(bug,P1)。
> 模型把合法 change(`<PATCH>`/`<CREATE>`/`<RENAME>`/`<SEARCH/REPLACE>`/`<INSERT>`/`<DELETE>`)
> 塞进 DeepSeek 原生 DSML 工具调用的 `<｜DSML｜parameter>`;调用因 hallucinated tool name /
> 模型吐畸形 DSML token(实测双竖线 `<｜｜DSML｜｜...>`,U+FF5C×2)/ 推理引擎解析半途崩坏,
> 未兑现成结构化 `tool_calls`;DSML 信封碎片 + 内层 change 块泄漏进 `content`,内层闭标签
> 被 `</｜｜DSML｜｜parameter>` 替换;`parsePatchTurn` / `parseChanges` 因找不到合法闭合
> change 块,判为 `no action` / 抛 `PatchParseError`,整段被丢弃。
>
> 修复思路是**在解析层兜底**(确定性预处理),不动协议设计、不改 prompt、不动 apply 链路。
> 不替代 route X(Phase 4,见 `docs/specs/2026-05-20-edits-as-native-tool.md`),route Y
> 是底座、route X 是策略层,并行不互替。
>
> **关联**:CONSTITUTION 原则 1/2/3 | BLUEPRINT §3 Phase 3 收口 | ledger §8
> `patchloop-dsml-content-leak`(resolve_when 即本 plan 完成)、
> `phase4-edits-as-native-tool`(deferred,不在本 plan 范围)

## 1. 文件映射

| 文件 | 类型 | 改动 |
|------|------|------|
| `packages/core/src/dsml-recovery.ts` | 新建 | `recoverDsmlWrappedChange(content): { recovered: boolean; content: string; reason?: string }` + 检测/剥离/合成闭标签 |
| `packages/core/src/dsml-recovery.test.ts` | 新建 | 单测;**含 r7 byte-level 标本逐字节回归**作为 load-bearing 用例 |
| `packages/core/src/patch-pipeline.ts:338` | 修改 | `runPatchExplore`:在 `parsePatchTurn(content, hasToolCalls)` 前调 salvage,把 recovered 标志写入 round record |
| `packages/core/src/patch-pipeline.ts:572` | 修改 | `maybeRunCoverageFinalization`:在 `parseChanges(content)` 前调 salvage |
| `packages/core/src/pipeline.ts:922` | 修改 | legacy `runPatch`(PATCH_STATE_MACHINE_V2=false 路径)在 `parsePatchTurn` 前调 salvage,保持两条路径行为一致 |
| `packages/core/src/repair-loop.ts:559` | 修改 | `runRepairLoop`:在 `parseChanges(content)` 前调 salvage |
| `packages/core/src/index.ts` | 修改 | 导出 `recoverDsmlWrappedChange` 与返回类型,便于跨包测试 |
| `docs/project-ledger.md` §8 | 修改 | 本 plan 完成后将 `patchloop-dsml-content-leak` status:waiting → in_progress(实施期),全量 benchmark 验证后 → resolved |

**不动**:`patch-parser.ts`(`extractPatchBlock` 等正则保持原样)、prompt 模板、provider 客户端、apply 链路(`applyPatch` / `applyPatchLenient`)、协议定义。

## 2. 分阶段任务

### Phase 1:核心 salvage 函数 + 单测

- [ ] 1.1 在 `dsml-recovery.ts` 定义类型与常量
  - `DsmlRecoveryResult = { recovered: boolean; content: string; reason?: string }`
  - `DSML_LEAK_MARKERS`:`<｜DSML｜`、`<｜｜DSML｜｜`、`</｜DSML｜`、`</｜｜DSML｜｜`(全角 U+FF5C 单/双竖线两种变体)
  - `CHANGE_BLOCK_OPENERS`:`<PATCH(\s|>)`、`<CREATE\s`、`<RENAME\s`、`<DELETE\s`、`<INSERT\s`、`<SEARCH>`(配套 `<REPLACE>`,合在 `<PATCH type="search" ...>` 里时一并处理)
- [ ] 1.2 实现 `recoverDsmlWrappedChange(content)`:
  1. 若不含任一 `DSML_LEAK_MARKERS` → `{ recovered: false, content }` 直接返回(passthrough)
  2. 命中:剥离所有 `<\/?｜｜?DSML｜｜?[^>]*>` 标签(用单一正则统一处理单/双竖线)
  3. 扫描剥离后的文本,寻找 `CHANGE_BLOCK_OPENERS` 命中
  4. 对每个找到的开标签,若**对应的合法闭标签缺失**(`<PATCH>` 缺 `</PATCH>` 等),在原 DSML 信封 `</｜｜?DSML｜｜?parameter>` 出现的偏移位置(或 EOF)合成补足
  5. 返回 `{ recovered: true, content: <修正后>, reason: <hint> }`
- [ ] 1.3 单测 ≥10 例,逐字节确认
  - r7 byte-level 真实标本(从 `/tmp/dsh-patch-explore-debug.jsonl` entry 29 内容固化为 fixture)→ 输出含合法 `<PATCH>...</PATCH>`
  - 单竖线 DSML 包 `<PATCH>` / 双竖线 DSML 包 `<PATCH>` / DSML 包 `<CREATE>` / 包 `<RENAME .../>`(本来就自闭)/ 包 `<DELETE .../>` / 包 `<INSERT>` / 包 `<PATCH type="search">`(SEARCH_REPLACE)
  - 无 DSML 标记 → passthrough
  - DSML 但内部不含已知 change 块(纯文本)→ 剥 DSML、回不 recovered 或返回剥后文本(让 parsePatchTurn 报 invalid)
  - DSML 同时含多个 change 块 → 不试图选,返回剥 DSML 后的全部内容,交给上层 `parsePatchTurn` 报 "multiple change blocks"
  - 空内容 → passthrough
- [ ] 1.4 `pnpm --filter "./packages/core" run test` 全绿

### Phase 2:4 个解析点接入

- [ ] 2.1 `patch-pipeline.ts:runPatchExplore` 第 338 行前注入 salvage,把 `recovered` 写进 `PatchRoundRecord`(新增可选字段 `dsmlSalvageApplied?: boolean`,用于 telemetry 观测频次)
- [ ] 2.2 `patch-pipeline.ts:maybeRunCoverageFinalization` 第 572 行前注入 salvage
- [ ] 2.3 `pipeline.ts:runPatch`(legacy)第 922 行前注入同样调用,保证 V2 flag 关闭路径不退化
- [ ] 2.4 `repair-loop.ts:runRepairLoop` 第 559 行前注入 salvage
- [ ] 2.5 4 处接入的集成测试:用 r7 内容做 `parsePatchTurn` end-to-end 断言 —— **without salvage 应 `invalid: no action`,with salvage 应 `kind: change, op: PATCH`**
- [ ] 2.6 `pnpm run scan` 全绿(包含 lint / typecheck / 全部测试)

### Phase 3:定向 benchmark 回归

- [ ] 3.1 单 trial smoke:`tsx scripts/benchmark-pie-replicated.ts --filter=loam-refactor-rename-distill-state --reps=1`(2 trials,~10 min)
  - 验收:**`actualProtocolOps` 不再为 `[]`**;`filesChanged.length >= 1`;不期望必然 PASS(Bug B/C 仍在)
- [ ] 3.2 6 trial 回归:`--filter=loam-refactor --reps=1`(与 `260519155944` 同口径)
  - 验收:聚合 `testsPassed` 不退化(基线 3/6);rename-distill-state 失败模式从 `actualProtocolOps:[]` 变为别的(B/C 残余可接受)
- [ ] 3.3 telemetry 观察:`patchRoundActions` 中 `dsmlSalvageApplied: true` 的频次落进 runlog,作为 §1 报告的数据点

### Phase 4:台账 + commit + push

- [ ] 4.1 ledger §8 `patchloop-dsml-content-leak` status → `resolved`(trigger 全部满足时),附 runlog 路径
- [ ] 4.2 ledger §1 加 2026-05-2X 一条:概述实施过程、benchmark 数据点、剩余 blocker
- [ ] 4.3 分组 commit:
  - `feat(core): add DSML envelope salvage for malformed tool-call leakage` —— Phase 1 + 2(代码 + 单测 + 集成)
  - `docs: log route Y completion and Bug A resolution` —— Phase 4(ledger 更新)
- [ ] 4.4 push,确认 `scripts/check-tracked-items.ts` PASS

## 3. 验证方式

| 层级 | 命令 / 检查 | 验收 |
|------|-------------|------|
| 单测 | `pnpm --filter "./packages/core" run test` | r7 byte-level 标本断言通过;≥10 例 0 失败 |
| 全量 | `pnpm run scan` | lint + typecheck + 全部 package 测试全绿 |
| 跟踪事项 | `tsx scripts/check-tracked-items.ts` | PASS |
| broader telemetry | 任意已跑 benchmark 的 `state.patches[].dsml_salvage_applied` 或 `state.patch_rounds[].dsml_salvage_applied` | 跨 fixture 累积观测到 ≥1 次 `=true` 即视为生效 |

**注意**:smoke `260520041442` 实证显示 salvage 在 rename-distill-state 这条 fixture 路径**触发率为零**(整 trial × 3 阶段 × 13 轮 + 3 repair patches 全 0)。原 plan v0.1 列的"定向 smoke / 回归 单 fixture 正向冲击"作为验收门槛**不成立**——salvage 触发受**多源上游 bug**(vLLM #40800 / pi-mono #3712 / sglang #14695 / vLLM #41240 / DeepSeek-V3.2 #29)概率影响,无法在单 fixture × 2 trial 里稳定复现 Bug A 场景。改为**纯部署验收**:代码正确(单测) + 接入正确(scan) + telemetry 透出(任意后续 benchmark 累积一次真实触发即落地证据)。Bug B 是更高频独立 corruption 源,优先级提升。

## 4. 依赖关系

- 无外部依赖。
- **不依赖** route X spec 的批准(两者并行,各自推进)。
- **不依赖** Bug B / Bug C 的修复(独立)。
- 复用 `packages/core/src/patch-parser.ts` 已有的 change-block 识别正则(单测引用同源常量,保持一致性)。

## 5. 不在本计划范围

1. ❌ **Bug B 修复**(`applyPatchLenient` 落点错位时无条件 splice):salvage 还原 `<PATCH>` 块后,内部 diff 仍可能行号错位 → 经现行 `applyPatchLenient` 仍会拼坏。独立议题,见 ledger §8 `patchloop-search-replace-risk-realized`(已有)与未来 unified-diff 健壮性 tracked item(待 Bug B 单独立项)。
2. ❌ **Bug C 修复**(repair 不收敛):salvage 给 repair 多了一次抓住 change 的机会,但不解决 repair 本身的工具预算耗散与收敛契约缺失,见 ledger §8 `patchloop-repair-upgrade`(已有)。
3. ❌ **协议改动**:不动 `<PATCH>` 协议形态、不动 prompt 告知模型"不要用 DSML"(由 salvage 兜底,不靠模型自律)。
4. ❌ **provider 客户端改动**:`packages/provider/src/client.ts` 不动,DSML 处理留在 core 解析层。
5. ❌ **static-scanner.ts 的 parseChanges 调用**:不是模型输出路径,不接 DSML 风险。
6. ❌ **route X 实施**:Phase 4 议题,本 plan 完成不解锁 Phase 4 启动条件。
7. ❌ **失败分类 / failure-matrix 调整**:rename-distill-state 失败模式改变后是否重新归类,由后续 benchmark 复审决定。

## 6. 风险与限制

1. **salvage 是启发式,可能 false-positive**:若模型在合法 `<PATCH>` 内文本中**碰巧出现 `<｜｜DSML｜｜>` 字面**(极少见),会被误判为 DSML 信封并被剥离。缓解:`recoverDsmlWrappedChange` 只在检测到**完整的标签结构**(`<` + `｜｜?DSML｜｜?` + 标识符 + `>`)时才动手;字面匹配单独散布的全角竖线不触发。
2. **闭标签合成的位置选择可能错位**:多个 `</｜｜?DSML｜｜?parameter>` 出现时,选错合成点会切断 change 块。缓解:第一版只处理"模型一轮发一个 DSML 信封"的主线模式;多信封场景返回 `recovered: false` 让 parsePatchTurn 走原流程(等于不打捞,不破坏)。
3. **salvage 后的 diff 仍会撞 Bug B**:salvage 把 `<PATCH>` 还原成功 → `applyPatch` 拿到合法 diff → `applyPatchLenient` 仍可能拼坏。验收口径不含"benchmark 必然 PASS",只含"失败模式改变"。
4. **DSML 规范若演进**(单竖线 / 双竖线 / 新分隔符)→ 单测覆盖目前已知两种,新形式需补单测 + 调常量。
5. **DSML 漏触发是多源上游 bug,不是单一机制**(2026-05-20 实证补充):
   - vLLM #40800 — 流式 chunk 切断 DSML 长开标签 → partial marker 作为 plain content 发出
   - pi-mono #3712 — NVIDIA 路由 emit raw DSML as assistant text(没翻译成 tool_calls)
   - sglang #14695 — V3.2 模型偶发缺 `｜DSML｜` marker
   - vLLM #41240 — V4 parser 是 V3.2 薄包装,`string="false"` typed parameter 边界缺陷
   - HuggingFace DeepSeek-V3.2 #29 — 模型对 completion endpoint 偶发以"老版本无 DSML"格式输出
   - HF 官方 encoding/README.md 原话:"For production use, additional error handling is recommended"
   - **含义**:salvage 触发频率由不可控的模型/推理层因素决定,DSH 端能做的最多就是兜底正确;无法通过改请求参数让 leak 必发或必不发。原"定向 smoke 验证 rename 不再 actualProtocolOps:[]"的验收口径过于乐观,改为部署正确性 + telemetry 累积观测(§3)。
