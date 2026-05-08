# Verify 协议结构化 SPEC（议题 B）

> 状态: active | 日期: 2026-05-08 | 作者: tongshuanglong | 用户批准: 2026-05-08
>
> 目标: 把 fixture/config 的 verify 从纯 shell command list 升级为「结构化断言 + shell 兜底」混合协议，让常见判定（file_exists / file_not_exists / file_contains / file_not_contains）的失败信号原生结构化呈现，repair 阶段不再依赖 shell 字符串反推。

## 1. 问题定义

### 1.1 当前状态

verify 阶段的数据模型（已通过 patch-completeness §3.5 + verify 命令列表化升级到的状态）：

- `DshConfig.verify.commands?: string[]` —— 一组 shell 命令，逐条独立执行
- `VerifyRunResult = { command, status, exit_code, output: stdout+stderr, duration_ms }`
- 对模型/repair 暴露的失败信号：`failed: <command>\n<stdout+stderr>`

### 1.2 痛点 / 实证证据

**24 fixture 全量 benchmark 数据**（`docs/reports/260508-003359/`）：

verify 命令模式分布（91 条命令）：

| 类别 | 数量 | 占比 |
|------|------|:----:|
| shell_other（awk / 复合） | 47 | 52% |
| shell_test_runner（pytest/pnpm/mvn） | 16 | 18% |
| file_not_exists（`! test -f X`） | 10 | 11% |
| shell_cd（`cd backend && mvn ...`） | 8 | 9% |
| file_exists（`test -f X`） | 5 | 5% |
| file_contains_simple（`grep -q 'pat' file`） | 5 | 5% |

**痛点 1：静默断言诊断丢失**

`grep -q`、`test -f`、`! test -f` 三类失败时 stdout/stderr 都是空。失败信号只有 exit_code 1 + 整条命令字符串。模型在 repair 阶段无法自动识别"是 pattern 没找到"还是"文件不存在"还是"路径写错"。

**实证**：`rh-mixed-dashboard-generated-at-backend` 失败时 verify 输出仅有 `failed: grep -q 'generatedAt' .../DashboardController.java\n` ——repair 模型必须自行解析 shell 命令字符串才能推断"应该在 Controller.java 中加 generatedAt"，可靠性低。

**痛点 2：fixture-false-positive 隐蔽**

24 fixture 全量复审已确认至少 2 个 false-positive（pi-refactor-read-text、rh-test-dashboard-version）：plan 期望改 ≥2 文件但 fixture verify 命令只对 1 个文件断言，导致 base testsPassed=true 是假阳性。结构化断言可以把"对每个 expectedFile 都做覆盖性检查"做成强制 schema 约束，让 fixture 作者无法漏断言。

**痛点 3：上一回合脆弱实现的反思（已撤回）**

上一回合在 `verifier.ts` 引入过 `extractGrepQDiagnostic` 用正则反推 shell 命令语义——脆弱、命令字符串解析式、覆盖范围有限，代码评审中已识别为"打补丁式"修改并撤回。议题 B 是这个反思引出的**正确解法**：从协议层面声明断言语义，不让 verifier 猜。

### 1.3 与最终目标的关系

CONSTITUTION 原则 5（实证驱动）+ 原则 2（验证闭环）：评测体系是项目实证依据的根。verify 失败信号清晰度直接影响：
- repair 成功率（信号弱 → repair 没法定位问题）
- fixture 作者声明意图的能力（fixture 是 ground truth，必须能精确表达"什么算通过"）
- benchmark 数据可信度（false-positive 是数据污染源）

BLUEPRINT Phase 3 起点 baseline `testsPassed=11/24=45%`。议题 B 是 Phase 3 把 testsPassed 从 45% 提到 >60% 的关键工具——**让真实失败被看见、让模型有结构化诊断信号**。

## 2. 目标与非目标

### 2.1 目标

