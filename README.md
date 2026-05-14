# DSH — DeepSeek-native, benchmark-gated, verify-first Coding Harness

一个围绕 DeepSeek 模型行为深度优化的终端编程助手，覆盖从任务理解、代码生成、验证修复到交接沉淀的验证闭环。

**核心流程:** Plan → Patch → Verify → Repair → Handoff
**当前阶段:** Phase 3（工具化 / 验证闭环攻坚）
**Phase 3 起点基线:** testsPassed 11/24 = 45%（`260508-003359` / `260509-165142`）
**Phase 3 目标:** testsPassed > 60%
**最新实证:** 2026-05-14 N=3 replicated benchmark：Project Card on `60/72 = 83.3%`，约等价 `20/24`，详见 `docs/reports/knowledge/20260514-pie-phase2-3-baseline.md`

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
# 初始化项目配置
pnpm exec dsh init

# 设置 API Key（二选一）
export DEEPSEEK_API_KEY="sk-your-key"
# 或手动写入 .dsh/config.yml 的 deepseek.api_key 字段
```

### 使用

```bash
dsh plan "修复登录模块的 token 刷新 bug"    # 生成任务计划
dsh patch --auto                            # 自动应用代码变更
dsh verify                                  # 运行验证命令
dsh repair                                  # 修复验证失败
dsh handoff                                 # 生成交接报告
```

或一键运行全流程：

```bash
dsh run "添加用户注销接口" --max-repair-rounds 5
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
- [设计 Spec](docs/specs/) — 功能设计说明
- [实现计划](docs/plans/) — 分阶段实施计划

## 当前状态

- **版本:** 0.1.0（活跃开发中）
- **定位:** DeepSeek-native, benchmark-gated, verify-first Coding Harness
- **阶段:** Phase 3（工具化 / 验证闭环攻坚）
- **当前基线:** testsPassed 11/24 = 45%
- **目标:** testsPassed >60%
- **最新特性:** 结构化 Verify、Repair Loop、ProjectIntelligence 主路径、Project Card 默认注入、Benchmark replicated evidence 已落地
