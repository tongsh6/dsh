# Edits as DeepSeek-Native Tool Call SPEC

> 状态: in_review | 日期: 2026-05-20 | 最近同步: 2026-06-10 | 作者: 人类设计指令 + AI 落盘/核验
>
> 目标: 把文件编辑(`CREATE`/`PATCH`/`SEARCH_REPLACE`/`INSERT`/`DELETE`/`RENAME`)从当前的
> **content-XML 协议**升级为 **DeepSeek 原生工具调用**(`apply_patch` 等),让编辑与
> `read_file`/`grep_files`/`exec_shell` 共用同一个 DSML → `tool_calls` 通道,消除
> 当前「双通道劈裂」对 DeepSeek 原生工具习惯的对抗。
>
> **关联文档:** BLUEPRINT §2.1(执行引擎演进:XML 协议 → 智能工具调用)| CONSTITUTION 原则 1/3/5/6 |
> 关联 spec `docs/specs/2026-05-05-patch-loop-architecture.md`、
> `docs/specs/2026-05-19-patch-pipeline-coverage-state-machine.md` |
> 实证报告 `docs/reports/runlogs/260519155944-pie-replicated`(Bug A 历史实证)、
> `docs/reports/runlogs/260521151313-pie-replicated`(Phase 3 final baseline)

## 1. 背景与问题

### 1.1 实证证据(Bug A)

历史 runlog `docs/reports/runlogs/260519155944-pie-replicated`(干净环境、reps=1、6 trials)暴露了 Route X 的原始触发场景:

- `loam-refactor-rename-distill-state` × **card_on + card_off 全 FAIL**,`actualProtocolOps: []`、`filesChanged: []`、13 个 patch round 0 落地,3 个 repair patch `<empty>`。Part 2(stall 提示回归修复)正确触发,模型仍连续 3 轮 `invalid`。
- 早期 debug 抓到的真实 invalid 轮内容(provider-dedup trial2 r7):模型把一个完整合法的 `<PATCH>` unified diff **塞进 DeepSeek 原生 DSML 工具调用的 `<｜DSML｜parameter>`**;开标签被 API 吃掉、tool_calls **没兑现**,parameter 值 + 畸形闭标签(双竖线 `</｜｜DSML｜｜parameter>`)泄漏进 `content`;`<PATCH>` 丢了 `</PATCH>`、被 `parsePatchTurn` 判 `no action`、整段 diff 被丢弃。

2026-06-09 重新核验当前代码与最新 baseline 后,本 spec 的依据需要更新:

- 当前 `ToolName` 只有 `read_file` / `grep_files` / `exec_shell`;patch 阶段 policy 只允许 `read_file` / `grep_files`。编辑工具尚不存在。
- `tool-executor.ts` 的未知工具分支仍明确告诉模型:文件修改应写在 assistant content 的 change block 中,不要作为 tool calls。
- `patch-pipeline.ts` 仍通过 `parsePatchTurn(content, hasToolCalls)` 识别 content-XML change block;当 tool_calls 存在且 content 无 change block 时,只按探索工具处理。
- provider 已支持 `tools` / `tool_calls`,因此 provider 层不是 blocker。
- route Y salvage 已成为底座。最终 Phase 3 run `260521151313` 的机器数据中,`actualProtocolOps: []` 只剩 **1/168** trial,`dsmlSalvageAppliedRecords=60`,`dsmlSalvageAppliedRounds=122`;`loam-refactor-rename-distill-state` 已 **6/6 PASS**。所以 Route X 不再以"rename-distill-state 全 FAIL"作为当前 blocker,而是以"编辑通道仍非 DeepSeek-native、repair/execution 仍分裂"作为 Phase 4 执行引擎演进目标。

### 1.2 根因:DSH 把「动作」劈成两个通道

- DSH 现在用 DeepSeek 原生工具通道跑 `read_file`/`grep_files`/`exec_shell`,但把**文件编辑**单独放进 content 的纯文本 `<PATCH>` 协议。
- DeepSeek V4 是 tool-native agent 模型,**「执行动作」原生只有一个机制:工具调用**。模型受训本能就是「要交付任何动作 → 发一个工具调用」。
- 当模型决定交付编辑时,本能把它包进 DSML 工具调用。当工具调用因任何原因(hallucinated tool name、模型吐畸形 DSML token、推理引擎 DSML 解析半途崩坏)无法兑现成结构化 `tool_calls` 时,DSML 信封碎片连同里面的 `<PATCH>` 一起泄漏到 `content`,`</PATCH>` 被 `</｜｜DSML｜｜parameter>` 替换,`parsePatchTurn` 抓不住,整段编辑被丢弃。