1. 引入"结构化断言"作为一等公民，与"shell 命令"并列；fixture 优先用结构化、shell 作为兜底
2. 实现 4 类高频结构化断言：`file_exists` / `file_not_exists` / `file_contains` / `file_not_contains`
3. 每类断言失败时由 verifier 原生生成结构化诊断（不依赖 shell 字符串解析）
4. 向后兼容：现有 `verificationCommands: string[]` 自动映射为 `type: shell` 断言；不强制重写
5. 高价值 fixture（产生过 false-positive 或 patch-completeness 副作用的）迁移到结构化断言，作为试点
6. fixture-false-positive-audit 跟踪事项可在本 spec 实施过程中并行清理

### 2.2 非目标

1. ❌ 不重写所有 fixture 的 verify 命令（76% 是 shell 测试运行器，shell 是合适表达）
2. ❌ 不引入复杂表达式（json_path、xml_xpath、regex 命名捕获等）—— 如 fixture 需要可写 shell
3. ❌ 不引入"断言依赖关系"（A 通过才跑 B）—— 复用 list 顺序 + shell `&&` 满足
4. ❌ 不动 shell 类断言的执行行为（仍走 `runCommand`）
5. ❌ 不做 verify 重试 / 缓存 / 并行（独立议题）

## 3. 设计

### 3.1 数据模型

`VerifyAssertion` 类型（联合类型）：

```ts
type VerifyAssertion =
  | { type: "file_exists"; file: string; name?: string }
  | { type: "file_not_exists"; file: string; name?: string }
  | { type: "file_contains"; file: string; pattern: string; regex?: boolean; name?: string }
  | { type: "file_not_contains"; file: string; pattern: string; regex?: boolean; name?: string }
  | { type: "shell"; command: string; timeout_ms?: number; name?: string };
```

字段说明：
- `name`（可选）：人读名称，如 `controller_has_generatedAt`；用于报告与 repair hint。缺省时用 type+target 自动生成
- `pattern` 默认是字面量子串匹配；`regex: true` 才使用 JavaScript RegExp
- `file` 路径相对 fixture cwd，与 shell 行为一致
- `timeout_ms` 仅 shell 适用，缺省 120000ms

### 3.2 fixture YAML 升级

新字段 `verifications: VerifyAssertion[]`：

```yaml
verifications:
  - type: file_contains
    file: backend/.../DashboardController.java
    pattern: generatedAt
    name: controller_has_generatedAt
  - type: shell
    command: cd backend && mvn test -pl releasehub-interfaces -am -q
    name: maven_test_passes
```

旧字段 `verificationCommands: string[]` 保留，与 `verifications` 互斥（不允许同时声明，schema 校验阶段失败）。loader 把 `verificationCommands` 隐式转为全 shell 类型的 `verifications`。

### 3.3 DshConfig schema

`DshConfig.verify` 加：

```ts
verify?: {
  test?: string;
  lint?: string;
  typecheck?: string;
  build?: string;
  commands?: string[];           // 已存在
  assertions?: VerifyAssertion[]; // 新
}
```

优先级（在 `resolveVerifyAssertions` helper 中）：
1. `assertions` 非空 → 直接使用
2. else `commands` 非空 → 自动包装为全 shell 类型的 assertions
3. else 回落到 test/lint/typecheck 三槽（同样包装为 shell）

### 3.4 verifier 行为

新增 `runAssertion(assertion: VerifyAssertion, cwd: string): VerifyRunResult`：

| type | 实现 | 失败时 output |
|------|------|--------------|
| file_exists | `fs.existsSync(path.join(cwd, file))` | `assertion 'file_exists' failed: file does not exist: <file>` |
| file_not_exists | 同上取反 | `assertion 'file_not_exists' failed: file should not exist but does: <file>` |
| file_contains | 读文件 + `String.includes(pattern)` 或 `RegExp.test()` | `assertion 'file_contains' failed: file '<file>' does not contain pattern '<pattern>'` |
| file_not_contains | 同上取反 | `assertion 'file_not_contains' failed: file '<file>' contains pattern '<pattern>' (should not)` |
| shell | 现有 `runCommand` | 不变 |

