# 2026-05-20 Bug A / Bug B / route Y / route X 综合发现归档

Date: 2026-05-20

## TL;DR

一轮深挖把 loam-refactor benchmark 持续低通过率拆成了**三个独立机制**,并把其中两个修了:

| 议题 | 性质 | 状态 | 实证强度 |
|---|---|---|---|
| **Bug A** —— DSML 信封漏到 `content`,内层 change 块闭标签被替换 → parsePatchTurn 判 invalid | 多源上游 bug(模型/推理层) | **route Y salvage 部署 + N=3 telemetry 0 触发** | r7 字节级标本一例;上游公开 bug ×5 |
| **Bug B** —— `applyPatchLenient` 5 缺陷合谋:`bestScore===0` 唯一拒绝 + ±5 窗口 + `li` 漂移 + 无核验 → 1/9 部分匹配 splice 9 行真代码 → Frankenstein 文件 | DSH 端纯本地代码 | **修复 + N=3 验证零回归** | r8 byte-level reproducer 与基准落盘逐字节相等(`=== true`) |
| **route X** —— 编辑从 content-XML 升级为 DeepSeek 原生工具(`apply_patch`) | 设计层张力,Phase 4 议题 | spec 骨架 draft | 待 Phase 4 启动 |
| **Part 2** —— v2 explore loop 静默暂停回归 → 注入显式 stall 警告 | 行为回归修复 | 修复已落地 | 单 trial 验证警告正确触发 |

**核心实证更正**:原"rename-distill-state 失败 = Bug A"被这一轮 N=3 telemetry 证伪 —— 18 trial × 205 patch round salvage 0 触发,可 rename-distill-state 仍 0/6 PASS。**Bug A 是真的,但不是 rename-distill-state 的主因**;那条 fixture 的真失败是**模型决策方差**(RENAME 拆 CREATE+DELETE / SEARCH_REPLACE 覆盖不全)。

## 一、Bug A —— DSML 信封漏到 content

### 1.1 机制(byte-level 实证)

`/tmp/dsh-patch-explore-debug.jsonl` entry 29 抓到的真实标本(provider-dedup trial2 explore r7,benchmark 当时判 `invalid: no action`):

```
Now update `openai-compatible.ts` to use `buildAuthHeaders`.

<PATCH>
--- a/packages/distill/src/providers/openai-compatible.ts
+++ b/packages/distill/src/providers/openai-compatible.ts
@@ -1,6 +1,7 @@
 import type { LLMProvider, LLMProviderConfig } from "@loamlog/core";
...
       const signal = createTimeoutSignal(timeoutMs);
</｜｜DSML｜｜parameter>      ← 不是 </PATCH>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>
```

模型把合法 unified diff 塞进 DeepSeek 原生 DSML 工具调用的 `<｜｜DSML｜｜parameter>`,**而该工具调用未能兑现成结构化 `tool_calls`**(`hasToolCalls=false` 已坐实)。DSML 信封碎片 + 内层 `<PATCH>` 全部泄漏进 `message.content`,`</PATCH>` 被 `</｜｜DSML｜｜parameter>` 替换。`extractPatchBlock`(`packages/core/src/patch-parser.ts:135`)正则 `/<PATCH>([\s\S]*?)<\/PATCH>/` 匹配失败 → 整段 diff 被丢弃。

### 1.2 关键字节验证

实际抓到的 token 是 **双全角竖线**(`<｜｜DSML｜｜...>`,U+FF5C ×2),而官方规范是**单全角竖线**(`<｜DSML｜...>`)。模型把 DSML 当**普通文本字符**吐出来,推理引擎工具解析器只认特殊 token、不认畸形字面文本,所以 `tool_calls` 为空。

### 1.3 上游 bug landscape(多源,非 DSH 集成错误)