### 1.3 历史合理性现已不成立

content-XML 协议在 Phase 1/2 是合理的:那时没有工具(Phase 1)或只有探索工具(Phase 2/3),并且当年的 function calling 处理大块多行 diff 撞 JSON-in-string 转义地狱。但 **DSML 的设计目的就是解决这个**——
官方文档原话:DSML 是「XML 式工具调用格式,降低 JSON-in-string 转义失败」;`string="true"` 让一个参数原样承载多行文本。**支撑当前协议的约束已不存在。**

## 2. 目标与非目标

### 2.1 目标

1. 编辑操作(`CREATE`/`PATCH`/`SEARCH_REPLACE`/`INSERT`/`DELETE`/`RENAME`)以**真实 DeepSeek 原生工具**的形式暴露给模型——具体工具切分(单一 `apply_patch` vs 多个细粒度工具)留待 §4 设计。
2. 工具参数以 DSML `string="true"` 原样承载 patch/SEARCH/REPLACE/INSERT 内容,避免 JSON 转义。
3. patch-parser、validator、apply 逻辑**复用**——通道变了,内容格式不变。Bug B 的应用层修复与本 spec 正交,各自推进。
4. 工具结果(apply_ok / apply_failed / coverage_delta / partial_failure 细分)原路返回给模型,纳入 explore loop 的 tool result 流。
5. patch 状态机的 contract/coverage/finalization/decide 逻辑(spec 2026-05-19)**不变**,只是「change 来自哪个通道」从 `parsePatchTurn(content)` 改为 `tool_calls` 路径。
6. 验证闭环(`runVerify`/`runRepair`/handoff)**不受影响**——原则 2 验证门禁不变。

### 2.2 非目标

1. ❌ **不替代 Bug A 的 salvage 修复(route Y)。** 模型仍可能吐畸形 DSML(token 写错、推理层翻译失败),route Y(DSML 泄漏 salvage)是底座,在本 spec 落地后仍然要存在。本 spec 把「需要跨通道」的频率降下来,不消除「跨了通道还泄漏」的兜底需求。
2. ❌ **不修 Bug B(`applyPatchLenient` 在落点错位时无条件 splice)。** 编辑内容传递通道改了,内容本身仍然是 unified diff / SEARCH_REPLACE / 等;`applyPatch` 的健壮性是独立议题。
3. ❌ **不动原则 7「文件系统是 API」。** 原则 7 管 DSH 对外边界(输入 `.dsh/config.yml`/state/项目文件,输出 patches/handoff/scan reports,不做 MCP/Web server/数据库)。本 spec 改的是**模型 ↔ DSH 内部通道**,不是 DSH ↔ 外部世界。新增工具是 DSH **进程内**工具,和现有 `read_file`/`grep_files`/`exec_shell` 同档。
4. ❌ **不做 Phase 4 Agent Loop 的其他部分**(repair 内联 patch、子 Agent、自主分解)。本 spec 是 Phase 4 执行引擎演进中**独立可拆**的一块。
5. ❌ **不删 content-XML 协议代码。** 通过 feature flag(类比 `PATCH_STATE_MACHINE_V2`)与新通道共存,保证可回退、可 A/B 对比。原则 5 要求实证数据决定迁移率。

## 3. 设计依据