非 shell 类型的 `command` 字段（VerifyRunResult.command）填 `<type> ${file}` 供报告显示。

文件读取失败（路径不存在 / 权限）：file_contains 系列视为"pattern 不存在"判失败，附带 `(reason: file unreadable)` 提示。

### 3.5 调用链整合

`runVerify`（pipeline.ts）：
- 当前调用 `runVerifyCommands(commands: string[], cwd)`
- 升级为 `runVerifyAssertions(assertions: VerifyAssertion[], cwd)`，内部按 type 分发
- 旧的 string[] 调用点全部转为先包装成 `{ type: "shell", command }[]` 再调用

`composeVerificationCommand` / `normalizeVerificationCommands`（benchmark-runner.ts）：
- 重命名为 `compileFixtureVerifications(fixture)`，返回 `VerifyAssertion[]`
- fixture 优先取 `verifications`，否则 `verificationCommands` 包装为 shell 类型

### 3.6 试点 fixture 迁移

本 spec 实施同时迁移 5 个高价值 fixture（产生过 false-positive 或 patch-completeness 副作用的）：

| fixture | 当前 commands | 迁移后 |
|---------|--------------|--------|
| rh-mixed-dashboard-generated-at-backend | grep -q + cd && mvn | file_contains + shell |
| pi-refactor-read-text | （audit 后补全 expectedFiles 覆盖） | file_contains × 3 + shell pytest |
| rh-test-dashboard-version | （audit 后补全） | file_exists × 2 + shell mvn |
| loam-docs-readme-distill-observability | grep -q + awk | file_contains + shell |
| rh-mixed-remove-starter-ping-demo-backend | ! test -f × 2 + cd && mvn | file_not_exists × 2 + shell |

剩余 19 个 fixture 不强制迁移；后续按需迁移由 fixture-false-positive-audit 工作驱动。

## 4. 数据模型 / 契约变更

| 文件 | 变更 |
|------|------|
| `packages/eval/src/task-fixtures.ts` | 加 `verifications` 字段 schema；与 `verificationCommands` 互斥校验 |
| `packages/eval/src/benchmark-runner.ts` | `normalizeVerificationCommands` → `compileFixtureVerifications`，返回 `VerifyAssertion[]` |
| `packages/repo/src/config-loader.ts` | `DshConfig.verify` 加 `assertions?: VerifyAssertion[]` |
| `packages/core/src/verifier.ts` | 加 `VerifyAssertion` 类型导出 + `runAssertion` + `runVerifyAssertions`；保留 `runCommand` 给 shell 类型复用 |
| `packages/core/src/pipeline.ts` | `resolveVerifyCommands` → `resolveVerifyAssertions`，返回类型升级 |
| `packages/core/src/repair-loop.ts` | verify_results 已是 VerifyRunResult，不变 |
| 5 个 fixture YAML | 迁移到 `verifications` 字段 |

无破坏性变更：旧 `verificationCommands` 保留 + 自动包装；旧 `verify.commands` 配置保留 + 自动包装。

## 5. 成功标准

### 5.1 功能验收

- [ ] 单测：4 类结构化断言各 ≥2 case（成功/失败 + 边界）
- [ ] 单测：旧 `verificationCommands` 自动包装为 `{type:shell}` 不破坏
- [ ] 单测：fixture YAML 同时声明 `verifications` 与 `verificationCommands` → schema 校验失败
- [ ] 单测：`runAssertion` 失败时 output 含结构化诊断字符串（断言类型 + 文件 + pattern）
- [ ] 单测：`resolveVerifyAssertions` 三优先级（assertions > commands > slots）

### 5.2 行为验收（数据驱动）

