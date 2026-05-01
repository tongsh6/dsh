# AI 后静态扫描治理推进计划

> **接手者必读:** 本计划是完整目标，不是当前实现说明。当前代码只完成 Phase 1 的基础闭环。后续推进必须按阶段更新 checkbox，不要把“能跑”误认为“做完”。

**关联 Spec:** `docs/superpowers/specs/2026-05-01-static-scan-governance.md`

**总目标:** 在任何 AI 代码实现后，自动执行静态扫描，选择 Top N 问题进行可审计修复，并保留扫描、选择、处理、复扫和剩余风险的完整记录。

---

## 文件映射

| 文件 | 当前/目标职责 |
|------|---------------|
| `packages/core/src/static-scanner.ts` | 当前基础实现；后续应拆出 parser/topn/repair/baseline |
| `packages/core/src/task-state.ts` | 保存 scan run 和 repair result |
| `packages/core/src/pipeline.ts` | 在 patch/repair 后触发扫描治理 |
| `packages/core/src/handoff-writer.ts` | 输出扫描与 Top N 修复记录 |
| `packages/cli/src/commands/init.ts` | 写入默认 `static_scan` 配置 |
| `packages/cli/src/commands/patch.ts` | 输出 patch 后扫描摘要 |
| `packages/cli/src/commands/repair.ts` | 输出 repair 后扫描摘要 |
| `packages/core/src/static-scanner.test.ts` | scanner/parser 单元测试 |
| `packages/core/src/pipeline.test.ts` | 端到端触发测试 |
| `.github/workflows/scan.yml` | CI 基础扫描 |
| `.github/workflows/codeql.yml` | CodeQL 安全扫描 |
| `.github/workflows/gitleaks.yml` | Secret 扫描 |

---

## Phase 1: 基础闭环（已完成）

目标：先把 dsh 内部 AI 实现后的静态扫描和 Top N 修复挂起来，但明确它只是基础闭环。

- [x] 新增静态扫描配置：
  - `static_scan.enabled`
  - `static_scan.command`
  - `static_scan.top_n`
- [x] `dsh init` 自动生成默认配置。
- [x] `dsh patch` 应用 AI patch 后自动扫描。
- [x] `dsh repair` 应用 AI repair patch 后自动扫描。
- [x] 扫描失败时选择 Top N findings 并发起一次 AI 修复。
- [x] 修复后自动复扫。
- [x] 原始扫描输出写入 `.dsh/static-scan/scan-round-N.txt`。
- [x] `task-state.json` 保存 `static_scan_runs`。
- [x] `task-state.json` 保存 `static_repair_results`。
- [x] handoff 输出扫描和 Top N 修复摘要。
- [x] 覆盖基础测试。
- [x] `pnpm run scan` 通过。

已知局限：

- finding schema 还不完整。
- Top N scoring 只有 severity + changed file + scanner order。
- parser 只覆盖 ESLint stylish 和 TypeScript diagnostics。
- 没有 baseline，历史问题和新增问题还可能混在一起。
- 没有独立 `dsh scan` 命令。

---

## Phase 2: 完整 Finding 标准化

目标：从“能解析一些输出”升级为“可扩展扫描器适配层”。

### Task 2.1: 拆分 parser 模块

Files:
- Create: `packages/core/src/static-finding-parser.ts`
- Modify: `packages/core/src/static-scanner.ts`
- Create/Modify: `packages/core/src/static-finding-parser.test.ts`

- [ ] 从 `static-scanner.ts` 中拆出 `parseStaticScanFindings`。
- [ ] 定义 parser interface：

```ts
interface StaticFindingParser {
  name: string;
  canParse(output: string, format?: string): boolean;
  parse(output: string, cwd: string, round: number): StaticScanFinding[];
}
```

- [ ] 保留通用文本 fallback parser。
- [ ] 为每个 parser 添加单测。

### Task 2.2: 扩展完整 finding schema

Files:
- Modify: `packages/core/src/task-state.ts`
- Modify: `packages/core/src/static-scanner.ts`
- Modify: tests

- [ ] 增加 `scanner` 字段。
- [ ] 增加 severity: `critical/high/error/medium/warning/low/info`。
- [ ] 增加 category: `bug/type/style/security/secret/dependency/unknown`。
- [ ] 增加 `raw` 字段或 raw hash。
- [ ] 提供向后兼容读取旧 state 的 migration/default。

### Task 2.3: 支持 SARIF

Files:
- Modify/Create: `packages/core/src/static-finding-parser.ts`
- Add fixtures under: `packages/core/src/fixtures/static-scan/`

- [ ] 解析 SARIF v2.1.0。
- [ ] 支持 CodeQL SARIF。
- [ ] 支持 Gitleaks SARIF。
- [ ] 映射 SARIF level 到 severity。
- [ ] 保留 rule id、help URI、location。

### Task 2.4: 支持 Semgrep JSON

- [ ] 支持 `semgrep --json` 输出。
- [ ] 映射 severity/category。
- [ ] 添加 fixture 和测试。

验收标准：

- [ ] ESLint/tsc/SARIF/Semgrep/Gitleaks 均能标准化为统一 findings。
- [ ] 所有 parser 有 fixture 测试。
- [ ] `pnpm run scan` 通过。

---

## Phase 3: Top N 选择策略完整化

目标：Top N 选择可配置、可解释、可审计。

Files:
- Create: `packages/core/src/static-topn.ts`
- Create: `packages/core/src/static-topn.test.ts`
- Modify: `packages/core/src/static-scanner.ts`
- Modify: `packages/core/src/task-state.ts`

Tasks:

- [ ] 拆出 `selectTopFindings`。
- [ ] 为每个 finding 生成 score breakdown。
- [ ] 记录每个维度得分：
  - severity
  - changed file
  - security/secret
  - build blocking
  - rule confidence
  - scanner order
