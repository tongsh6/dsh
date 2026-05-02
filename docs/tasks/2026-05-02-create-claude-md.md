---
id: "create-claude-md"
status: done
priority: p1
type: docs
dependencies: []
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# 创建 CLAUDE.md 并修复 config.yml 自洽性

## Objective
为 dsh 项目创建 CLAUDE.md（AI 辅助开发的项目上下文文件），同时修复 `.dsh/config.yml` 中语言/包管理器配置与实际项目不一致的问题。

## Context
- dsh 是一个 TypeScript + pnpm monorepo 项目
- `.dsh/config.yml` 中写的是 `language: python`、`package_manager: pip`——这是 `dsh init` 对本项目扫描结果错误导致的
- 项目没有任何 CLAUDE.md、AGENTS.md、.cursorrules 或 README
- CLAUDE.md 对 AI 协作开发至关重要：提供项目技术栈、模块结构、常用命令、代码约定
- `scanner.ts` 的 `detectTechStack` 对 pnpm workspace 项目可能检测失败——这可能是 config.yml 错误的根因

## Acceptance Criteria
- [ ] 项目根目录新增 `CLAUDE.md`，内容覆盖：项目定位、技术栈、模块结构、常用命令、代码约定
- [ ] `.dsh/config.yml` 修正为 `language: typescript`、`package_manager: pnpm`
- [ ] `.dsh/config.yml` 的 `verify` 命令修正为实际可用命令
- [ ] 排查 `detectTechStack` 对 pnpm workspace 的检测逻辑，如有 bug 则修复
- [ ] `pnpm run scan` 通过

## Steps

### Step 1: 修复 config.yml
- 将 `language: python` → `language: typescript`
- 将 `package_manager: pip` → `package_manager: pnpm`
- 补充 verify 命令：test/lint/typecheck
- 补充 rules.files（如无则留空）

### Step 2: 排查 scanner 检测 bug（根因分析）
- 检查 `packages/repo/src/scanner.ts` 的 `detectTechStack` 逻辑
- 用 dsh 自身项目测试：为什么检测出 python？
- 如确认是 bug，修复它（需保持对其他项目的兼容性）
- 如不是 bug 而是 minification 偏差，记录原因

### Step 3: 创建 CLAUDE.md
- 项目定位：一段话说明 dsh 是什么
- 技术栈：TypeScript ESM, Node >= 18, pnpm workspace, cac, zod
- 模块结构：5 个 package 的职责和依赖关系
- 常用命令：`pnpm install`、`pnpm -r run build`、`pnpm -r run test`、`pnpm run scan`
- 代码约定：ESM 模块系统、NodeNext 模块解析、strict TypeScript、commit 格式
- 当前状态：指向 TASK-SPEC.md 和活跃 task 索引

## Notes
- CLAUDE.md 应保持简洁（< 200 行），重点是让 AI 能快速理解项目
- scanner bug 如果复杂，可拆出独立 task，不阻塞此 task 的 config.yml 修复部分
- config.yml 修复是简单的文本编辑，优先级最高
