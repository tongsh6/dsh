# Plan Contract Finalization

> 状态: draft | 日期: 2026-05-18 | 作者: AI

## 1. 背景

`docs/reports/runlogs/260517183641-pie-replicated/` 的 Phase 3 benchmark 中，PLAN 阶段出现大量 `model_protocol_plan_invalid`，集中表现为模型在连续 `read_file` / `grep_files` 后缺失独立 `<FILES>` 块。`<FILES>` 是 DSH patch / completeness / repair / handoff 的机器文件契约，缺失时不能安全进入 patch。

## 2. 目标

PLAN 必须被实现为明确阶段：

1. `runPlanExplore(...)`：允许只读工具探索。
2. `runPlanFinalize(...)`：独立 no-tools 请求，输出最终 XML 契约。
3. `validatePlanContract(...)`：本地严格校验。
4. `repairPlanContractProtocol(...)`：最多一次协议修复。

函数名可等价，但必须有这些边界。finalize 不能只是 exploration loop 里追加一条 user message。

## 3. Finalize 请求

`runPlanFinalize` 必须：

- 禁用 tools。
- 使用专门 finalize prompt。
- 输入任务描述、必要 context、压缩后的探索证据、严格 XML 模板。
- 不传 tool definitions。
- 如果模型返回 `tool_calls`，判为 `tool_call_in_finalize`。

Model routing must be stage-specific and configurable. Defaults:

- `plan/explore`: `deepseek.flash_model` or `deepseek-v4-flash`, thinking enabled.
- `plan/finalize`: `deepseek.plan_finalize_model` / `deepseek.default_model` or `deepseek-v4-pro`, thinking enabled.
- `plan/protocol-repair`: `deepseek.plan_protocol_repair_model` / `deepseek.default_model` or `deepseek-v4-pro`, thinking enabled.

Supported `.dsh/config.yml` overrides:

```yaml
deepseek:
  plan_explore_model: deepseek-v4-flash
  plan_explore_thinking: true
  plan_finalize_model: deepseek-v4-pro
  plan_finalize_thinking: true
  plan_protocol_repair_model: deepseek-v4-pro
  plan_protocol_repair_thinking: true
```

模板：

```xml
<PLAN>
...
</PLAN>
<FILES>
- path/to/file
</FILES>
<VERIFY_STRATEGY>
...
</VERIFY_STRATEGY>
<VERIFY>
...
</VERIFY>
<RISKS>
- ...
- ...
</RISKS>
```

## 4. `<FILES>` Grammar

`<FILES>` 是唯一机器文件契约。

```xml
<FILES>
- path/to/file.ts
- another/file.md
</FILES>
```

有效条目规则：

- 每个非空行代表一个 repo-relative file path。
- bullet `-` 可以存在，但不属于路径。
- 不允许自然语言描述。
- 不允许 `path: reason`。
- 不允许绝对路径。
- 不允许 `../`。
- 不允许空字符串。
- 不允许 `N/A`、`none`、`无`。
- 不允许目录。
- 不允许 glob pattern，例如 `src/**/*.ts`。
- duplicate path 可以 dedupe，但必须记录 diagnostics。

`<PLAN>` 内的 `Files Involved` 不再作为机器契约解析。缺少独立 `<FILES>` 必须失败。

## 5. PLAN / RISKS / VERIFY

- 删除 natural-language fallback。没有显式 `<PLAN>` 必须判为 `missing_plan` 或 `natural_language_only`，不能进入 `planned`。
- `<RISKS>` 必须存在，并且至少包含两个非空、具体风险条目；否则判为 `missing_risks`。
- `<VERIFY>` / `<VERIFY_STRATEGY>` 不是 plan contract validity 的硬性必填项。缺失时后续 verification 继续使用项目或 fixture fallback。

## 6. Failure Reasons

validator 至少输出：

- `missing_plan`
- `missing_files`
- `missing_risks`
- `natural_language_only`
- `truncated_or_empty`
- `tool_call_in_finalize`
- `invalid_files_entry`
- `provider_network`
- `unknown`

## 7. Protocol Repair

finalize 输出无效时最多做一次 protocol repair。

repair 请求只允许包含：

- 上一轮 invalid finalize response。
- protocol template。
- validation error reason。

repair 请求严禁包含：

- fixture `expectedFiles`。
- benchmark metadata。
- task prompt。
- repo context。
- exploration evidence。
- tool results。
- Project Card 文案。

repair 成功后记录：

- `protocol_recovered = true`
- `protocol_recovery_reason = <reason>`

repair 失败后必须写 diagnostics，再抛错。

## 8. Diagnostics

`TaskState` 必须结构化保存 plan contract attempts，字段至少包含 stage、attempt、status、failure reason、response excerpt、response hash、finalize 前 tool rounds、protocol recovered、created timestamp。

`.dsh/plan-contract-diagnostics.json` 至少包含：

```json
{
  "attempts": [],
  "final_failure_reason": "missing_files",
  "protocol_recovered": false
}
```

失败时不能只依赖 localized error string。

## 9. Benchmark

benchmark result/report 必须读取结构化 plan diagnostics，新增：

- finalize attempt count。
- repair attempt count。
- protocol recovered。
- failure reason。
- final response excerpt。

failure classification 优先使用结构化 `failureReason`，并归类为 `model_protocol_plan_invalid`。`testsPassed` 定义保持不变。

report 必须包含：

- plan failure reason distribution。
- protocol recovery count。
- recovered 后 `testsPassed` 统计。
- `missing_files` / `natural_language_only` / `tool_call_in_finalize` / `truncated_or_empty` count。

## 10. 禁止事项

- 不从 fixture `expectedFiles` 自动补 `<FILES>`。
- 不从 benchmark metadata 自动补 `<FILES>`。
- 不从 task prompt 抽文件路径补 `<FILES>`。
- 不把 `<PLAN>` 内的 `Files Involved` 当作 `<FILES>`。
- 不放宽 parser 让自然语言通过。
- 不改变 `testsPassed` 口径。
- 不添加 fixture-specific hint。
- protocol repair 不得重新看 repo context 或工具结果。
- failure classification 不得只靠中文 error message。

## 11. 验收

- PLAN 阶段明确分为 explore / finalize / validate。
- finalize 请求不带 tools。
- `<FILES>` 是唯一机器文件契约。
- 缺独立 `<FILES>` 不能通过。
- natural-language fallback 被删除。
- protocol repair 最多一次，且只基于上一轮模型输出和协议模板。
- recovery 被结构化记录。
- PLAN 失败写入 diagnostics sidecar。
- benchmark result/report 包含 plan failure reason 和 recovery 统计。
- `pnpm run scan` 通过。
