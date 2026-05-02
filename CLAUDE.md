# DSH — DeepSeek-native Coding Harness

A DeepSeek-native coding agent runtime optimized for long-context engineering tasks.

**Core loop:** Plan → Patch → Verify → Repair → Handoff

**⚠️ 项目宪法（必读）:** `CONSTITUTION.md` — 设计文档先行、验证闭环、最小变更、可审计、实证驱动

## 项目定位（AI 必读——避免误判）

**DSH 的最终愿景是做一个完整的 DeepSeek 原生 Coding Agent**（与 DeepSeek-TUI 同一赛道），当前的 CLI + pipeline 是第一阶段 MVP。

**关键理解规则：**
1. SPEC §2 标记为"第一阶段不做"的内容是 **MVP 范围裁剪，不是永久架构约束**。不要把它们当成 DSH 的永久定位。
2. SPEC §1 的"是/不是"列表中，"是"对应长期愿景，"不是"对应永久边界。**不要把"第一阶段"的限定词忽略，也不要把临时裁剪当作永久边界。**
3. DSH 当前的执行闭环（Plan→Patch→Verify→Repair→Handoff）是 **MVP 内核，不是最终形态**。后续阶段会逐步扩展交互层（TUI）、工具层（MCP）、多模型支持等。
4. 与其他 Coding Agent 项目（如 DeepSeek-TUI）的对比应在**同一产品类别**内进行——都是要达到同一个终点，差异在路径和优先级，不在层级。

## Tech Stack

- **Language:** TypeScript (ESM, strict mode)
- **Runtime:** Node.js >= 18
- **Package manager:** pnpm (workspace monorepo)
- **CLI framework:** cac
- **Validation:** zod
- **Testing:** node:test + node:assert (with tsx loader)
- **Diff:** diff (npm package)
- **Build:** tsc (one `tsconfig.json` per package, extends `tsconfig.base.json`)

## Module Structure

```
packages/
├── cli/        # CLI entry point, 6 commands (init/plan/patch/verify/repair/handoff)
│               # Thin wrapper: parses args → calls core pipeline → prints results
├── core/       # Central engine — pipeline, patch-parser, repair-loop, static scan governance
├── provider/   # DeepSeek API HTTP client (~200 lines), thinking/non-thinking router
├── repo/       # Project analysis — scanner, file-ranker, rule-loader, git helpers
└── eval/       # Benchmark runner, task fixtures, 10-dimension scoring
```

**Dependency flow:** cli → core → provider + repo

## Common Commands

```bash
pnpm install              # Install all workspace dependencies
pnpm -r run build         # Build all 5 packages (tsc)
pnpm -r run test          # Run all tests
pnpm -r run typecheck     # Typecheck all packages (tsc --noEmit)
pnpm run scan             # Full quality gate: lint + typecheck + test
pnpm run lint             # ESLint across all packages
```

## Code Conventions

- **Module system:** ESM (`"type": "module"`, `.js` extensions in imports)
- **Module resolution:** NodeNext
- **Target:** ES2022
- **Import convention:** `import { x } from "./foo.js"` — compiled `.js` extension, not `.ts`
- **Commit style:** Conventional Commits: `type(scope): description`, e.g. `feat(core): add Semgrep parser`
- **Testing:** Use `node:test` + `node:assert/strict`. Descriptive test names: `"does X when Y"`
- **No default exports** — prefer named exports
- **Zod for validation** at system boundaries (config, state, API responses)
- **No comments for obvious code** — only for non-obvious constraints, invariants, or workarounds

## Key Design Decisions

1. **DeepSeek-native only** — not a multi-model agent. Optimized for DeepSeek's thinking/non-thinking modes and 1M context window.
2. **File system is the API** — no MCP, no web servers. Input: `.dsh/config.yml`, task-state.json, project files. Output: patches, handoff markdown.
3. **Verification-gated** — no verification means patch didn't happen. Repair loop runs max N rounds with failure mode detection.
4. **1M context layering** — Base (config + rules) → Repo (tree + git log) → Task (relevant files) → Dynamic (repair history). Never dump entire repo.

## Project State

- **Version:** 0.1.0 (active development)
- **Task tracking:** `docs/superpowers/TASK-SPEC.md` — defines task format, lifecycle, and spec→plan→task hierarchy
- **Active tasks:** see `docs/superpowers/TASK-SPEC.md` §6 index
- **Specs:** `docs/superpowers/specs/`
- **Plans:** `docs/superpowers/plans/`

## Runtime Files

- `.dsh/config.yml` — project configuration (language, verify commands, DeepSeek settings)
- `.dsh/task-state.json` — current task state machine
- `.dsh/handoff/` — structured handoff markdown files
- `.dsh/static-scan/` — raw static scan output archives