- [ ] `.dsh/config.yml` 支持 selection 配置。
- [ ] `static_scan_runs.top_n_reasoning` 改为结构化数组，而不是纯字符串。
- [ ] handoff 展示每个 Top N 的选择原因。

验收标准：

- [ ] 同一组 findings 的 Top N 选择结果稳定。
- [ ] 每个被选 finding 都能解释为什么入选。
- [ ] 未入选高危 finding 必须有明确原因，否则测试失败。

---

## Phase 4: Baseline 与新增问题区分

目标：默认优先处理 AI 本轮引入的问题，而不是被历史债务淹没。

Files:
- Create: `packages/core/src/static-baseline.ts`
- Create: `packages/core/src/static-baseline.test.ts`
- Modify: `packages/core/src/static-scanner.ts`
- Modify: `packages/core/src/pipeline.ts`

Tasks:

- [ ] 在 AI patch 前可选执行 pre-scan。
- [ ] 在 AI patch 后执行 post-scan。
- [ ] 对 findings 做 fingerprint：
  - scanner
  - rule
  - file
  - line/message normalized hash
- [ ] 标记 finding 来源：
  - `new`
  - `existing`
  - `resolved`
  - `moved`
- [ ] Top N 默认优先 `new` findings。
- [ ] 配置支持：

```yaml
static_scan:
  baseline:
    mode: changed_only # all | changed_only | new_only
```

验收标准：

- [ ] 历史 lint 问题不会阻止 AI 修复本轮新增问题。
- [ ] handoff 能展示新增、已存在、已修复数量。

---

## Phase 5: 独立 CLI 与外部 AI 工具支持

目标：不只 dsh 自己的 AI patch 能触发，外部 AI 工具改代码后也能纳入治理。

Files:
- Create: `packages/cli/src/commands/scan.ts`
- Modify: `packages/cli/src/main.ts`
- Create: `packages/cli/src/commands/scan.test.ts`
- Modify: docs

Tasks:

- [ ] 新增 `dsh scan` 命令。
- [ ] 支持参数：
  - `--top-n <n>`
  - `--fix`
  - `--since <git-ref>`
  - `--format text|json`
  - `--changed-only`
- [ ] 支持只扫描 git changed files。
- [ ] 支持无 AI client 模式：只扫描不修复。
- [ ] 支持有 AI client 模式：扫描 + Top N 修复 + 复扫。
- [ ] 输出扫描报告路径。

外部 AI 工具接入：

- [ ] 提供 `dsh scan --since HEAD --fix` 作为 wrapper 后置命令。
- [ ] 提供 pre-commit hook 示例。
- [ ] 提供 CI usage 文档。

验收标准：

- [ ] 外部工具直接改文件后，运行 `dsh scan --changed-only --fix` 能生成同样的治理记录。

---

## Phase 6: CI 产物与 PR 治理

目标：把本地治理结果带到 PR，避免“本地跑过但 CI 不可审计”。

Files:
- Modify: `.github/workflows/scan.yml`
- Modify: `.github/workflows/codeql.yml`
- Modify: `.github/workflows/gitleaks.yml`
- Create: `scripts/collect-static-scan-artifacts.ts`（如需要）

Tasks:

- [ ] CI 上传 `.dsh/static-scan` 为 artifact。
- [ ] CI 输出 summary：
  - 总 findings
  - new findings
  - Top N
  - 是否已修复
- [ ] CodeQL/Gitleaks 输出 SARIF 后进入统一 parser。
- [ ] PR 注释或 job summary 展示治理结果。
- [ ] 配置失败策略：
  - `fail_on_new_high`
  - `fail_on_secret`
  - `allow_existing`

验收标准：

- [ ] PR 中能看到扫描摘要和 artifact。
- [ ] 高危新增问题会失败。
- [ ] 历史问题可通过 baseline 豁免。

---

## Phase 7: 治理报告升级

目标：handoff 成为完整审计记录，而不是简单摘要。

Files:
- Modify: `packages/core/src/handoff-writer.ts`
- Modify: `packages/core/src/handoff-writer.test.ts`

Tasks:

- [ ] 展示 scanner/version。
- [ ] 展示 baseline diff。
- [ ] 展示 Top N score breakdown。
- [ ] 展示未修复问题的人工建议。
- [ ] JSON handoff 保留完整结构。
- [ ] Markdown handoff 控制长度，长输出只给路径。

验收标准：

- [ ] 单看 handoff 就能回答：
  - 扫了什么？
  - 发现了什么？
  - 为什么选这些 Top N？
  - 怎么修的？
  - 修完还有什么风险？

---

## Phase 8: 稳定性与回归评测

目标：避免静态扫描治理能力自身回归。

Files:
- Add fixtures in `packages/eval/src/fixtures/`
- Modify: `packages/eval/src/benchmark-runner.ts`

Tasks:

- [ ] 增加 “AI patch 引入 lint 问题” fixture。
- [ ] 增加 “历史 lint 债务 + 新增 lint 问题” fixture。
- [ ] 增加 “Semgrep security finding” fixture。
- [ ] 增加 “secret leak finding” fixture。
- [ ] benchmark 报告增加：
  - static scan triggered rate
  - Top N repair success rate
  - false positive repair rate
  - unrelated change rate

验收标准：

- [ ] benchmark 能量化静态扫描治理能力。
- [ ] 每次协议升级后能看到该能力是否退化。

---

## 当前下一步

建议下一次继续从 Phase 2 开始：

1. 拆出 `static-finding-parser.ts`。
2. 扩展完整 finding schema。
3. 增加 SARIF parser。

这三步完成后，当前“基础闭环”才会变成“可扩展治理系统”的雏形。

