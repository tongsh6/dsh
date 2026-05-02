---
id: "parser-fixture-tests"
status: done
priority: p1
type: test
spec_ref: "docs/superpowers/specs/2026-05-01-static-scan-governance.md"
plan_ref: "docs/superpowers/plans/2026-05-01-static-scan-governance-plan.md"
dependencies: ["semgrep-parser"]
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# 为所有 parser 添加 fixture 测试

## Objective
为 `static-finding-parser.ts` 中的每个 parser 添加基于真实输出样本的 fixture 测试，确保解析器对各类扫描器输出的处理正确且稳定。覆盖 ESLint、tsc、SARIF(CodeQL/Gitleaks)、Semgrep、fallback 全链路。

## Context
- 当前 `static-finding-parser.ts` 已实现 5 个 parser（含待完成的 Semgrep），但测试覆盖不足
- 已有测试文件：`packages/core/src/static-finding-parser.test.ts`（需确认是否存在）
- Fixture 文件应放在 `packages/core/src/fixtures/static-scan/` 目录
- 每个 parser 至少需要一个正常输出样本 + 一个边界情况样本
- 这是 Static Scan Phase 2 验收标准中要求的："所有 parser 有 fixture 测试"

## Acceptance Criteria
- [ ] `packages/core/src/fixtures/static-scan/` 目录包含至少 6 个 fixture 文件
- [ ] ESLint stylish 格式：至少 1 个正常样本 fixture，覆盖 error/warning 两种 severity
- [ ] tsc diagnostics 格式：至少 1 个正常样本 fixture，覆盖 error/warning 两种输出
- [ ] SARIF CodeQL 格式：至少 1 个 fixture（可从 CI CodeQL workflow 输出获取灵感）
- [ ] SARIF Gitleaks 格式：至少 1 个 fixture
- [ ] Semgrep JSON 格式：至少 1 个 fixture + 1 个空结果 fixture
- [ ] Fallback parser：至少 1 个测试验证非结构化文本的正确兜底
- [ ] 所有 parser 的 `canParse` 方法有正向/负向测试
- [ ] `pnpm --filter @dsh/core test` 通过

## Steps

### Step 1: 创建 fixture 目录
- 创建 `packages/core/src/fixtures/static-scan/`

### Step 2: 收集/构造 fixture 文件
- `eslint-stylish-errors.txt` — ESLint stylish 格式的典型输出
- `tsc-diagnostics-errors.txt` — TypeScript 编译错误典型输出
- `codeql-sarif.json` — CodeQL SARIF v2.1.0 最小合法样本
- `gitleaks-sarif.json` — Gitleaks SARIF v2.1.0 最小合法样本
- `semgrep-findings.json` — Semgrep --json 典型输出
- `semgrep-empty.json` — Semgrep --json 空结果输出

### Step 3: 编写/扩展测试文件
- 确认 `static-finding-parser.test.ts` 结构
- 为每个 parser 添加 `canParse` 正向测试（传入匹配的 fixture）
- 为每个 parser 添加 `canParse` 负向测试（传入不匹配的格式）
- 为每个 parser 添加 `parse` 结果验证（字段映射正确性）

### Step 4: 验证
- `pnpm --filter @dsh/core typecheck`
- `pnpm --filter @dsh/core test`

## Notes
- Fixture 文件不宜过大（每个 < 2KB），只需覆盖解析器需要的关键字段
- SARIF fixture 可参考 CI 中 CodeQL workflow 的运行输出
- 如果测试文件 `static-finding-parser.test.ts` 不存在，需新建