- [ ] 5 个迁移 fixture 在 `pnpm exec tsx run-benchmark.ts --filter=...` 单跑下：
  - 失败时 verifyOutput 包含结构化诊断（不是空 stderr）
  - 成功路径行为不变
- [ ] 24 fixture 全量重跑（vs `260508-003359` 基线）：
  - completed 仍 24/24
  - testsPassed 不下降（迁移本身不应改变测试结果，除非暴露 false-positive；至少 ≥11/24）
  - patch-completeness 副作用 fixture（pi-test-aief-l3）不应进一步恶化
- [ ] repair 阶段对 5 个迁移 fixture 中的失败 case，taskDescription 中包含结构化诊断字符串

### 5.3 性能 / 成本验收

- 单 fixture 平均耗时变化 ±10%（结构化断言比 grep -q 略快，因为不 fork 进程）
- 不引入额外 API 调用

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| `pattern` 字段语义混淆（substring vs regex） | 中 | fixture 作者误用导致漏检 | `regex: true` 显式开关；缺省 substring；schema 校验时 lint regex 字面量（`^`/`$`/`\\` 等） |
| 大文件 file_contains 性能 | 低 | I/O 开销 | 文件 >10MB 走流式读取；spec §3.4 实现时加 maxBytes 上限 |
| fixture 同时声明 verifications + verificationCommands 不互斥风险 | 低 | 行为歧义 | schema 校验阶段强制互斥，违反即抛错 |
| `name` 字段命名冲突（多个 file_contains 命中同一文件） | 低 | 报告里看不清 | 缺省命名加索引后缀 `<type>_<index>` |
| 迁移 5 fixture 引发新 false-positive | 中 | benchmark 数据短期波动 | 每个 fixture 迁移单独 commit + 单跑验证；24 全量在最后跑作为最终 baseline |

## 7. 实施策略

### 7.1 分 Phase

| Phase | 目标 | 关键产物 |
|-------|------|---------|
| P1 | `VerifyAssertion` 类型 + `runAssertion` 4 种实现 + 单测 | core/verifier.ts + verifier.test.ts |
| P2 | `resolveVerifyAssertions` 升级 + fallback 链路 + 单测 | core/pipeline.ts + pipeline.test.ts |
| P3 | DshConfig schema 加 assertions + fixture YAML schema 加 verifications + 互斥校验 + 单测 | repo/config-loader.ts + eval/task-fixtures.ts |
| P4 | benchmark-runner `compileFixtureVerifications` + 单测 | eval/benchmark-runner.ts |
| P5 | 迁移 5 个高价值 fixture（每个独立小 commit）+ 单跑验证 | fixture YAML + 实证 reports |
| P6 | 24 fixture 全量 benchmark 实证 + analysis.md | docs/reports/<run-id>/ |

### 7.2 回退策略

每 Phase 一个 commit。若实证退化（testsPassed < 11/24 基线 / 5 迁移 fixture 中 ≥2 个新 false-fail），按 P6→P5→P4→P3→P2→P1 顺序 revert。

### 7.3 不在本 spec 范围

- json_path / xml_xpath / 复杂表达式断言（遇到时再写独立 spec）
- verify 重试 / 缓存 / 并行（独立议题）
- fixture-false-positive-audit 全量审计（独立 evidence 跟踪事项；本 spec 仅试点 5 个）
- `plan-files-overlist` 修补（独立 debt，议题 B 实施过程中只评估，不修）

## 8. 不在本 spec 范围

同 §7.3。

## 9. 本 spec 引发的跟踪事项

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
| evidence | verify-protocol-structured-baseline | spec P6 完成时收集 | P1 | 5 fixture 迁移单跑 + 24 fixture 全量 vs 260508-003359 基线 |
| deferred | verify-assertion-extensions | 5 个迁移 fixture 实测后，若仍有 ≥3 个 fixture 在 shell_other 类无法表达 | P2 | 评估是否引入 json_path / regex_named_capture 等扩展类型 |

## 10. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-08 | v1.0 (draft) | 初始 spec |
