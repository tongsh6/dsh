# docs/reports/ — 三位一体治理法

> 治理依据：`CONSTITUTION.md` 原则 4（可审计与可回滚）、原则 5（实证驱动）

## 目录结构

```
docs/reports/
├── README.md               ← 本文件：治理规则
├── knowledge/              ← 提交到 Git —— 决策依据、分析报告、session 总结
├── runlogs/                ← .gitignore —— 机器生成的 benchmark 运行产物
└── .gitignore              ← /runlogs/
```

## 提交规则

### knowledge/ — 必须提交

人工撰写的知识文档，记录项目的关键决策和实证分析。包括：

| 类别 | 文件命名 | 示例 |
|------|---------|------|
| Phase 退出审查 | `phase-N-exit-review.md` | Phase 2 退出审查 |
| Session 总结 | `session-YYMMDD-summary.md` | 包含重要发现的 session 记录 |
| Benchmark 分析 | `YYMMDD-<descriptive-slug>.md` | 24 fixture 全量分析、特定问题 root cause |
| 对比报告 | `<tool-a>-vs-<tool-b>-comparison.md` | DSH vs OpenCode 对比 |

**提交条件**：满足以下任一条件即可提交到 `knowledge/`：
1. 被 `docs/project-ledger.md` §3（已验证事项）或 §7（关键证据索引）引用
2. 记录了项目的关键转折点或重大决策
3. 包含对其他开发者有用的 root cause 分析

### runlogs/ — 禁止提交

机器生成的 benchmark 运行产物，可重建。包括：

| 文件 | 说明 |
|------|------|
| `*/metadata.json` | Benchmark 运行元数据（时间、fixture 列表、参数） |
| `*/results.json` | 每个 fixture 的评分、文件变更、耗时等原始数据 |
| `*/report.md` | 自动生成的 benchmark 报告 |
| `*.txt` | 运行日志 |

**不提交原因**：
- 每次 benchmark 产生一个目录，线性增长无上限
- 可重建：重跑 benchmark 即可复现
- 引用方式：台账通过 report ID（如 `260509-165142`）索引，读者知道去 `runlogs/` 下按 ID 查找

## 基准线固化

被台账 §3 引用为 Phase baseline 的报告，在 `knowledge/` 中保存对应的分析文档（analysis.md），以确保即使原始 `runlogs/` 数据丢失，关键结论仍有据可查。

| Phase | Baseline Report ID | 知识文档 |
|-------|-------------------|---------|
| Phase 2→3 | `260508-003359` | `knowledge/260508-24-fixture-benchmark-analysis.md` |
| Phase 3（议题 B P6） | `260508-223235` | `knowledge/260508-verify-structured-benchmark-analysis.md` |
| Phase 3（议题 A+C P1） | 待跑 | — |

## 操作指南

### 新增知识文件

```bash
# 将分析报告放入 knowledge/
cp docs/reports/runlogs/260510-182450/analysis.md \
   docs/reports/knowledge/260510-<descriptive-slug>.md
git add docs/reports/knowledge/
git commit -m "docs: 添加 <描述> 分析报告"
```

### 查找历史运行数据

```bash
# 按 ID 查找
ls docs/reports/runlogs/260509-165142/

# 按日期范围查找
ls -d docs/reports/runlogs/26050[8-9]-*/
```