- **原则 6「DeepSeek 原生」站在 route X 这边。** 原则 6 的原话:「协议设计优先考虑 DeepSeek 的成功率特征」。DeepSeek V4 是 tool-native 模型,DSML 是它「执行动作」的唯一原生机制。把编辑挡在工具通道外,是 protocol design 在和模型受训本能拔河。Bug A 是这场拔河的直接代价(provider-dedup r7 实证;rename-distill-state 两个配置 0/2)。
- **BLUEPRINT §2.1 的演进方向就是 route X。** §2.1 把执行引擎的演进画为「XML 协议解析 → 智能工具调用 → Agent Loop」。能力全景图(§1)的工具层显式列了「文件操作」。当前 content-XML 协议被 BLUEPRINT 自己称为 Phase 1 的「闭眼出 patch」——要被演进掉的起点,不是哲学承诺。
- **DSML 天然就是为这种载荷设计的。** 官方 DSML 规范的设计理由就是「降低 JSON-in-string 大块结构化载荷的转义失败」。`<｜DSML｜parameter string="true">$VALUE</｜DSML｜parameter>` 让一个多行 patch 原样过去,不需要任何转义。这正是当年支撑 content-XML 协议的反向理由——「function calling 传大 diff 不可靠」——的当代解。
- **竞品锚点。** BLUEPRINT「Claude Code 之于 Claude ≈ DSH 之于 DeepSeek」。Claude Code 的文件编辑是工具(Edit/Write)。真正 DeepSeek-native 的镜像应当是用 DeepSeek 原生工具通道交付编辑。当前 content-XML 反而是「最不 DeepSeek 原生」的那一部分。
- **实证驱动(原则 5)是先验授权,不是先验结论。** 本 spec 的成功标准是 **N≥3 randomized A/B benchmark 显示工具通道的 testsPassed 不退化**(§6),不能凭设计直觉就 land。

## 4. 架构与数据模型(概要,待 Phase 4 实施时细化)

### 4.1 工具切分

采用 **方案 A: 单一 `apply_patch` 工具 + `protocol_op` 分支**。

理由:

- 当前内部变更模型已经是统一分支(`PatchTurnAction` / `SingleChange`),6 个细粒度工具会重复描述并扩大模型决策面。
- `apply_patch` 名称与 route Y 的 DSML salvage 标本一致,也是模型已经倾向 hallucinate 的编辑工具名;把 hallucinated tool name 变成真实工具,比另起 6 个名字更贴近 DeepSeek 现有行为。
- v1 仍保持"一轮一个编辑动作"约束。若模型同轮输出多个 `apply_patch` tool_calls,该轮判 invalid,不批量执行。

工具参数 v1:

| 参数 | 适用 op | 必填 | 说明 |
|------|--------|------|------|
| `protocol_op` | all | yes | `CREATE` / `PATCH` / `SEARCH_REPLACE` / `INSERT` / `DELETE` / `RENAME` |
| `path` | CREATE/PATCH/SEARCH_REPLACE/INSERT/DELETE | conditional | 目标文件相对路径 |
| `from` / `to` | RENAME | conditional | rename 源/目标相对路径 |
| `content` | CREATE/INSERT | conditional | 文件内容或插入内容 |
| `patch` | PATCH | conditional | unified diff 内容,不含额外解释 |
| `search` / `replace` | SEARCH_REPLACE | conditional | 精确 search/replace 文本 |
| `position` / `anchor` | INSERT | conditional | 复用现有 INSERT 协议字段 |

### 4.2 接 patch-parser 复用

工具通道不能绕过现有 patch 安全边界。`apply_patch` tool_call 先被转换为现有 `SingleChange` / raw block 形态,再走 `applySingleChange()`、checkpoint/rollback、`PatchCoverageValidator`、managed_files 和 telemetry。

第一版不让 generic `executeToolCallsForPolicy()` 直接写文件。写入由 `patch-pipeline.ts` 拥有事务边界;tool executor 可提供参数规范化/格式化 helper,但不能在脱离 patch 状态机的路径里修改项目文件。

### 4.3 状态机集成

`runPatchPipeline`(2026-05-19 spec)的状态机不变;`runPatchExplore` 内的「拿一个 change action」按以下顺序处理:

1. 如果 tool_calls 中恰好有一个 `apply_patch`,且 content 中没有 content-XML change block,把该 tool_call 转为 `PatchTurnAction.kind="change"` 并应用。
2. 如果 tool_calls 是 `read_file` / `grep_files`,维持当前探索工具逻辑。
3. 如果同轮同时存在 `apply_patch` 和探索工具、多个 `apply_patch`、或 `apply_patch` + content change block,判 invalid,不执行任何写入。
4. feature flag 关闭时,`apply_patch` 工具不暴露给模型;content-XML 路径保持当前行为。

### 4.4 工具结果回路

当 `apply_patch` tool_call 被执行后,patch pipeline 必须把 assistant tool_call 消息和对应 tool result 消息写回对话上下文,再继续下一轮或收口。tool result 只包含结构化 apply/coverage 结果,不回显大段文件内容:

