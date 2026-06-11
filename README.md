# DSH — DeepSeek-native, benchmark-gated, verify-first Coding Harness

一个围绕 DeepSeek 模型行为深度优化的终端编程助手，覆盖从任务理解、代码生成、验证修复到交接沉淀的验证闭环。

DSH provides a DeepSeek-oriented provider with official Chat Completion support, V4 Pro/Flash routing, thinking mode, streaming, staged tool calls, error retry semantics, cache/reasoning-token usage reporting, execution contracts, and persisted task evidence. Advanced beta capabilities such as strict tool calls, chat prefix, and FIM are exposed as experimental feature-flagged extension points, not enabled by default.

**核心流程:** Plan → Patch → Verify → Repair → Handoff
**当前阶段:** Phase 4 Agent Loop 实施期
**Phase 3 起点基线:** testsPassed 11/24 = 45%（`260508-003359` / `260509-165142`）
**Phase 3 退出实证:** 2026-05-22 N=3 replicated benchmark `260521151313`：Project Card on `64/84 = 76.2%`，Pure Standard on `52/63 = 82.5%`；loamlog 取得 Project Card 正向 lift（on `20/24 = 83.3%`，off `18/24 = 75.0%`），详见 `docs/reports/knowledge/20260522-phase3-exit-replicated-benchmark.md`
**Phase 4 当前目标:** 推进 Route X（文件编辑转 DeepSeek-native `apply_patch` 工具通道）与后续 Agent Loop 编排。2026-06-11 targeted residual run `260611121509` 显示 flag-on `loam-refactor*` Card ON 9/9、Card OFF 7/9；native apply error 从上一轮 9 降到 3，invalid native rounds 从 5 降到 2，content XML 仍为 0，`DONE` tool-call 残余已消失。后续 provider-dedup 聚焦复跑 `260611132524` / `260611140036` / `260611143551` 验证了 failed-assertion target 授权、final repair target 传播和 no-change retry 有改善但不稳定：三轮均为 5/6，残余仍是 `repair_exhausted`。Route X targeted adoption 已成立，但默认仍关闭；下一步不是继续扩样，而是先收敛 repair 空响应/结构化契约，再做 broader/stability 复审。

## 快速开始

### 安装

```bash
git clone https://github.com/tongsh6/dsh.git
cd dsh
pnpm install
pnpm -r run build
```

### 配置

```bash
# 初始化项目配置（仓库内本地运行）
node packages/cli/dist/main.js init

# 设置 API Key（二选一）
export DEEPSEEK_API_KEY="sk-your-key"
# 或手动写入 .dsh/config.yml 的 deepseek.api_key 字段
```

### 使用

```bash
node packages/cli/dist/main.js plan "修复登录模块的 token 刷新 bug"    # 生成任务计划
node packages/cli/dist/main.js patch --auto                            # 自动应用代码变更
node packages/cli/dist/main.js verify                                  # 运行验证命令
node packages/cli/dist/main.js repair                                  # 修复验证失败
node packages/cli/dist/main.js handoff                                 # 生成交接报告
```

或一键运行全流程：

```bash
node packages/cli/dist/main.js run "添加用户注销接口" --type feature --max-repair-rounds 5
# 如果已将 CLI 安装或链接为 dsh：
dsh run "添加用户注销接口" --type feature --max-repair-rounds 5
```

## 模块结构

```
packages/
├── cli/        # CLI 入口，8 个命令（init/plan/patch/verify/repair/handoff/doctor/run）
├── core/       # 核心引擎 — 流水线、协议解析、修复循环、静态治理、工具系统
├── provider/   # DeepSeek API 客户端，thinking/non-thinking 路由
├── repo/       # 项目分析 — ProjectIntelligence、RepoContext、文件排序、规则加载、Git 辅助
└── eval/       # Benchmark 执行器、任务夹具、评分与报告
```

## 技术栈

- **语言:** TypeScript (ESM, strict mode)
- **运行时:** Node.js >= 18
- **包管理:** pnpm (workspace monorepo)
- **CLI 框架:** cac
- **校验:** zod
- **测试:** node:test + node:assert/strict

## 开发

```bash
pnpm install          # 安装依赖
pnpm -r run build     # 构建所有包
pnpm -r run test      # 运行所有测试
pnpm run scan         # 全量质量门禁（lint + typecheck + test）
```

## 设计文档

- [项目宪法](CONSTITUTION.md) — 核心原则与协作规则
- [产品蓝图](BLUEPRINT.md) — 最终产品形态与 7 阶段演进路线
- [DeepSeek API Compatibility](docs/specs/deepseek-api-compatibility.md) — Provider 兼容性矩阵与 DeepSeek API 语义
- [Execution Contract](docs/specs/execution-contract.md) — Plan/Patch/Verify/Repair/Handoff 阶段契约
- [State And Evidence](docs/specs/state-evidence.md) — `.dsh` 状态与证据文件
- [DeepSeek Coding Harness Eval](docs/evals/deepseek-coding-harness-eval.md) — DeepSeek V4 Pro/Flash、high/max 回归设计
- [设计 Spec](docs/specs/) — 功能设计说明
- [实现计划](docs/plans/) — 分阶段实施计划

## 当前状态

- **版本:** 0.1.0（活跃开发中）
- **定位:** DeepSeek-native, benchmark-gated, verify-first Coding Harness
- **已支持:** official `/chat/completions`、V4 Pro/Flash、thinking `enabled/disabled`、`reasoning_effort high/max`、function tool calls、streaming、JSON output、usage/cache/reasoning token 观测、阶段化工具策略、验证/修复闭环、状态证据 sidecars
- **部分支持:** eval 回归、成本治理、版本漂移治理、长上下文治理
- **Experimental:** strict tool calls、chat prefix、FIM、`user_id`，均需显式 feature flag 与 beta endpoint
- **尚未支持:** Anthropic-compatible DeepSeek API、默认启用 beta API、美元成本估算、全自动 API drift live check
- **阶段:** Phase 4 Agent Loop 实施期
- **历史基线:** Phase 3 起点 testsPassed 11/24 = 45%
- **已验证阶段门槛:** Phase 3 已于 2026-05-22 通过 N=3 replicated benchmark 退出；runlog `260521151313` 共 28 fixtures × 3 reps × on/off = 168 trials，Project Card on `64/84 = 76.2%`
- **最新特性:** 结构化 Verify、Repair Loop、ProjectIntelligence 主路径、Project Card 默认注入、PatchCoverage 状态机、DSML salvage、`dsh run` / `dsh doctor` 可用、replicated benchmark evidence 已落地
- **当前重点:** Route X `apply_patch` 工具通道 provider-dedup repair 空响应/结构化契约收敛、broader/stability 复审、invalid native rounds / apply errors 继续收敛；`patch.edits_as_native_tool` 仍默认关闭，targeted adoption 已成立但尚未进入默认开启
