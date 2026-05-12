# PIE Phase 2 + Phase 3：scanner.ts 整体退役 — 实施计划

> 状态: draft | 日期: 2026-05-13 | Spec: `docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md` (v1.1)
>
> 12 个 Step 拆分对应 spec §7.1；每个 Step 独立 commit，便于 review 与回退。
>
> **依赖图**：Step 1 → Step 2 / 3（并行） → Step 4 → Step 5 → Step 6 / 7 → Step 8 → Step 9 / 10（并行） → Step 11 → Step 12

## Phase A: Intelligence 数据模型扩展

### Step 1：Facts 扩展（submodule + framework + project_yml + capabilities lint）

**文件**：
- `packages/repo/src/intelligence.ts`（修改）
- `packages/repo/src/intelligence.test.ts`（修改）

**做什么**：
- `collectFacts` 浅扫 cwd 顶层子目录，对 6 种 build descriptor 命中产出 `submodule.<name>.<system>` + `submodule.<name>.lang.<lang>`（参 spec §3.2）
- `collectFacts` 扩展 pom.xml 内容关键字扫描（spring-boot / quarkus / micronaut）+ package.json deps 扫描（next / react / vue / svelte / express / fastify），产出 `framework.<name>`，每条携带来源 path（参 spec §3.3）
- 注：`project_yml.*` Fact 的注入逻辑在 Step 3 实现 `.dsh/project.yml` 读取时一并完成
- `deriveCapabilities` 输出新增 `lint` key，按 spec §3.4 表填命令

**验证**：
- 新增 ≥5 个 case 覆盖：(1) cwd 顶层无 pom + `backend/pom.xml` 产出 submodule fact (2) `backend/pom.xml` 含 spring-boot 产出 framework fact (3) 多子模块共存（backend Java + frontend npm）(4) capabilities 含 lint 在 maven/typescript/python 各一 (5) 不含子模块的纯 ts 项目仍正常工作
- `pnpm -F @dsh/repo run test`

**前置**：无

---

### Step 2：投影函数 `pickVerifyPlan` + `moduleRoots`

**文件**：
- `packages/repo/src/intelligence.ts`（修改）
- `packages/repo/src/intelligence.test.ts`（修改）

**做什么**：
- 新增 `pickVerifyPlan(pi): VerifyCommands` —— 从 `pi.capabilities` 反推 `{ test, lint, typecheck, build }`，capabilities 为 `unavailable` 时该字段 null（参 spec §3.5）
- 新增 `moduleRoots(pi): string[]` —— 从 `pi.facts` 中所有 `submodule.<name>.*` 抽 name + layout fact 中的目录（如 `src` / `lib`），含 `.` 兜底（参 spec §3.5 + §3.8）

**验证**：
- 单测覆盖：4 类 fixture 上 `pickVerifyPlan` 输出与原 `detectVerifyCommands` 对比；`moduleRoots` 在混合仓库下返回 `["backend", "frontend", "src", "."]` 等
- `pnpm -F @dsh/repo run test`

**前置**：Step 1

---

### Step 3：`.dsh/project.yml` schema + 读写 + override 集成

**文件**：
- `packages/repo/src/project-yml.ts`（新建）
- `packages/repo/src/project-yml.test.ts`（新建）
- `packages/repo/src/intelligence.ts`（修改：在 `collectFacts` 末尾注入 `project_yml.*` Fact；`decide` 短路逻辑见 spec §3.7）
- `packages/repo/src/index.ts`（修改：导出 `ProjectYml` / `readProjectYml` / `writeProjectYml`）

**做什么**：
- `project-yml.ts` 定义 zod schema `ProjectYml`：`language` / `buildSystem` / `framework` / `modules` / `verifyOverride` 全字段可选
- 实现 `readProjectYml(cwd): ProjectYml | null`、`writeProjectYml(cwd, data)`、`renderProjectYml(pi)`（把 Intelligence 决策序列化为草稿 yml，供 `dsh doctor --write` 使用）
- `assembleIntelligence` 在 facts 装配后，若 `.dsh/project.yml` 存在，注入对应 `project_yml.*` Fact；Decision 层对应 key 直接 `mode: "auto"` + `confidence: 1.0`，evidence 为 "manual override (.dsh/project.yml)"

**验证**：
- 单测：schema parse 合法/非法 yml；`assembleIntelligence` 在 cwd 含 pom.xml 但 project.yml 锁定 `buildSystem: gradle` 时返回 gradle
- `pnpm -F @dsh/repo run test`

**前置**：Step 1（共享 facts/decide 改动）

---

## Phase B: Legacy 投影 + RepoContext 拆分

### Step 4：`toLegacyTechStack` 扩展（modules + framework 反推）