- `apply_status`: `ok` / `failed`
- `files_changed`
- `coverage_delta`
- `missing_required_files`
- `error_class`(失败时)
- `error`(失败时)
- `hint`(失败时)

### 4.5 Feature flag 与配置

新增配置与环境变量:

- `.dsh/config.yml` `patch.edits_as_native_tool: boolean`
- env `PATCH_EDITS_AS_NATIVE_TOOL`

默认值第一阶段为 `false`;实施分支和 benchmark runner 显式打开做 A/B。只有 N≥3 A/B 不退化并完成 ledger 复审后,才允许讨论默认开启。

## 5. 与仓库现实的对齐(概要)

- `packages/core/src/tool-definitions.ts`:新增 `apply_patch` 工具定义(JSON Schema),并让 patch phase policy 在 flag 开启时暴露它。
- `packages/core/src/tool-executor.ts`:新增参数规范化/格式化 helper;不得在 generic executor 中绕过 patch pipeline 写文件。
- `packages/core/src/patch-pipeline.ts`(2026-05-19):`runPatchExplore` 的 change-detection 路径加 `apply_patch` tool_call 分支,仍走 `applySingleChange`。
- `packages/provider/src/client.ts`:无改动(已支持 `tools`/`tool_calls`)。
- `packages/eval/` / `scripts/benchmark-pie-replicated.ts`:metadata 加 feature flag 字段,runner 支持 A/B 对照,并在 patch round actions / native edit observability 中保留 `apply_patch` tool records、`change.source` 与 native apply error class。
- 现有 content-XML 协议代码、`parsePatchTurn` 与默认 prompt:**保留**;`patch.edits_as_native_tool` 开启时切到 native edit prompt。

## 6. 成功标准

1. **功能验收**:`PATCH_EDITS_AS_NATIVE_TOOL=true` 时 patch phase 暴露 `apply_patch`;模型返回单个 `apply_patch` tool_call 时,DSH 通过同一 checkpoint/rollback + `applySingleChange` + coverage validator 路径应用变更。
2. **回退验收**:`PATCH_EDITS_AS_NATIVE_TOOL=false` 时不暴露 `apply_patch`,content-XML 路径与当前 baseline 字符级行为保持一致(除配置字段存在外)。
3. **契约验收**:多个 edit tool_calls、edit + read/grep 混合、edit + content change block 均被拒绝且不写文件。
4. **telemetry 验收**:patch round 记录 change 来源(`content_xml` / `tool_call`)、`actualProtocolOps`、apply status、coverage delta;benchmark metadata 记录 flag 状态。
5. **N≥3 randomized A/B benchmark**:工具通道的 `testsPassed` 不低于 content-XML baseline,以 Wilson 95% CI 判断;高方差 / split / excluded fixture 继续单独标注。
6. **failure-mode 验收**:工具通道下 `actualProtocolOps:[]` + `repair_exhausted` 比例不高于 content-XML baseline;route Y salvage 仍保留且 telemetry 可见。
7. **范围验收**:不新增 fixture-specific hint,不恢复 code-result deterministic repair,不把系统代写业务代码作为 Phase 4 能力证据。

## 7. 风险与限制

