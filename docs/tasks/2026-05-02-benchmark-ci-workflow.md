---
id: "benchmark-ci-workflow"
status: done
priority: p1
type: infra
spec_ref: "docs/specs/2026-05-02-benchmark-operability-fix.md"
plan_ref: "docs/plans/2026-05-02-benchmark-operability-fix.md"
dependencies: ["fixture-protocol-metadata"]
created: "2026-05-02"
updated: "2026-05-17"
assignee: "ai"
---

# 新建 Benchmark CI Workflow

## Objective
创建 `.github/workflows/benchmark.yml`，让 benchmark 支持定时自动执行和手动触发，消除每次手动运行的操作摩擦。

## Context
当前 benchmark 全靠手动：确认 API key → clone repo → 执行 → 复制报告。`.github/workflows/` 有 scan/codeql/gitleaks 三个 workflow，但无 benchmark workflow。

## Acceptance Criteria
- [x] `.github/workflows/benchmark.yml` 存在且语法正确
- [x] 支持 `workflow_dispatch` 手动触发
- [x] 支持每周定时执行（`schedule: 0 2 * * 6`）
- [x] timeout 设为 120 分钟
- [x] `DEEPSEEK_API_KEY` 走 GitHub Secrets
- [x] 结果以 artifact 形式存档
- [x] `run-benchmark.ts` 支持 `--ci` 模式（输出 JSON 行格式）
- [x] CI 模式下不执行需要交互的操作

## Notes
- 依赖 `fixture-protocol-metadata` task 完成（需要 benchmark runner 支持 --ci 模式）
- 不每次 push 触发（避免烧 API credit 和长期运行的 CI 队列）
- 完成证据：`.github/workflows/benchmark.yml`、`run-benchmark.ts`。
- 2026-05-17 追账：`docs/TASK-SPEC.md` §6 已将本任务标为 done，本文件同步 frontmatter 与 AC 状态；同时将 cron 从 `3 2 * * 6` 对齐为 AC 指定的 `0 2 * * 6`。
