# Edits as DeepSeek-Native Tool Call SPEC（骨架）

> 状态: draft（仅骨架，待人类批准与细化） | 日期: 2026-05-20 | 作者: 人类设计指令 + AI 落盘
>
> 目标: 把文件编辑(`CREATE`/`PATCH`/`SEARCH_REPLACE`/`INSERT`/`DELETE`/`RENAME`)从当前的
> **content-XML 协议**升级为 **DeepSeek 原生工具调用**(`apply_patch` 等),让编辑与
> `read_file`/`grep_files`/`exec_shell` 共用同一个 DSML → `tool_calls` 通道,消除
> 当前「双通道劈裂」对 DeepSeek 原生工具习惯的对抗。
>
> **关联文档:** BLUEPRINT §2.1(执行引擎演进:XML 协议 → 智能工具调用)| CONSTITUTION 原则 1/3/5/6 |
> 关联 spec `docs/specs/2026-05-05-patch-loop-architecture.md`、
> `docs/specs/2026-05-19-patch-pipeline-coverage-state-machine.md` |
> 实证报告 `docs/reports/runlogs/260519155944-pie-replicated`(Bug A 实证)

## 1. 背景与问题

### 1.1 实证证据(Bug A)

runlog `docs/reports/runlogs/260519155944-pie-replicated`(干净环境、reps=1、6 trials):

- `loam-refactor-rename-distill-state` × **card_on + card_off 全 FAIL**,`actualProtocolOps: []`、`filesChanged: []`、13 个 patch round 0 落地,3 个 repair patch `<empty>`。Part 2(stall 提示回归修复)正确触发,模型仍连续 3 轮 `invalid`。
- 早期 debug 抓到的真实 invalid 轮内容(provider-dedup trial2 r7):模型把一个完整合法的 `<PATCH>` unified diff **塞进 DeepSeek 原生 DSML 工具调用的 `<｜DSML｜parameter>`**;开标签被 API 吃掉、tool_calls **没兑现**,parameter 值 + 畸形闭标签(双竖线 `</｜｜DSML｜｜parameter>`)泄漏进 `content`;`<PATCH>` 丢了 `</PATCH>`、被 `parsePatchTurn` 判 `no action`、整段 diff 被丢弃。

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

### 4.1 工具切分(待定)

两种候选,均待评估:

- **方案 A: 单一 `apply_patch` 工具**,接 `protocol_op: CREATE|PATCH|SEARCH_REPLACE|INSERT|DELETE|RENAME` + 对应 payload。一个工具表达全部 6 种操作,模型决策面单一。
- **方案 B: 6 个细粒度工具**(`create_file`/`patch_file`/`search_replace`/...)。决策面分散但每个工具签名简单。

倾向:**方案 A**(单工具 + op 分支)。理由是 6 个工具的描述会非常重复,且模型已经在用 `parsePatchTurn` 的统一分支逻辑。但留待实施前比较。

### 4.2 接 patch-parser 复用

工具执行器接 `parseChanges()` / `applyPatch()` / SEARCH_REPLACE applier / 等现有逻辑——通道是新的,内容格式不变。Bug B 的修复(`applyPatchLenient` 删除前核验)与本 spec 解耦推进。

### 4.3 状态机集成

`runPatchPipeline`(2026-05-19 spec)的状态机不变;`runPatchExplore` 内的「拿一个 change action」从 `parsePatchTurn(content, hasToolCalls)` 改为「优先看 tool_calls(编辑工具)→ 退回看 content(content-XML protocol,旧通道,flag 关时禁用)」。

### 4.4 工具结果回路

工具结果原路注入对话上下文(和 `read_file` 同档),让模型在多轮里看到 apply 状态、coverage delta、partial failure。这一步在 v2 状态机的 `patchRoundActions` 里已为「tool result 流」留好接入点。

## 5. 与仓库现实的对齐(概要)

- `packages/core/src/tool-definitions.ts`:新增编辑工具定义(JSON Schema)。
- `packages/core/src/tool-executor.ts`:新增 dispatch 分支,调现有 patch-parser / apply 函数。
- `packages/core/src/patch-pipeline.ts`(2026-05-19):`runPatchExplore` 的 change-detection 路径加 tool_calls 分支。
- `packages/provider/src/client.ts`:无改动(已支持 `tools`/`tool_calls`)。
- `packages/eval/`:metadata 加 feature flag 字段,runner 支持 A/B 对照。
- 现有 content-XML 协议代码、`parsePatchTurn`、prompt 模板:**保留**,通过 flag 切换。