1. **DSML 仍可能畸形泄漏。** 模型自己把 token 写错(实测:双竖线 `｜｜` 而不是规范单竖线 `｜`)是模型/推理层问题,**任何**工具调用都可能踩——只是 hallucinated tool 最容易踩。route X 把跨通道的需求消除,但「畸形 DSML 泄漏」的兜底仍需 route Y。两者并行,不互替。
2. **工具参数尺寸上限。** DeepSeek API 对 tool parameter 的尺寸有无上限、超大 patch(>10K 行)是否会被截断,需先用小工具实测,不能假设。
3. **多文件 change 的协议约束。** 现行 patch 状态机要求「一轮一个 change block」;工具调用同一轮可包含多个 tool_calls,需明确是否允许「一轮多个编辑工具」或仍约束 1 个(倾向后者,保持状态机不变)。
4. **回退成本。** content-XML 路径必须长期保留(通过 flag),原则 5 canonical wiring 验收规则约束:legacy 退役前生产调用点迁移率必须 100%、退出条件登记 ledger §8。本 spec 第一版只双轨,不退役。
5. **prompt/参数遵守风险。** patch 阶段 native edit system prompt 已重写为「告诉模型用 `apply_patch` 工具,不要在 content 里写 `<PATCH>`」。post-prompt A/B 已证明模型会尝试 native edit,但实测 9 轮 `apply_patch` 均 invalid,主要来自 op 名称和结构化参数形态不匹配。当前实现已补 operation alias/inference、direct `ChangeBlock` conversion 与 embedded XML fallback,但仍需 DeepSeek targeted A/B 复验证明 successful native apply。
6. **Bug B 不在本 spec 范围。** 工具通道下,模型仍会发出行号有误的 unified diff;`applyPatchLenient` hardening 已作为独立修复落地,本 spec 不再扩大 patch 应用语义。
7. **route X 不消除 DSML 漏触发的上游 bug。** 漏到 content 是**多源上游 bug**:vLLM #40800(流式 chunk 切断)、pi-mono #3712(NVIDIA 路由)、sglang #14695(模型偶发缺 marker)、vLLM #41240(V4 parser 边界)、DeepSeek-V3.2 #29(双格式)。即使 DSH 把编辑迁到原生工具通道,**DSML 翻译失败的同一批上游 bug 仍会让 tool_call 半途崩坏**——只是 leak 落点从"假 tool 漏到 content"变成"真 tool 漏到 content"。route X 减少**触发条件**(模型不再 hallucinate edit tool name),但不消除**触发概率**。**route Y(salvage)是无论如何要保留的底座**,与 route X 并行不互替——这一点在 §2.2 非目标 #1 已明示,§7 此处补充上游公开 bug 链接作为证据。

## 8. 实施策略

### Phase 0: spec/task/ledger 对齐

- 本 spec 转 `in_review`,同步 README/BLUEPRINT/project-ledger 的 Phase 4 口径。
- 新建首个实现 task:`docs/tasks/2026-06-09-phase4-edits-as-native-tool-p1.md`。
- 仅文档与任务,不改 runtime。

### Phase 1: 工具定义与 flag wiring

- 新增 `apply_patch` tool definition,扩展 `ToolName` 与 patch policy。
- 新增 `PATCH_EDITS_AS_NATIVE_TOOL` / `patch.edits_as_native_tool` flag,默认 `false`。
- 测试:flag off 不暴露工具;flag on 只在 patch phase 暴露工具。

### Phase 2: tool_call → SingleChange 转换

- 实现 `apply_patch` 参数校验与 `SingleChange` 转换。
- 保持一轮一个编辑动作;混合/多 edit tool_calls 全部 invalid。
- 测试覆盖 6 个 `protocol_op` 和拒绝路径。

### Phase 3: patch-pipeline 集成

- `runPatchExplore` 优先识别单个 `apply_patch` tool_call,走 `applySingleChange`、checkpoint/rollback、coverage delta、managed_files、patch_rounds。
- 写回 assistant tool_call + tool result messages,保证后续 DeepSeek 对话合法。
- 保留 content-XML fallback 与 route Y salvage。

### Phase 4: eval / A/B evidence

- replicated benchmark metadata 记录 edit channel flag。
- 先跑 loam-refactor targeted N≥3 A/B;稳定后扩大到 28 fixture N≥3。
- 报告必须包含 `testsPassed`、`actualProtocolOps:[]`、`repair_exhausted`、`dsml_salvage_applied`、successful native `apply_patch` applications、tool_call invalid 分类。

### 回退策略

- 运行时回退:设 `PATCH_EDITS_AS_NATIVE_TOOL=false` 或删除 `.dsh/config.yml` flag,立即回到 content-XML。
- 代码回退:第一版不删除 content-XML parser/prompt/telemetry,因此 git revert 单个 Route X 实施 commit 不应影响 Phase 3 已验证路径。
- 证据回退:若 A/B 显示工具通道退化,保持 flag 默认 false,ledger 中 `phase4-edits-as-native-tool` 维持 in_progress/waiting,不得宣称 Phase 4 能力提升。

### 2026-06-09 实施状态

