---
id: "config-loader-rewrite"
status: in_progress
priority: p0
type: feature
spec_ref: "docs/superpowers/specs/2026-05-02-config-architecture.md"
plan_ref: "docs/superpowers/plans/2026-05-02-config-architecture.md"
dependencies: []
created: "2026-05-02"
updated: "2026-05-02"
assignee: "ai"
---

# 重写 config-loader.ts — 唯一配置读写入口

## Objective
将 `packages/repo/src/config-loader.ts` 从"只读"升级为"唯一读写入口"：定义 DshConfig 类型、新增 merge/write/readApiKey。

## Context
当前 3 个包各有读逻辑复制品，2 个写路径使用"生成+覆盖"语义。config-loader 是完全重写，需要保持向后兼容（`loadDshConfig` 签名不变）。

## Acceptance Criteria
- [ ] `DshConfig` 类型接口定义（含 project/verify/static_scan/rules/deepseek）
- [ ] `loadDshConfig(cwd): DshConfig` — 保持兼容
- [ ] `mergeConfig(existing, overrides): DshConfig` — 对象递归、数组替换、标量覆盖
- [ ] `writeDshConfig(cwd, overrides): void` — 读旧→merge→写新
- [ ] `readApiKey(cwd): string | null` — 从 config 安全提取 key
- [ ] `index.ts` 导出新函数和类型
- [ ] merge 测试：嵌套对象保留、数组替换、标量覆盖、空旧 config、空 overrides
- [ ] `pnpm --filter @dsh/repo typecheck` 通过
- [ ] `pnpm --filter @dsh/repo test` 通过