**文件**：
- `packages/repo/src/intelligence.ts`（修改）
- `packages/repo/src/intelligence.test.ts`（修改）

**做什么**：
- `toLegacyTechStack(pi)` 填充 `modules: SubModule[]` —— group `submodule.*` facts by name，每个 name 一条 `SubModule`（含其语言、buildSystem、framework）
- 填充顶层 `framework: string | null` —— 优先取顶层 framework fact；无则取首个 submodule 的 framework
- `pickFrameworkFact` / `groupSubmoduleFacts` 内部 helper

**验证**：
- Parity test：用相同输入对比 `toLegacyTechStack(assembleIntelligence(tmp))` 与原 `detectTechStack(tmp)`，至少 4 类 fixture（typescript / python / java-maven / java+vue 混合）契约一致
- `pnpm -F @dsh/repo run test`

**前置**：Step 1, 2

---

### Step 5：RepoContext 拆分到 `repo-context.ts`，新增 `intelligence` 字段

**文件**：
- `packages/repo/src/repo-context.ts`（新建：迁移 `generateRepoContext` + `generateDirectoryTree` + `findKeyFiles` + `getRecentGitLog`）
- `packages/repo/src/scanner.ts`（修改：删除上述迁出的函数，仅保留 detectTechStack / detectVerifyCommands 系等 Step 8 时再删）
- `packages/repo/src/index.ts`（修改：`RepoContext` / `VerifyCommands` re-export 改自 repo-context.js）
- 类型 `RepoContext` 新增字段 `intelligence: ProjectIntelligence`
- `generateRepoContext(cwd, stack)` 签名改为 `generateRepoContext(cwd, pi)`，内部用 `toLegacyTechStack(pi)` 投影 TechStack，保持下游字段

**做什么**：
- 物理迁移，签名调整；Step 6/7 调用点会顺便把传参改成 `pi`
- 单测从 scanner.test.ts 中迁出对应部分到 repo-context.test.ts

**验证**：
- `pnpm -F @dsh/repo run test`
- `pnpm -r run typecheck` 通过（下游通过 `@dsh/repo` re-export 不感知路径变化）

**前置**：Step 4

---

## Phase C: 调用点切换

### Step 6：切换 4 处 `detectTechStack` 调用点

**文件**：
- `packages/core/src/pipeline.ts`（修改：line 306, 946）
- `packages/core/src/static-scanner.ts`（修改：line 267）
- `packages/cli/src/commands/init.ts`（修改：line 25 —— 只切 detectTechStack，detectVerifyCommands 留给 Step 7）
- `packages/eval/src/benchmark-runner.ts`（修改：line 389）

**做什么**：
```ts
// 之前
import { detectTechStack, generateRepoContext } from "@dsh/repo";
const stack = detectTechStack(cwd);
const repoContext = generateRepoContext(cwd, stack);

// 之后
import { assembleIntelligence, toLegacyTechStack, generateRepoContext } from "@dsh/repo";
const pi = assembleIntelligence(cwd);
const stack = toLegacyTechStack(pi);
const repoContext = generateRepoContext(cwd, pi);
```

**验证**：
- `grep -rn 'detectTechStack' packages/ --include='*.ts' | grep -v node_modules | grep -v dist | grep -v scanner.ts`：仅返回 intelligence.ts 内的函数引用（如果有）
- `pnpm -r run typecheck` + `pnpm -r run test` 通过

**前置**：Step 4, 5

---

### Step 7：切换 1 处 `detectVerifyCommands` 调用点（cli/init）

**文件**：
- `packages/cli/src/commands/init.ts`（修改：line 26）

**做什么**：
```ts
// 之前
const verify = detectVerifyCommands(cwd, stack);

// 之后
import { pickVerifyPlan } from "@dsh/repo";
const verify = pickVerifyPlan(pi);
```

`init` 写 config.yml 时如果 `pickVerifyPlan` 返回字段为 null（capabilities 为 `likely` / `unavailable`），fallback 到 `pkg.scripts.test/lint/...`（与原 detectVerifyCommands 等价的 fallback，避免 cli/init 体验回退）

**验证**：
- 在 4 类 fixture 上跑 `dsh init`，对比生成的 config.yml verify 字段与原 detectVerifyCommands 输出语义一致
- `pnpm -r run typecheck` + `pnpm -F @dsh/cli run test` 通过

**前置**：Step 2, 6

---

### Step 8：scanner.ts 物理删除 + 导出收敛

**文件**：
- `packages/repo/src/scanner.ts`（**删除整个文件**）
- `packages/repo/src/scanner.test.ts`（**删除**）
- `packages/repo/src/index.ts`（修改：移除 `detectTechStack` / `detectVerifyCommands` re-export；`TechStack` / `SubModule` 类型 re-export 改自 intelligence.js）