## 6. 成功标准

1. **N≥3 randomized A/B benchmark** 显示工具通道的 `testsPassed` ≥ content-XML 通道的 baseline,以 Wilson 95% CI 判断;高方差 fixture 单独标注。
2. **rename-distill-state 失败模式改变**:由当前的 `actualProtocolOps:[] + filesChanged:[]`(Bug A 全军覆没)变为 ≥1 个 actualProtocolOp 落地、`filesChanged` 非空。
3. **loam-refactor 聚合 `testsPassed` 不退化**。
4. **Bug A 残留率下降**:工具通道下,`actualProtocolOps:[]` + `repair_exhausted` 的 trial 比例 < content-XML 通道下的同指标。
5. 三阶段(explore / finalization / repair)全部走工具通道时,patch-coverage-telemetry 的 coverage 状态字段正确产出。

## 7. 风险与限制

1. **DSML 仍可能畸形泄漏。** 模型自己把 token 写错(实测:双竖线 `｜｜` 而不是规范单竖线 `｜`)是模型/推理层问题,**任何**工具调用都可能踩——只是 hallucinated tool 最容易踩。route X 把跨通道的需求消除,但「畸形 DSML 泄漏」的兜底仍需 route Y。两者并行,不互替。
2. **工具参数尺寸上限。** DeepSeek API 对 tool parameter 的尺寸有无上限、超大 patch(>10K 行)是否会被截断,需先用小工具实测,不能假设。
3. **多文件 change 的协议约束。** 现行 patch 状态机要求「一轮一个 change block」;工具调用同一轮可包含多个 tool_calls,需明确是否允许「一轮多个编辑工具」或仍约束 1 个(倾向后者,保持状态机不变)。
4. **回退成本。** content-XML 路径必须长期保留(通过 flag),原则 5 canonical wiring 验收规则约束:legacy 退役前生产调用点迁移率必须 100%、退出条件登记 ledger §8。本 spec 第一版只双轨,不退役。
5. **prompt 重写工作量。** patch 阶段的 system prompt / 用户消息模板需要重写为「告诉模型用 `apply_patch` 工具,不要在 content 里写 `<PATCH>`」,且需测 DeepSeek 是否真的会遵守这个指令(可能仍偶尔降级到 content)。
6. **Bug B 不在本 spec 范围。** 工具通道下,模型仍会发出行号有误的 unified diff;`applyPatchLenient` 当前的「拼不准也 splice」行为仍会拼坏文件。Bug B 必须独立修。

## 8. 实施策略

⚠️ **本节为占位,待 Phase 3 退出 + 本 spec 转 in_review 后细化。** Phase 4 实施时拆 Commit 1–N、列文件映射、定测试粒度。BLUEPRINT 明确「Phase 4 只能在 Phase 3 退出条件满足后进入正式实现;在此之前只允许做设计澄清」(BLUEPRINT §3 Phase 3 退出条件)。

## 9. 禁止事项

1. ❌ **不修改原则 7。** 不引入 MCP、Web server、数据库、外部工具服务器。新增工具一律 DSH 进程内。
2. ❌ **不删 content-XML 协议代码。** 第一版必须双轨,凭实证决定退役时机。
3. ❌ **不绕过验证门禁。** 工具结果不能直接转 `patched`;仍走 PatchCoverageValidator → `runVerify` → 必要时 `runRepair`。
4. ❌ **不在本 spec 内联其他 Phase 4 议题。** Agent Loop、repair 内联 patch、子 Agent 各自走独立 spec。

## 10. 本 spec 引发的跟踪事项

> 转 in_review 前登记到 `docs/project-ledger.md` §8(CONSTITUTION 原则 8)。

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
| deferred | phase4-edits-as-native-tool | Phase 3 退出 + 本 spec review + N≥3 A/B benchmark 不退化 | P2 | 本 spec 自身,跟踪到 Phase 4 实施前 |
| bug | patchloop-dsml-content-leak | route Y salvage 落地 + 单测 + 定向 benchmark | P1 | route X 不替代 route Y;Bug A 底座修复独立推进 |
| evidence | edits-as-native-tool-benchmark | 本 spec 实施分支稳定 ≥1 轮后启动 N≥3 randomized A/B | P1 | 成功标准 §6 的实证收集 |

## 11. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-20 | v0.1 (draft skeleton) | 初始骨架:目标/非目标/设计依据/风险定型;架构与实施策略占位待 Phase 4 |
