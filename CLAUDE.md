# DSH — DeepSeek-native, benchmark-gated, verify-first Coding Harness

A DeepSeek-native, benchmark-gated coding harness optimized for verify-first engineering tasks.

**Core loop:** Plan → Patch → Verify → Repair → Handoff

**⚠️ 项目宪法（必读）:** `CONSTITUTION.md` — 设计文档先行、验证闭环、最小变更、可审计、实证驱动、无临时手段

**⚠️ 项目蓝图（必读）:** `BLUEPRINT.md` — 最终产品形态、分维度演进路线、阶段划分。理解 DSH 的长期愿景和当前 MVP 阶段的关系是正确判断所有设计决策的前提。

**⚠️ 项目状态台账（优先读）:** `docs/project-ledger.md` — 已完成事项、已验证事项、进行中事项、当前优先级、关键证据索引。新会话 AI 请先读此文件恢复项目事实基线。

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
├── cli/        # CLI entry point, 8 commands (init/plan/patch/verify/repair/handoff/doctor/run)
│               # Thin wrapper: parses args → calls core pipeline → prints results
├── core/       # Central engine — pipeline, patch-parser, repair-loop, static scan governance
├── provider/   # DeepSeek API HTTP client (~200 lines), thinking/non-thinking router
├── repo/       # Project analysis — ProjectIntelligence, RepoContext, file ranking, rules, git helpers
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
- **Current phase:** Phase 3 closeout validation
- **Baseline:** testsPassed 11/24 = 45%; target >60%
- **Latest evidence:** 2026-05-14 replicated benchmark, Project Card on 60/72 = 83.3%
- **Task tracking:** `docs/TASK-SPEC.md` — defines task format, lifecycle, and spec→plan→task hierarchy
- **Active tasks:** see `docs/TASK-SPEC.md` §6 index
- **Specs:** `docs/specs/`
- **Plans:** `docs/plans/`

## Runtime Files

- `.dsh/config.yml` — project configuration (language, verify commands, DeepSeek settings)
- `.dsh/task-state.json` — current task state machine
- `.dsh/handoff/` — structured handoff markdown files
- `.dsh/static-scan/` — raw static scan output archives