- Phase 0–3 最小 runtime 切片已落地于 `docs/tasks/2026-06-09-phase4-edits-as-native-tool-p1.md`。
- `apply_patch` 仅在 `PATCH_EDITS_AS_NATIVE_TOOL` / `patch.edits_as_native_tool` 开启时暴露;默认仍为 content-XML。
- `apply_patch` tool_call 转换后复用 `applySingleChange`、checkpoint/rollback、coverage validator、managed_files 和 patch telemetry;generic tool executor 不写文件。
- flag on 时 patch prompt 已切到 native edit contract:编辑轮必须发一个 `apply_patch` tool_call,不得在 assistant content 中输出 XML change block。
- native edit 模式下的分析停滞保护只暂停探索工具;`apply_patch` 仍保留,避免运行时在要求 native edit 时关掉唯一编辑通道。
- `apply_patch` 参数转换已改为直接构造 `ChangeBlock`,支持常见 operation alias/inference,并避免 structured INSERT anchor 因 XML attribute 渲染被误拒。
- `packages/eval/src/benchmark-runner.ts` 与 `scripts/benchmark-pie-replicated.ts` 已保留 `change.source`、`apply_patch` tool records 和 native edit observability,便于区分 successful native apply、apply error 与 invalid attempts。
- invalid native edit round 已记录脱敏后的 tool-call arguments;大段 edit payload 字段只保留长度,避免 benchmark 结果丢失真实参数形态同时不泄露大段文件内容。
- 2026-06-11 residual 收敛实现已落地: native apply 失败会记录 `error_class` 并在 tool result 中返回 `hint`;benchmark summary 会按 native error class 聚合;`protocol_op: "DONE"` / `"<DONE/>"` 被识别为完成意图而不是文件编辑失败。授权后的 targeted run `260611121509` 已验证该 slice:Card ON 9/9,Card OFF 7/9,native apply error 9 -> 3,invalid native rounds 5 -> 2。
- `scripts/benchmark-pie-replicated.ts` metadata/report 已记录 `patch.edits_as_native_tool` flag。
- 2026-06-09 targeted loam-refactor N=3 A/B 已完成:baseline `260609121703` 为 16/18,flag-on `260609132227` 为 18/18,`repair_exhausted` 2 -> 0,详见 `docs/reports/knowledge/20260609-route-x-native-edit-ab.md`。
- post-prompt targeted loam-refactor N=3 A/B 已完成:baseline `260609145253` 为 18/18,flag-on `260609155633` 为 17/18。flag-on run 已观察到 native attempts,但 successful native `apply_patch` applications 为 0,invalid native rounds 为 9;唯一 failed trial 是 patch 前的 `model_protocol_plan_invalid`。
- post-compat targeted loam-refactor N=3 A/B 已完成:baseline `260609173815` 为 17/18,flag-on `260610024705` 为 17/18。flag-on run 记录 72 次 `apply_patch` tool call、68 条 successful native apply、4 条 apply error、7 个 invalid native rounds、content XML 为 0。
- post-build telemetry targeted rerun `260610153758` 已完成:flag-on `loam-refactor*` 18/18,记录 76 次 `apply_patch` tool call、67 条 successful native apply、9 条 apply error、5 个 invalid native rounds、content XML 为 0;invalid 参数形态已可审,典型为 `protocol_op: DONE` / `<DONE/>`。
- targeted residual run `260611121509` 已完成:Card ON 9/9,Card OFF 7/9;native apply error 9 -> 3,invalid native rounds 5 -> 2,content XML 为 0,`DONE` tool-call 残余消失。残余失败为 `loam-refactor-provider-dedup` Card OFF 2 个 `repair_exhausted`,未覆盖 `anthropic.ts`。
- provider-dedup 聚焦实现已补 failed-assertion target repair 授权、active target 传播到 final no-tools repair request、以及 repair prose/no-change 后的一次强制 change-block retry。聚焦复跑 `260611132524` / `260611140036` / `260611143551` 均为 5/6,说明问题已从单纯 target omission 收窄到 repair 阶段空响应/无有效 change block 仍会消耗轮次。
- 当前结论:targeted successful native-call adoption 成立,residual slice 已降低 native edit 协议噪音;默认仍保持 flag off。下一步是 repair 结构化契约、空响应 telemetry 和 provider-dedup repair convergence,再进入 broader/stability evidence 与默认开启前 ledger 复审。

## 9. 禁止事项

