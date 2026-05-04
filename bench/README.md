# DSH Benchmark 系统

独立的、可重复的 DSH 验证体系。在真实目标项目上运行 Plan → Patch → Verify → Repair → Handoff 闭环，产出评测报告。

## 目标项目

| 项目 | 语言 | 包管理 | fixture 前缀 |
|------|------|--------|-------------|
| loamlog | TypeScript | pnpm | `loam-*` |
| pi-proof-forge | Python | pip | `pi-*` |
| release-hub | TypeScript | pnpm | `rh-*` |

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
expectedProtocolOperations:
  - PATCH
```

Fixture ID 前缀决定运行在哪个目标项目（`loam-*` → loamlog, `pi-*` → pi-proof-forge, `rh-*` → release-hub）。

## CI

GitHub Actions workflow 在 `.github/workflows/benchmark.yml`，每周六定时运行。手动触发：在 GitHub Actions 页面点击 "Run workflow"。