**做什么**：
- 整文件 rm
- `index.ts` 顶部 `export { detectTechStack, detectVerifyCommands, generateRepoContext } from "./scanner.js";` 改为 `export { generateRepoContext } from "./repo-context.js";` —— 注意 generateRepoContext 已在 Step 5 迁到 repo-context.ts

**验证**：
- `grep -rn 'detectTechStack\|detectVerifyCommands' packages/ --include='*.ts' | grep -v node_modules | grep -v dist`：返回 0 处生产调用
- `ls packages/repo/src/scanner.ts` 失败
- `pnpm run scan` 全套通过

**前置**：Step 6, 7

---

## Phase D: 新能力上线

### Step 9：`dsh doctor` 命令

**文件**：
- `packages/cli/src/commands/doctor.ts`（新建）
- `packages/cli/src/main.ts`（修改：注册 `doctor` 子命令）
- `packages/cli/src/commands/doctor.test.ts`（新建）

**做什么**：
- `runDoctor({ write?: boolean })`：调 `assembleIntelligence` + `toProjectCard` 输出到 stdout
- `--write`：调 `renderProjectYml(pi)` 写到 `.dsh/project.yml`（如已存在则提示用户先确认 / 显式 `--force`）
- 注册到 cac：`cli.command('doctor', 'show project intelligence').option('--write', '...').action(runDoctor)`

**验证**：
- 单测：在 4 类 fixture（typescript / python / java+vue / 混合）上跑 `runDoctor({})`，输出含 `## Project Card` / `**Capabilities**` 等关键字符串
- `runDoctor({ write: true })` 后 `.dsh/project.yml` 存在且通过 `readProjectYml` zod 校验
- 手动跑 `pnpm -F @dsh/cli build && node packages/cli/dist/main.js doctor` 烟测

**前置**：Step 3

---

### Step 10：Project Card 注入 LLM prompt

**文件**：
- `packages/core/src/context-builder.ts`（修改：`buildRepoContext` 追加 Project Card 段）
- `packages/core/src/context-builder.test.ts`（修改）

**做什么**：
- `buildRepoContext(ctx: RepoContext)` 现已能从 `ctx.intelligence` 拿到 `ProjectIntelligence`（Step 5 加的字段），调 `toProjectCard(ctx.intelligence)` 后 push 到 parts
- 加 feature flag：环境变量 `DSH_INJECT_PROJECT_CARD`（默认 true），便于 Step 12 benchmark 验收时 A/B
- 现有 Tech Stack 章节文案保留，Project Card 紧跟其后

**验证**：
- 3 个代表性 fixture（typescript / python / java+vue 混合）字符级 diff：除新增的 `## Project Card` 章节外，其它行零变化
- `pnpm -F @dsh/core run test`

**前置**：Step 3, 5

---

### Step 11：ctxDirs 重构（repair-loop + failure-detector 消费 moduleRoots）

**文件**：
- `packages/core/src/repair-loop.ts`（修改：line 211 + `resolveSourcePath` 签名）
- `packages/core/src/failure-detector.ts`（修改：line 559 + `extractCompilationErrors` 签名）
- 各自的 test 文件（修改）

**做什么**：
- `resolveSourcePath(cwd, rawFile, knownFiles, moduleRoots: string[])` —— 删字面量 `markers`，改用 `moduleRoots` 切段
- `extractCompilationErrors(output, moduleRoots: string[])` + `extractFailureSourceLocations(output, moduleRoots)` —— 同上
- 调用方注入 `moduleRoots(pi)` 投影；`pi` 通过 repair-loop 已有的 state context 或显式参数传入（具体路径在实施时按最小侵入选择）
- moduleRoots 为空（小项目）时回退到 basename，与现状语义一致

**验证**：
- 单测覆盖：(1) release-hub 风格路径（含 `/backend/`）能切回相对路径 (2) 单包小项目（无 submodule）moduleRoots=[] 时回退 basename 正常
- `grep -n '"/backend/"\|"/frontend/"' packages/core/src/repair-loop.ts packages/core/src/failure-detector.ts`：返回 0 处
- `pnpm -F @dsh/core run test`

**前置**：Step 2, 6

---

## Phase E: 验收

### Step 12：24 fixture benchmark + 字符级 diff + 报告归档

**文件**：
- `docs/reports/knowledge/<YYYYMMDD-HHMMSS>-pie-phase2-3-baseline.md`（新建归档）