1. ❌ **不修改原则 7。** 不引入 MCP、Web server、数据库、外部工具服务器。新增工具一律 DSH 进程内。
2. ❌ **不删 content-XML 协议代码。** 第一版必须双轨,凭实证决定退役时机。
3. ❌ **不绕过验证门禁。** 工具结果不能直接转 `patched`;仍走 PatchCoverageValidator → `runVerify` → 必要时 `runRepair`。
4. ❌ **不在本 spec 内联其他 Phase 4 议题。** Agent Loop、repair 内联 patch、子 Agent 各自走独立 spec。

## 10. 本 spec 引发的跟踪事项

> 转 in_review 前登记到 `docs/project-ledger.md` §8(CONSTITUTION 原则 8)。

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
| deferred | phase4-edits-as-native-tool | Phase 3 退出 + 本 spec review + N≥3 A/B benchmark 不退化 + successful native `apply_patch` application evidence + broader/stability evidence | P0 | targeted successful native apply 与 flag-on 18/18 已由 `260610153758` 证明;`260611121509` 证明 residual slice 降低 native errors,但 Card OFF provider-dedup 仍 repair_exhausted;默认开启仍需 broader/stability evidence 与 ledger 复审 |
| bug | patchloop-dsml-content-leak | route Y salvage 落地 + 单测 + 定向 benchmark | P1 | route X 不替代 route Y;Bug A 底座修复独立推进 |
| evidence | edits-as-native-tool-benchmark | 本 spec 实施分支稳定后启动 N≥3 randomized A/B,并记录 native tool_call adoption | P1 | 2026-06-11 targeted residual run `260611121509`:Card ON 9/9,Card OFF 7/9,native error-class summary 可用;下一步先收敛 provider-dedup Card OFF |

## 11. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-20 | v0.1 (draft skeleton) | 初始骨架:目标/非目标/设计依据/风险定型;架构与实施策略占位待 Phase 4 |
| 2026-06-09 | v0.2 (in_review) | 核验当前代码和 `260521151313` baseline;确定单一 `apply_patch` 工具方案、flag、状态机接入、实施 Phase 与 A/B 验收 |
| 2026-06-09 | v0.3 (runtime slice) | 默认关闭的 `apply_patch` tool_call 最小切片落地;保留 content-XML 回退;A/B evidence 仍待收集 |
| 2026-06-09 | v0.4 (flag-exposure A/B) | targeted loam-refactor N=3 A/B 完成:flag-on 18/18 vs baseline 16/18,但 native `apply_patch` tool_calls=0;默认仍 off,下一步转 native-call adoption |
| 2026-06-09 | v0.5 (native prompt contract) | flag-on patch prompt 切到 `apply_patch` native edit contract,停滞保护仅暂停探索工具并保留编辑工具;需复跑 targeted A/B 验证真实 adoption |
| 2026-06-09 | v0.6 (post-prompt A/B + compatibility) | post-prompt A/B:flag-on 17/18 vs baseline 18/18,native attempts 已出现但 9 轮均 invalid;补 direct ChangeBlock conversion、operation alias/inference 与 native observability,默认仍 off |
| 2026-06-10 | v0.7 (post-compat targeted A/B) | post-compat A/B:baseline 17/18,flag-on 17/18;flag-on 72 次 `apply_patch` tool call、68 条 successful native apply、content XML 为 0;默认仍 off,下一步 broader/stability |
| 2026-06-10 | v0.8 (invalid observability) | post-compat residual audit 发现 invalid native rounds 缺参数形态证据;补脱敏 tool-call arguments 留存,供下一轮 broader/stability 定位 `protocol_op` 偏差 |
| 2026-06-10 | v0.9 (post-build telemetry rerun) | `pnpm -r run build` 后重跑 flag-on targeted `260610153758`:18/18,76 次 `apply_patch` tool call、67 条 successful native apply、5 个 invalid native rounds 且参数形态可审;默认仍 off |
| 2026-06-11 | v0.10 (residual error classification) | native apply 失败记录 `error_class`/hint 并在 benchmark summary 聚合;`DONE` tool-call 终止意图转为 done;本地 scan 通过,DeepSeek targeted 复跑待外部数据传输风险授权 |
| 2026-06-11 | v0.11 (targeted residual rerun) | DeepSeek targeted `260611121509`:Card ON 9/9,Card OFF 7/9,native apply error 9 -> 3,invalid native rounds 5 -> 2,`DONE` residual 消失;provider-dedup Card OFF 仍 repair_exhausted |
