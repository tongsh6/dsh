# Plan Contract Finalization

> 状态: draft | 日期: 2026-05-18 | 作者: AI

## 1. 背景

`docs/reports/runlogs/260517183641-pie-replicated/` 完成了 28 fixtures × 3 reps × card_on/off 的 Phase 3 exit benchmark。Project Card on 达到 `59/84 = 70.2%`，但低于 off 的 `61/84 = 72.6%`，Phase 3 不可退出。

后续 failure classification 显示，失败里存在大量 PLAN 阶段协议失败：

| Failure Class | Card ON | Card OFF |
|---------------|---------|----------|
| `model_protocol_plan_invalid` | 16 | 11 |
| `provider_network_error` | 2 | 1 |
| `repair_exhausted` | 7 | 11 |

`DeepSeek 未返回有效的 FILES 块` 的 27 个样本全部发生在 plan 阶段 5 轮只读工具之后，且 `plan=false`，说明它们不是 fixture verification 失败，也不是 patch/repair 失败，而是 **工具探索态向最终机器契约态切换失败**。

## 2. 问题定义

当前 `runPlan` 在同一个 loop 里同时承担两个目标：

1. 允许模型用 `read_file` / `grep_files` 探索代码库。
2. 在工具上限后要求模型输出最终 `<PLAN>` / `<FILES>` / `<VERIFY>` / `<RISKS>` XML。

这导致模型在连续 tool-calling 状态后，突然被一条普通 user message 要求切换成机器协议输出。复杂任务和 Project Card 注入会放大该问题，但不是根因。

`<FILES>` 不是普通的展示字段。它是 DSH 后续 patch / scope completeness / repair / handoff 的机器契约，代表模型对“将修改哪些文件”的可审计承诺。缺失 `<FILES>` 时，系统不能安全进入 patch 阶段。

## 3. 目标

1. 让 PLAN 阶段失败可审计：保存最终 assistant 输出摘要或 sidecar，区分无 `<PLAN>`、无独立 `<FILES>`、自然语言回答、输出截断、provider/network。
2. 把 PLAN 拆为明确的 explore/finalize/validate 三段：
   - explore：允许只读工具，目标是收集事实。
   - finalize：禁用工具，目标是输出最终 XML 契约。
   - validate：本地严格校验契约。
3. 消除协议歧义：`<FILES>` 是唯一机器文件契约，`<PLAN>` 内不再要求重复的 `Files Involved` 列表。
4. 若做恢复，只允许基于模型自己的上一轮输出做 protocol repair；禁止从 fixture `expectedFiles`、benchmark metadata 或 task prompt 中注入答案。
5. 保持 `testsPassed` 口径不变；任何恢复必须标记为可审计 evidence。

## 4. 非目标

1. 不为单个 fixture 添加 answer hint。
2. 不把 `<PLAN>` 内的自然语言文件列表静默当作 `<FILES>` 通过。
3. 不从 benchmark fixture metadata 自动补 `<FILES>`。
4. 不改变 patch / verify / repair 的通过标准。
5. 不在本 spec 中处理 Project Card 文案回归；该项依赖 PLAN contract 稳定后再分析。

## 5. 设计方向

### 5.1 Plan Explore

保留现有 `read_file` / `grep_files` 只读工具能力，继续限制轮数，记录工具轮证据。

输出要求：
- explore 阶段不需要模型输出最终 XML。
- 工具上限不是失败；它只是进入 finalize 的边界。

### 5.2 Plan Finalize

进入 finalize 后：

- 禁用 tools。
- 用短 prompt 明确说明：工具探索已结束；现在只输出 XML。
- 输入包括任务描述、压缩后的探索证据、必要上下文和协议模板。
- 模型不得继续请求工具。

### 5.3 Plan Validate

本地校验：

- 必须有 `<PLAN>`。
- 必须有独立 `<FILES>`，且每行是将要修改的文件。
- 必须有 `<RISKS>`。
- `<VERIFY>` / `<VERIFY_STRATEGY>` 保持现有规则。

失败时写入 failure evidence，不能只抛出不可解释错误。

### 5.4 Protocol Repair

如果 finalize 输出缺 `<FILES>`：

- 最多做一次 protocol repair。
- 输入只包含模型上一轮输出和协议模板。
- 明确要求“把你自己的上一轮回答转换成合法 XML”。
- 不提供 fixture expectedFiles。
- 成功时在 state / benchmark result 中标记 `protocol_recovered=true` 和 recovery reason。

## 6. 验收标准

1. PLAN failure sidecar / diagnostics 能区分至少：missing_plan、missing_files、natural_language_only、provider_network、truncated_or_empty、unknown。
2. 单测覆盖 explore 达到工具上限后进入 finalize，finalize 请求不带 tools。
3. 单测覆盖 `<PLAN>` 内有 `Files Involved` 但缺独立 `<FILES>` 时不能静默通过。
4. 单测覆盖 protocol repair 只从上一轮模型输出恢复，不能读取 fixture expectedFiles。
5. `pnpm run scan` 通过。
6. targeted replicated benchmark 中 `model_protocol_plan_invalid` 明显下降，且报告包含 recovery/diagnostics 统计。
7. clean full N=3 重新证明 Phase 3：Project Card on `testsPassed >60%` 且相对 off 为正。

## 7. 风险

- finalize prompt 太短可能丢失关键上下文；需要保留探索摘要和已读文件路径。
- protocol repair 过宽可能退化成 parser 宽松化；必须保留“只基于上一轮模型输出”的边界。
- 降低 PLAN 协议失败后，真实 patch/repair 失败会暴露更多；这是期望结果，不应继续用 fixture-specific patch 掩盖。
