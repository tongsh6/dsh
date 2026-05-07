# DSH Benchmark 系统

独立的、可重复的 DSH 验证体系。在真实目标项目上运行 Plan → Patch → Verify → Repair → Handoff 闭环，产出评测报告。

## 目标项目

| 项目 | 语言 | 包管理 | fixture 前缀 |
|------|------|--------|-------------|
| loamlog | TypeScript | pnpm | `loam-*` |
| pi-proof-forge | Python | pip | `pi-*` |
| release-hub | Java + Vue | Maven + pnpm | `rh-*` |

## 目录结构

```
~/dsh-bench/
├── repos/                    ← 目标项目克隆
│   ├── loamlog/
│   ├── pi-proof-forge/
│   └── release-hub/
└── results/                  ← （未来）本地评测结果归档
```

## 使用方式

### 1. 准备目标项目

```bash
bash bench/setup.sh
```

该脚本将目标项目克隆或更新到 `~/dsh-bench/repos/`。每个项目只克隆一次，后续运行只做 `git fetch + reset --hard`。

严格 benchmark 不直接跟随 live main。Phase 2 退出使用专用基线分支和固定提交：

| 项目 | 基线分支 |
|------|----------|
| loamlog | `dsh-benchmark/loamlog-phase2` |
| pi-proof-forge | `dsh-benchmark/pi-phase2` |
| release-hub | `dsh-benchmark/release-hub-phase2` |

fixture 可通过 `benchmarkRef.commit` 固定到具体 SHA；runner 会从该提交创建 `dsh-bench-<fixture-id>` 临时分支。live main 只作为 canary，不作为严格退出条件。

当前本地 Phase 2 基线：

| 项目 | 固定 commit |
|------|-------------|
| loamlog | `5e1d3ee57e853698beacd51f4d1a674f293c17d8` |
| pi-proof-forge | `d01d427be7d2999b4d17783b8982bb518c53ec9f` |
| release-hub | `180de500e6740433b578e60e1585dc6e315f5191` |

自定义工作区路径：`DSH_BENCH_ROOT=/path/to/bench bash bench/setup.sh`

### 2. 配置 API Key

```bash
export DEEPSEEK_API_KEY="sk-your-key"
```

### 3. 运行 Benchmark

```bash
# 从 DSH 项目根目录运行
pnpm exec tsx run-benchmark.ts

# CI 模式（JSON 输出 + 通过率阈值）
pnpm exec tsx run-benchmark.ts --ci
```

### 4. 查看报告

报告输出到 `docs/reports/<run-id>/`：
- `report.md` — Markdown 评测报告
- `results.json` — 详细结果数据
- `metadata.json` — 运行元数据

## Fixture 格式

Fixtures 位于 `packages/eval/src/fixtures/*.yaml`，按目标项目前缀组织：

```yaml
id: loam-bugfix-cli-error-handling
description: 修复 CLI 命令中缺失的错误处理
category: bugfix
taskPrompt: |
  请修复以下问题...
expectedFiles:
  - packages/cli/src/capture.ts
expectPass: true
verificationCommands:
  - "pnpm run typecheck"
  - "pnpm run test"
architectureRules:
  - 不改变命令的正常功能逻辑
maxRepairRounds: 2
benchmarkRef:
  repo: loamlog
  branch: dsh-benchmark/loamlog-phase2
  commit: 1234567890abcdef1234567890abcdef12345678
preflightFiles:
  - packages/cli/src/capture.ts
designGoal: 验证多文件局部错误处理修复能自然触发 PATCH/SEARCH_REPLACE
verificationGoal: typecheck 和定向测试证明修复行为，且只依赖 tracked 文件
expectedProtocolOperations:
  - PATCH
```

优先使用 `benchmarkRef.repo` 决定目标项目；没有该字段时，fixture ID 前缀仍作为兼容规则（`loam-*` → loamlog, `pi-*` → pi-proof-forge, `rh-*` → release-hub）。

严格 fixture 应填写：

- `benchmarkRef.repo` / `branch` / `commit`：固定目标 repo 和基线。
- `preflightFiles`：fixture 设计依赖的 tracked 文件；runner 会在模型执行前检查。
- `designGoal`：该 fixture 验证的工具能力或工程场景。
- `verificationGoal`：验证命令检查的物理结果。

## CI

GitHub Actions workflow 在 `.github/workflows/benchmark.yml`，每周六定时运行。手动触发：在 GitHub Actions 页面点击 "Run workflow"。