| 公开 issue | 触发机制 |
|---|---|
| [vLLM #40800](https://github.com/vllm-project/vllm/issues/40800) | streaming + auto tool_choice 时 chunk 切断 DSML 长开标签,partial marker 作为 plain content 发出 |
| [pi-mono #3712](https://github.com/badlogic/pi-mono/issues/3712) | NVIDIA-hosted DeepSeek endpoint 把 raw DSML 当 assistant text 直接发,没翻译成 tool_calls |
| [sglang #14695](https://github.com/sgl-project/sglang/issues/14695) | V3.2 模型偶发缺 `｜DSML｜` marker |
| [vLLM #41240](https://github.com/vllm-project/vllm/issues/41240) | V4 parser 是 V3.2 薄包装,`string="false"` typed parameter 边界缺陷 |
| [HF DeepSeek-V3.2 #29](https://huggingface.co/deepseek-ai/DeepSeek-V3.2/discussions/29) | 模型对 completion endpoint 偶发以"老版本无 DSML"格式输出 |

[HF DeepSeek-V4-Pro `encoding/README.md`](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/blob/main/encoding/README.md) 官方原话:

> The `parse_message_from_completion_text` function is designed to handle well-formatted model output only. It does not attempt to correct or recover from malformed output that the model might occasionally generate. **For production use, additional error handling is recommended.**

业界一致结论:salvage 是下游必备保险。

### 1.4 route Y 实施(salvage 落地)

新模块 `packages/core/src/dsml-recovery.ts`:

- `recoverDsmlWrappedChange(content)` 检测 DSML 泄漏标记(单/双竖线全覆盖)→ 剥离全部 `<\/?｜｜?DSML｜｜?...>` 标签 → 对需要配对闭合的 change 块(`<PATCH>` / `<CREATE>` / `<INSERT>`)在末尾合成缺失闭标签
- 4 处解析点接入:`patch-pipeline.ts:339`(v2 explore)、`patch-pipeline.ts:574`(finalization)、`pipeline.ts:921`(legacy)、`repair-loop.ts:528`(repair 内 tool-call 循环)
- 完整 telemetry:`dsml_salvage_applied?: boolean` 字段同时在 `PatchRoundRecord`(explore/finalization)与 `PatchRecord`(repair)上
- 16 单测含 r7 byte-level 标本逐字节复现 + 2 端到端集成(salvage → parsePatchTurn 判定从 invalid 翻转到 change/PATCH)

### 1.5 N=3 telemetry 实证

跨 18 trial × 205 patch round,**salvage 全程 0 触发**。结合上游 bug landscape,结论:Bug A 真实存在但**触发率受不可控的推理引擎/路由因素影响**,在 `api.deepseek.com` 直连 + 非流式 chat 请求路径上**罕见**。route Y 是正确的 production 保险,但**无法在单 fixture × 任何 N 的 smoke 里稳定复现 Bug A 场景**。

### 1.6 已证伪的过度归因

我在挖 Bug A 的过程中曾下结论:**"rename-distill-state 0/2 全军覆没即此机制"**。N=3 实证(18 trial salvage 0 触发,rename-distill-state 仍 0/6 PASS)**证伪**了这个推广。

更正:Bug A r7 标本(provider-dedup)是真的,但**不是 rename-distill-state 的主因**。rename-distill-state 在本批 N=3 里的真失败模式是模型决策方差 ——RENAME 被拆成 CREATE+DELETE / SEARCH_REPLACE 覆盖不全 imports / partial_ok 但 verify 仍 fail。

教训:**N=1 实证不能支持机制级泛化**。CONSTITUTION 原则 5 "实证驱动 N≥3" 不只是 benchmark 显著性要求,也是 mechanism 归因纪律。

## 二、Bug B —— `applyPatchLenient` 5 缺陷合谋

### 2.1 实证复现(byte-level)

`/tmp/bugb-repro/repro.mjs`:用 r8 真实 patch text + `5e1d3ee` 原始 `openai-compatible.ts`,过 DSH 真实的 `parsePatchTurn → applyPatch` 路径,产出与基准实跑落盘的损坏文件**逐字节相等(`=== true`)**。

`/tmp/bugb-repro/which-layer.mjs` 进一步坐实:严格层 `diff.applyPatch` 对 r8 两个 hunk **都抛异常**(`Hunk at line N contained invalid line @@ -72,10 +72,7 @@`),落到兜底层 `applyPatchLenient`,由它产出损坏文件,且 `applyPatch` 主函数返回 **`success=true`**。

### 2.2 5 个并存缺陷(`packages/core/src/patch-parser.ts:1227-1310`)

| # | 缺陷 | 实证数字 |
|---|---|---|
| 1 | `bestScore === 0` 是**唯一拒绝条件**,任何非零得分都放行 | r8 hunk 2 拿到 1/9 部分匹配仍 splice 9 行真代码 |
| 2 | 搜索窗口 `±5` 太窄 | r8 hunk 2 真实落点偏 18 行,窗口 [66,76] 够不着真实位置 53 |
| 3 | `li` 用作源对齐下标,遇 `+` 行后漂移 off-by-one | r8 hunk 1 import 块 bestScore=4/6 而非 6/6,正是 `+` 行导致的下标漂移 |
| 4 | `toRemove` 含上下文行,无独立校验 | splice 落点错时 `splice(70, 删9, 插7)` 删源第 71-79 行真代码 → Frankenstein |
| 5 | apply 后无最终核验 | `writeFileSync` 直接落盘,无 invariant 守住 |

每个缺陷单独看都"勉强工作",但合谋之下 **行号偏差 >5 + 上下文部分撞中 → 必产 Frankenstein**。

### 2.3 修复(Phase 1+2+3 一次性合)

`applyPatchLenient` 完全重写:

- **`srcOffset` 替代 `li`** 修 off-by-one(只在非 `+` 行递增)
- **`bestScore === ctxLineCount && ctxLineCount > 0`** 严格阈值(完全匹配才接受)
- **搜索窗口从 ±5 扩为全文件扫描** + 多匹配位置 → 歧义拒绝 `return null`
- 跳过 `split("\n")` 末尾杂行(避免空字符串与空源行的伪匹配 —— 发现的 edge case)
- **apply 后 +/- delta 不变量**:累加 hunks 的 `+` 与 `-` 行数 vs `sourceLines` 长度增量校验,不通过 `return null`,**绝不 `writeFileSync` 产 Frankenstein 文件**

补丁工具铁律:**拼不准就该失败,绝不产出无法核验的文件**。fail 可被 repair 恢复;Frankenstein 文件污染所有后续轮次。

### 2.4 N=3 验证(零回归 + 微正向)

| apply_status(全 18 trial 累计 repair patch) | batch3 (pre-fix,N=3) | **本次 (post-fix,N=3)** | 变化 |
|---|---|---|---|
| ok | 15 | **19** | **+4** |
| partial_ok | 2 | 1 | -1 |
| failed,空 patch(`<empty>` 标记 / 模型没出活) | 23 | 21 | -2 |
| **failed,有内容(真的 apply 层拒绝)** | **5** | **3** | **-2** |

修复后 3 个"failed 非空"**全部是 7 字符 `<empty>` literal 标记**,**真正"apply 拒绝合法 diff"的数量是 0**。batch3 的 5 个里有真 diff 被拒绝(其中至少一部分可能正是 r8 类 Frankenstein 候选,修复前 lenient 应用产 Frankenstein,记录到 patch 字段里是 raw diff 但 verify 后失败)。

`testsPassed`:batch3 5/18 = 27.8% → 本次 **6/18 = 33.3%**(+5.5pp,Wilson CI 大概率重叠,**不能宣告显著改善但绝对零退化**)。

### 2.5 与 Bug A 的关系

salvage 把模型发的合法 `<PATCH>` 救回来,**Bug B** 把救回来的 diff **正确应用或干净拒绝**。两者各管一段、并行不互替。即使将来走 route X 把编辑迁到工具通道,内层 diff 仍要走 `applyPatch` / `applyPatchLenient`,Bug B 修复仍然必要。

## 三、route X —— 编辑作为 DeepSeek 原生工具

### 3.1 设计动机

DSH 现行「编辑走 content-XML、读/搜走工具通道」是 **Phase 1 遗留**。CONSTITUTION 原则 6「DeepSeek 原生」原话**「协议设计优先考虑 DeepSeek 的成功率特征」**。DeepSeek V4 是 tool-native agent 模型,执行"动作"的**唯一原生机制**是工具调用(DSML)。把编辑挡在工具通道外、塞 content,是逆着模型受训本能。

BLUEPRINT §2.1 执行引擎演进:**「XML 协议解析 → 智能工具调用 → Agent Loop」**。能力全景图 §1 工具层显式列了「文件操作」。route X 是 BLUEPRINT 自身画出来的方向,Phase 4 议题。

### 3.2 关键澄清(消除歧义)

我之前误把 route X 描述为"推翻原则 7「文件系统是 API」"。**这是过度解读**。原则 7 管 DSH **对外**边界(输入 / 输出 / 不做 MCP 服务器),**不规定** 模型 ↔ DSH 内部通道。DSH 已经用原生工具通道跑 `read_file` / `grep_files` / `exec_shell` 三个**进程内**工具,这从来没违反原则 7。再加一个 `apply_patch` 进程内工具同样不违反。

### 3.3 spec 骨架

`docs/specs/2026-05-20-edits-as-native-tool.md`(status: draft):
- §2 目标 / 非目标(关键非目标:不替代 route Y;不修 Bug B;不动原则 7;不删 content-XML 路径,双轨共存)
- §3 设计依据(原则 6 + BLUEPRINT §2.1 + DSML 设计目的 + 竞品锚点 Claude Code 编辑就是工具)
- §6 成功标准(N≥3 randomized A/B + rename 失败模式改变 + loam 聚合不退化)
- §7 风险(尤其:**route X 不消除上游 DSML leak**,同一批 bug 仍可能让 tool_call 半途崩坏;route Y 必须保留)
- §8 实施策略 TBD(BLUEPRINT 明确 Phase 4 在 Phase 3 退出条件满足前只允许设计澄清)

ledger §8 三条对应跟踪事项:
- `phase4-edits-as-native-tool` (deferred, P2, waiting)
- `edits-as-native-tool-benchmark` (evidence, P1, waiting)
- `patchloop-dsml-content-leak` (bug, P1, in_progress —— route Y 已部署,resolve_when 改为 telemetry-driven)

## 四、Part 2 —— v2 stall 警告回归修复

v2 patch state machine(`PATCH_STATE_MACHINE_V2`)在 `MAX_INITIAL_TOOLS_ONLY` 连续 tools 后**静默暂停**工具,而 legacy `runPatch` 当年有显式警告。回归实证:benchmark `260519132104` rename-distill-state 在工具暂停时模型连 3 轮发 prose,parsePatchTurn 判 `no action` × 3 → `repair_exhausted`。

`packages/core/src/patch-pipeline.ts` 新增 `buildToolsPausedWarning(contract, loop)`:第一次 `toolsPaused` 时注入显式 `## SYSTEM: TOOL ACCESS PAUSED` 警告,列出第一个 required target file 与合法 change tag。`toolsPauseAnnounced` 门保证每个 explore loop 只发一次。

实证 `260519155944`:Part 2 在 rename-distill-state 双 trial 都正确触发(连 10 tools → r11 警告)。模型仍连 3 轮 invalid 但**性质变了**:从"不知道该交付"到"明确被告知该交付仍未能"——后者的残余根因是 Bug A / 决策方差,**Part 2 必要但不充分**。

## 五、benchmark archaeology(N=1 vs N=3)

| run | DSH commit | N | total | card_on | card_off | route Y telemetry | 备注 |
|---|---|---|---|---|---|---|---|
| `260519085803` (batch 2) | pre-fix | 1 | 2/6 = 33% | 2/3 | 0/3 | n/a | |
| `260519103140` (batch 3) | c9e2717 | 3 | 5/18 = 28% | 3/9 | 2/9 | n/a | exec_shell 修后 |
| `260519132104` ~ `260519144910` | 含 TEMP DEBUG 埋点 | — | — | — | — | (调研用) | 抓 r7 标本 |
| `260519155944`(干净环境)| c9e2717 + Part 2 | 1 | 3/6 = **50%** | 1/3 | 2/3 | n/a | 上沿单点 |
| `260520031238` (route Y smoke, rename only) | route Y 装好 | 1 (rename ×2) | 0/2 | 0/1 | 0/1 | salvage 0 触发(无 repair telemetry) | |
| `260520041442` (full telemetry) | route Y + telemetry | 1 (rename ×2) | 1/2 | 0/1 | 1/1 | salvage 0/26 | **证伪了"rename = Bug A"** |
| `260520102137`(post-Bug-B,N=1) | 1369afb | 1 | **0/6 = 0%** | 0/3 | 0/3 | salvage 0/68 | **下沿单点(吓人但是方差)** |
| **`260520111608`(post-Bug-B,N=3)** | 1369afb | 3 | **6/18 = 33%** | 4/9 | 2/9 | salvage 0/205 | **中线 / 与 batch3 一致** |

观察:
- loam-refactor 在 N=1 上单点波动 0% / 17% / 33% / 50% 都出现过,**单点不可信**。
- N=3 把波动平滑到 28% / 33%(本次),与 batch3 同口径基本一致,**Bug B 修复零回归**。
- reorganize-tests 这次 5/6(83%),与 batch3 的 2/6(33%)反向,**单 fixture × N=6 仍剧烈方差**。
- rename-distill-state 累计 0+1+0+0 = 1/12 ≈ 8%,**比 high_variance 25-75% 区间更低**,可能需要单独归类。
- provider-dedup 累计 2+1 = 3/12 = 25%,刚踩 high_variance 下沿。
- **salvage 跨 8 runs 累计 0 触发**(loam-refactor 这条 fixture 集上)。

## 六、Constitutional lessons learned

### 6.1 原则 5(实证驱动 N≥3)不只是发布门禁,也是机制归因纪律

我在 N=1 数据(provider-dedup 一次 r7 标本)上下了"rename-distill-state 死于 Bug A"的结论,N=3 直接证伪。今后:**任何机制级泛化必须等 N≥3 telemetry**。

### 6.2 原则 7(文件系统是 API)的边界

原则 7 管 DSH 对外世界(输入 / 输出 / 不做 MCP),**不规定** 模型 ↔ DSH 内部通道。route X 这种"再加一个进程内工具"不违反原则 7。文档过度解读会成为推动力的人为障碍。

### 6.3 "上游 bug 不可控时,DSH 端能做的是兜底"

DSML leak 是真实多源上游 bug。**没有一个干净的"避免"开关**,改请求参数无法让 leak 必发或必不发。**业界一致做法**是下游加 salvage(HF 官方原话支持)。route Y 价值在于"production grade error handling",**不要求**在单 benchmark 内必触发——触发频次是上游 stochastic property,不是 DSH 端可控的成功指标。

### 6.4 补丁工具铁律 vs Phase 1 简化

DSH 早期 Phase 1 的 `applyPatchLenient` 选择"宽容 splice"的设计哲学,与 Phase 3 的安全要求冲突。Bug B 是"早期为了过例子写的兜底,在严肃 benchmark 下暴露为致命"的标准模式。**任何 patch apply 路径必须遵守**:拼不准就该失败,绝不产出无法核验的文件。

### 6.5 双 / 单实证修法

- **byte-level reproducer**(r7 标本 + r8 复现器)是金标准,把"我觉得是 X bug"翻译成"这里是逐字节的输入-输出证据"。
- **完整 telemetry**(`dsml_salvage_applied` 字段)是必备 —— 之前 0 触发但通过 route Y 无可观测,导致归因含糊。
- **N≥3** 是把单点方差平滑到真信号的最低门槛。

## 七、剩余跟踪事项

| ledger §8 id | status | 下一步 |
|---|---|---|
| `patchloop-dsml-content-leak` | in_progress | 等更广 fixture 集上观测到 salvage 真实触发 ≥1 次,转 resolved;或决策接受 0 触发 + 部署就位 也算 resolved |
| `patchloop-unified-diff-applylenient-corrupts` | **resolved** | N=3 验收完毕 |
| `phase4-edits-as-native-tool` | waiting | Phase 3 退出 + spec review/approved + A/B benchmark |
| `edits-as-native-tool-benchmark` | waiting | route X 实施分支稳定后启动 |
| `patchloop-repair-upgrade`(Bug C)| waiting | 本批 18 trial 累计 21 个 empty-patch repair 轮 ≈ 50%+ repair 摆烂率,是下一个高 ROI 目标 |

## 八、Artifact 索引

- 实施代码:`packages/core/src/dsml-recovery.ts`、`packages/core/src/dsml-recovery.test.ts`、`packages/core/src/patch-parser.ts:1227-1320` + 7 例 unit test
- spec 草稿:`docs/specs/2026-05-20-edits-as-native-tool.md`
- plan:`docs/plans/2026-05-20-dsml-recovery.md`、`docs/plans/2026-05-20-applylenient-hardening.md`
- 主 benchmark 数据(N=3):`docs/reports/runlogs/260520111608-pie-replicated/`
- byte-level reproducer:`/tmp/bugb-repro/`(本机,gitignored)+ `/tmp/dsh-patch-explore-debug.jsonl` r7 标本(同上)
- 上游 bug 链接:见 §1.3
- ledger §1 同日条目 + §8 相关 4 条跟踪事项

## 九、下一步

按 ROI 排序:

1. **Bug C —— repair 收敛契约**(`patchloop-repair-upgrade`):本批 N=3 累计 21/45 ≈ 47% 的 repair 轮发空 patch,是高频低产出"摆烂"模式。修这个对通过率的直接拉动可能比 Bug A/B 都大。
2. **全量 benchmark**(24 fixture × N=3):看 Bug B 修复在 loam-refactor 之外的影响面 + salvage 在其他 fixture / repo 上的触发情况。耗时 ~7-8h,需要选个时机跑。
3. **route X spec review + 实施 plan 起草**:Phase 4 议题,可以提前做设计澄清。
