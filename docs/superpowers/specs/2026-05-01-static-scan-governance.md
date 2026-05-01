# AI 后静态扫描与 Top N 修复治理 SPEC

> 状态: draft | 日期: 2026-05-01 | 适用项目: dsh
>
> 目标: 任何 AI 工具完成代码实现后，系统都必须主动执行静态代码扫描，按可解释策略选择 Top N 问题进行修复，并完整保留扫描结果、Top N 选择依据、处理方式、修复 patch、复扫结果和剩余风险。

## 1. 问题定义

当前 AI coding 流程的风险不在于“能不能生成代码”，而在于生成代码之后缺少稳定治理闭环：

- AI 实现后可能引入 lint/type/security 问题。
- 静态扫描如果只作为手动命令，容易被遗漏。
- Top N 修复如果没有记录选择依据，后续无法审计为什么修这些、不修那些。
- 如果只做一次最小闭环，下一轮接手者不知道完整目标是什么。

因此本能力不是普通 lint 集成，而是 AI 代码实现后的质量治理系统。

## 2. 目标能力

完整系统必须满足：

1. 在 AI 生成并应用代码变更后自动触发静态扫描。
2. 支持多类扫描器输出：ESLint、TypeScript、Semgrep、CodeQL/SARIF、Gitleaks/SARIF、通用文本。
3. 将扫描输出标准化为统一 finding schema。
4. 以可解释策略选择 Top N findings。
5. 只对 Top N findings 发起 AI 修复，避免无限制重构。
6. 记录 Top N 的选择依据、处理方式、AI 修复 patch、应用结果。
7. 修复后自动复扫，并记录复扫结果与剩余问题。
8. 将完整过程写入 `.dsh/task-state.json`，原始扫描输出写入 `.dsh/static-scan/`。
9. 在 handoff 报告中展示扫描、Top N 处理和剩余风险。
10. 支持 CI/PR 中强制执行，防止本地绕过。

## 3. 非目标

第一阶段不追求：

- 一次性修复所有扫描问题。
- 替代 GitHub Advanced Security 或企业级 SAST 平台。
- 对所有语言提供等质量解析器。
- 自动决定安全问题是否可接受。

但架构必须为这些能力预留接口。

## 4. 触发语义

“任何 AI 工具完成代码实现后”在 dsh 内部定义为以下事件：

| 事件 | 说明 | 必须触发扫描 |
|------|------|--------------|
| `dsh patch` 成功应用 AI patch | 正常实现路径 | 是 |
| `dsh repair` 成功应用 AI repair patch | 验证失败后的 AI 修复 | 是 |
| `runFullPipeline` 中 patch/repair 成功 | 自动流水线 | 是 |
| 外部 AI 工具直接改工作树 | 不经过 dsh | 通过 git hook / CI / wrapper 补充 |

外部 AI 工具不经过 dsh 时，dsh 无法在进程内拦截，因此完整方案必须包含：

- 本地 pre-commit 或 post-command wrapper。
- PR CI 中强制 `pnpm run scan` 和安全扫描。
- 可选的 `dsh scan --since <base>` 独立命令。

## 5. 数据模型

### 5.1 Finding

统一 finding schema：

```ts
interface StaticScanFinding {
  id: string;
  scanner: string;
  rule: string | null;
  severity: "critical" | "high" | "error" | "medium" | "warning" | "low" | "info";
  category: "bug" | "type" | "style" | "security" | "secret" | "dependency" | "unknown";
  file: string;
  line: number | null;
  column: number | null;
  message: string;
  raw: unknown;
}
```

当前实现是精简版，仅包含 `error/warning/info` 等必要字段。后续需要扩展到上述完整 schema。

### 5.2 Scan Run

每次扫描必须记录：

- 扫描轮次。
- 扫描命令。
- 扫描器名称与版本。
- 退出码与耗时。
- 原始输出路径。
- 标准化 findings 总数。
- Top N 选择结果。
- Top N 选择依据。
- 创建时间。

### 5.3 Top N Repair Result

每次 Top N 修复必须记录：

- 修复轮次。
- 对应 scan round。
- 被选择的 finding ids。
- 处理策略。
- AI 返回 patch。
- patch 应用结果。
- 修改文件。
- 复扫 scan round。
- 复扫状态。
- 剩余 findings 数。
- 错误信息和人工介入建议。

## 6. Top N 选择策略

完整策略应为可配置、可审计的 scoring pipeline：

| 维度 | 默认权重 | 说明 |
|------|----------|------|
| Severity | 最高 | critical/high/error 优先 |
| Changed file | 高 | AI 本轮改动文件优先 |
| Security/secret | 高 | 安全和密钥问题优先 |
| Build blocking | 高 | 会导致 typecheck/build/test 失败的问题优先 |
| Rule confidence | 中 | 明确规则 ID 高于泛化文本 |
| Scanner order | 低 | 保留扫描器自身排序作为兜底 |

默认 Top N = 5，可通过 `.dsh/config.yml` 配置：

```yaml
static_scan:
  enabled: true
  command: pnpm run lint
  top_n: 5
  selection:
    prefer_changed_files: true
    severity_order: [critical, high, error, medium, warning, low, info]
```

## 7. 修复策略

AI 修复必须遵循：

1. 只修被选中的 Top N findings。
2. 不主动修复未选中问题，除非它是 Top N 问题的直接依赖。
3. 不做无关重构。
4. 输出结构化 patch。
5. 修复后必须复扫。
6. 若复扫仍失败，记录剩余问题，不隐瞒。

## 8. 报告要求

handoff 必须包含：

- 扫描命令和结果。
- 原始扫描输出路径。
- Top N 列表。
- 每个 Top N 被选中的原因。
- 修复方式摘要。
- 修复 patch 是否应用成功。
- 复扫结果。
- 剩余问题数和人工介入建议。

## 9. 完整架构

目标模块：

| 模块 | 职责 |
|------|------|
| `core/static-scanner.ts` | 执行扫描、标准化输出、保存原始日志 |
| `core/static-finding-parser.ts` | 解析 ESLint/tsc/SARIF/Semgrep/Gitleaks |
| `core/static-topn.ts` | Top N scoring 和解释生成 |
| `core/static-repair.ts` | 构造修复 prompt、应用 patch、复扫 |
| `core/static-baseline.ts` | 区分历史问题和本次新增问题 |
| `cli scan` | 手动运行静态扫描和 Top N 修复 |
| `handoff-writer.ts` | 输出治理报告 |
| `.github/workflows/*` | CI 强制执行 |

## 10. 当前实现状态

当前已完成的是 Phase 1 基础闭环：

- `dsh patch` 后自动扫描。
- `dsh repair` 后自动扫描。
- 支持配置 `static_scan.enabled/command/top_n`。
- 支持 ESLint stylish 和 TypeScript diagnostics 的基础解析。
- 记录 `static_scan_runs` 和 `static_repair_results`。
- 原始输出写入 `.dsh/static-scan/`。
- handoff 展示扫描和 Top N 修复摘要。

当前仍未完成：

- SARIF 解析。
- Semgrep/Gitleaks/CodeQL 原生适配。
- 历史 baseline 与新增问题区分。
- 完整 severity/category schema。
- 独立 `dsh scan` 命令。
- CI 中上传/保留治理产物。
- 外部 AI 工具通过 git hook/wrapper 触发。