**做什么**：
- 跑 `pnpm -F @dsh/eval run benchmark`（24 fixture full set）
- 对比基线 `260508-003359` / `260513-013656`：`completed` 不退化 + `testsPassed` 浮动 ≤ ±2（参 spec §5.2）
- 在 3 个代表性 fixture（loamlog ts / pi-proof-forge python / release-hub java+vue）上跑 `dsh plan/patch` 拉出 prompt 的 buildRepoContext 段，与 Step 6 之前的版本做字符级 diff，确认除 Project Card 外零回归
- A/B 关闭 `DSH_INJECT_PROJECT_CARD=false` 再跑同一组 fixture，记录 Project Card 注入对 benchmark 的边际影响
- 报告归档：含 (1) benchmark 数据对比表 (2) 字符级 diff sample (3) A/B 结果 (4) ledger §8 中 `pie-phase2-3-baseline-comparison` 条目状态可转 resolved 的依据

**验证**：
- `pnpm run scan` 通过
- 报告写入 ledger §8 索引（修改 `pie-phase2-3-baseline-comparison` status → resolved）
- 检查 spec §5.1 全部硬验收 checkbox 已勾选
- `./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts` 通过

**前置**：Step 1–11 全部完成

---

## DoD（Definition of Done）

完成全部 Step 后，统一自检：

- [ ] `pnpm run scan` 通过（lint + typecheck + test）
- [ ] `grep -rn 'detectTechStack\|detectVerifyCommands' packages/ --include='*.ts' | grep -v node_modules | grep -v dist | grep -v intelligence.ts` 返回 0 行
- [ ] `ls packages/repo/src/scanner.ts` 失败（文件已删）
- [ ] `grep -n '"/backend/"\|"/frontend/"' packages/core/src/repair-loop.ts packages/core/src/failure-detector.ts` 返回 0 行
- [ ] 24 fixture benchmark 对比基线无退化（spec §5.2）
- [ ] 3 fixture 字符级 diff 仅含 Project Card 新章节
- [ ] `dsh doctor` 在 4 类 fixture 输出非空 Project Card；`dsh doctor --write` 产出的 yml 通过 zod 校验
- [ ] `.dsh/project.yml` 锁定后 `assembleIntelligence` 尊重 override（人工 override 优先级测试通过）
- [ ] `scripts/check-tracked-items.ts` 通过
- [ ] ledger §8 中 5 条 cancelled 条目 + 2 条新增条目 + 2 条 trigger 更新条目状态正确
- [ ] spec 状态从 in_review 推到 done（人类 reviewer 确认）

## 风险检查点（与 spec §6 对齐）

| 风险 | 检测时点 | 应对 |
|---|---|---|
| Project Card 注入引起 benchmark 退化 | Step 12 A/B | `DSH_INJECT_PROJECT_CARD=false` 临时关闭，spec §6 已埋 feature flag |
| `pickVerifyPlan` 在解释型语言返回 null | Step 7 单测 | Step 7 已含 pkg.scripts fallback；24 fixture 中 typescript / python 覆盖 |
| `toLegacyTechStack` 反推与原 scanner 输出不一致 | Step 4 parity test | parity test 是硬验收；差异不能通过即调整反推映射 |
| `.dsh/project.yml` schema 设计错 | Step 9 烟测 | `dsh doctor --write` 先 prototype，跑 ≥3 fixture 实测人工编辑工作流 |
| ctxDirs 重构后小项目路径切段失败 | Step 11 单测 | moduleRoots=[] fallback 到 basename 是硬约定，测试覆盖 |
| scanner.ts 删除后下游 import 路径漏改 | Step 8 typecheck | tsc 强制门禁，无侥幸空间 |

## Task 卡片建议

按 Step 颗粒度拆 task 偏细。建议按 Phase 合并：

| Task 文件 | 覆盖 Step | 类型 | 优先级 |
|---|---|---|---|
| `docs/tasks/2026-05-13-pie-phase-a-facts-expansion.md` | Step 1, 2, 3 | refactor | p1 |
| `docs/tasks/2026-05-13-pie-phase-b-legacy-projection.md` | Step 4, 5 | refactor | p1 |
| `docs/tasks/2026-05-13-pie-phase-c-callsite-switch.md` | Step 6, 7, 8 | refactor | p1 |
| `docs/tasks/2026-05-13-pie-phase-d-new-capabilities.md` | Step 9, 10, 11 | feature | p1 |
| `docs/tasks/2026-05-13-pie-phase-e-validation.md` | Step 12 | test | p1 |

每个 task 卡片继承本 plan 中对应 Step 的 "文件" / "做什么" / "验证" / "前置"。task 完成时勾本 plan 中对应 Step 的隐式 checkbox（手工维护此 plan 的状态行）。

## 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-13 | v1.0 (draft) | 初始计划：12 Step 拆分 + Phase A–E 分组 + Task 卡片建议 |
