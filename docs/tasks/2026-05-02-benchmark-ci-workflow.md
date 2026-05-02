---
id: "benchmark-ci-workflow"
status: ready
priority: p1
type: infra
spec_ref: "docs/specs/2026-05-02-benchmark-operability-fix.md"
plan_ref: "docs/plans/2026-05-02-benchmark-operability-fix.md"
dependencies: ["fixture-protocol-metadata"]
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# 新建 Benchmark CI Workflow

## Objective
创建 `.github/workflows/benchmark.yml`，让 benchmark 支持定时自动执行和手动触发，消除每次手动运行的操作摩擦。

## Context
当前 benchmark 全靠手动：确认 API key → clone repo → 执行 → 复制报告。`.github/workflows/` 有 scan/codeql/gitleaks 三个 workflow，但无 benchmark workflow。

## Acceptance Criteria
- [ ] `.github/workflows/benchmark.yml` 存在且语法正确
- [ ] 支持 `workflow_dispatch` 手动触发
- [ ] 支持每周定时执行（`schedule: 0 2 * * 6`）
- [ ] timeout 设为 120 分钟
- [ ] `DEEPSEEK_API_KEY` 走 GitHub Secrets
- [ ] 结果以 artifact 形式存档
- [ ] `run-benchmark.ts` 支持 `--ci` 模式（输出 JSON 行格式）
- [ ] CI 模式下不执行需要交互的操作

## Notes
- 依赖 `fixture-protocol-metadata` task 完成（需要 benchmark runner 支持 --ci 模式）
- 不每次 push 触发（避免烧 API credit 和长期运行的 CI 队列）
