---
id: "semgrep-parser"
status: done
priority: p1
type: feature
spec_ref: "docs/specs/2026-05-01-static-scan-governance.md"
plan_ref: "docs/plans/2026-05-01-static-scan-governance-plan.md"
dependencies: []
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# 实现 Semgrep JSON parser

## Objective
为 `static-finding-parser.ts` 新增 Semgrep JSON 格式解析器，使 dsh 能标准化处理 `semgrep --json` 输出。这是 Static Scan Phase 2 中唯一未完成的 parser。

## Context
- 当前已有 4 个 parser：ESLint stylish、tsc diagnostics、SARIF v2.1.0、text fallback
- Parser 接口已定义：`StaticFindingParser { name, canParse, parse }`
- Parser 注册表 `PARSERS` 按顺序自动选择，fallback 兜底
- Semgrep 输出格式为 JSON，包含 `results` 数组，每条有 `check_id`、`path`、`start`/`end`、`extra.message`、`extra.severity`
- `semgrep --json` 示例输出参考：https://semgrep.dev/docs/cli-reference/

## Acceptance Criteria
- [ ] `semgrepParser` 实现 `StaticFindingParser` 接口
- [ ] `canParse()` 能识别 Semgrep JSON 输出（检测 `"results"` 数组 + `"check_id"` 字段）
- [ ] `parse()` 正确映射 severity（Semgrep 的 WARNING/ERROR/INFO → dsh warning/error/info）
- [ ] `parse()` 正确映射 category（semgrep check_id 前缀含 `security` → security，否则 unknown）
- [ ] 当 Semgrep 输出为 `[]`（无结果）时返回空数组
- [ ] parser 注册到 `PARSERS` 数组，优先级在 SARIF 之后、fallback 之前
- [ ] `pnpm --filter @dsh/core typecheck` 通过
- [ ] `pnpm --filter @dsh/core test` 通过

## Steps

### Step 1: 调研 Semgrep JSON 输出格式
- 确认 `semgrep scan --json` 的真实输出结构
- 如本机未安装 semgrep，用文档 + fixture 样本替代

### Step 2: 实现 parser
- 在 `static-finding-parser.ts` 中新增 `semgrepParser`
- `canParse`: 尝试 JSON.parse，检查 `results` 数组存在且首元素含 `check_id`
- `parse`: 遍历 `results`，映射字段到 `StaticScanFinding`

### Step 3: 注册 parser
- 在 `PARSERS` 数组中插入 `semgrepParser`，位置在 `sarifParser` 之后

### Step 4: 编写测试
- 新增 `static-finding-parser.test.ts` 中的 semgrep 相关测试用例
- 使用 fixture 文件（真实 Semgrep JSON 输出样本）进行测试

## Notes
- Semgrep 的 `extra.severity` 是字符串枚举：`"ERROR"`、`"WARNING"`、`"INFO"`
- Semgrep 的 `path` 通常是相对路径，直接使用即可
- Semgrep 输出中的 `extra.lines` 可放入 `raw` 字段
- 本机可能未安装 semgrep，测试 fixture 应包含手工构造的样本 JSON
