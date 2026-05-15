---
id: pie-phase2-tier1-submodule-fact-promotion
status: in_review
priority: p1
type: refactor
spec_ref: BLUEPRINT.md §2.6
created: 2026-05-13
updated: 2026-05-15
---

# PIE Phase 2 + Phase 3：scanner.ts 整体退役，项目识别全面切到 Intelligence 驱动

> 状态: in_review | 日期: 2026-05-15 | 作者: ai
>
> 目标: 把 `packages/repo/src/scanner.ts` 的项目识别与 verify plan 推导能力全部退役，4 处 `detectTechStack` 调用 + 1 处 `detectVerifyCommands` 调用切换到 `assembleIntelligence`；交付 `dsh doctor` + Project Card 注入 prompt + `.dsh/project.yml` 人工确认层；同步重构 `repair-loop` / `failure-detector` 中的 `ctxDirs` 字面量，让两者消费 Intelligence 的 module roots。本 spec 一次性收并 ledger §8 中四条已登记跟踪事项。
>
> **文件名延续**：本 spec 在 draft 阶段（v1.0）原本只覆盖 PIE Phase 2 Tier 1（子模块 / framework Fact + 调用点切换）。in_review 阶段 review 决定（2026-05-13）将原 §2.2 中四条非目标全部并入，范围扩张为 Phase 2 全集 + Phase 3 部分 + ctxDirs 重构。文件名 `pie-phase2-tier1-*` 是 v1.0 历史命名，未改名以保 ledger §8 引用稳定；当前实质范围以本节为准。

## 1. 问题定义

### 1.1 当前状态

`packages/repo/src/scanner.ts` 同时承担三类职责，全部走"看到 X 就推断 Y"的弱关联式识别：

1. **项目识别** — `detectTechStack` + helper 链路（`scanSubModules` / `detectFramework` / `detectJavaFramework` / `detectLanguageByFiles` / `detectPackageManager` / `detectPythonPM`），返回 `TechStack`
2. **verify plan 推导** — `detectVerifyCommands`，按 language + packageManager 硬映射出 `{ test, lint, typecheck, build }` 字符串命令
3. **RepoContext 装配** — `generateRepoContext` + `generateDirectoryTree` + `findKeyFiles` + `getRecentGitLog`（与 §2.6 无关）

`packages/repo/src/intelligence.ts`（2026-05-09 `bca15fd` 引入）实现了 BLUEPRINT §2.6 设计的 Fact / Candidate / Decision / Capability 模型，导出 `assembleIntelligence` / `toLegacyTechStack` / `toProjectCard`。但 **5 处生产调用全部仍走老的 scanner API**：

| 位置 | 调用 |
|---|---|
| `packages/core/src/pipeline.ts:306` | `detectTechStack(cwd)` |
| `packages/core/src/pipeline.ts:946` | `detectTechStack(cwd)` |
| `packages/core/src/static-scanner.ts:267` | `detectTechStack(cwd)` |
| `packages/cli/src/commands/init.ts:25` | `detectTechStack(cwd)` |
| `packages/cli/src/commands/init.ts:26` | `detectVerifyCommands(cwd, stack)` |
| `packages/eval/src/benchmark-runner.ts:389` | `detectTechStack(repoPath)` |

`assembleIntelligence` / `toProjectCard` 在生产代码中**零调用**，仅在 `intelligence.test.ts` 中出现。

另外两处独立的硬编码同样源自 scanner 退役不完整：

- `packages/core/src/repair-loop.ts:211` — `const markers = ["/backend/", "/frontend/", "/src/", "/lib/", "/app/", "/pkg/", "/cmd/"]`
- `packages/core/src/failure-detector.ts:559` — `const ctxDirs = ["/backend/", "/frontend/", "/src/", "/lib/", "/app/", "/pkg/", "/cmd/"]`

两处字面量列表完全相同，作用都是"把工具输出里的绝对 / 异常路径切回项目相对路径"。直接根因：runtime 缺 project layout 的 source of truth，被迫在每个消费点自维护字面量。

### 1.2 痛点 / 实证证据

**直接证据（issue #1 #2 #3）**：

1. `scanner.ts:93-94` 保留 benchmark fixture `release-hub` 形状泄漏：

```ts
if (!primary && fs.existsSync(path.join(cwd, "backend", "pom.xml"))) {
  primary = { language: "java", packageManager: "maven", ... };
}
```

`release-hub` 是唯一"顶层无 pom.xml + `backend/pom.xml`"形状的 fixture。同文件 147-183 行的 `scanSubModules` 浅扫已经能发现该 pom.xml，但 `detectTechStack` 绕过子模块结果，用字面量目录名兜底——一处与 fixture 名耦合的冗余硬编码。

2. `repair-loop.ts:211` + `failure-detector.ts:559` 的 `ctxDirs` 字面量是同一份代码复制粘贴。其历史在 `git log -S ctxDirs`：commit `ce880a6` 的 message 直接承认"不再硬编码 benchmark repo 名, 改为按 src/backend/frontend 等上下文目录切段, 适用任意项目"——把一个具体硬编码（`release-hub`）替换成一个通用硬编码（dir list）。

**架构证据（三层断点根因）**：

BLUEPRINT §2.6 Phase 1 目标原文（节选）：

> 引入最小的 `ProjectIntelligence` 抽象（Fact / Candidate / Decision / Capability 四模型），**通过 `toLegacyTechStack` 投影兼容现有调用链路**。新增 `toProjectCard` **给 LLM 注入** "已知 / 未知 / 禁止推断"的结构化上下文。

`docs/project-ledger.md` §8 将 `project-intelligence-phase1` 标记为 `resolved (2026-05-09)`，但加粗的两步——**投影 wiring** 与 **Project Card 注入**——一项都没有发生：5 处生产调用点仍走 scanner，`toProjectCard` 无任何生产调用。

后果三层：

1. **代码层断点** — `intelligence.ts` 与 `scanner.ts` 之间无任何代码链接（无 `@deprecated`、无指向性 JSDoc、无 ESLint 规则、无类型层标记）。`packages/repo/src/index.ts` 平铺导出，**像同级兄弟而不是 successor / legacy 关系**。
2. **文档层断点** — CLAUDE.md / BLUEPRINT / ledger / CONSTITUTION 均未出现"能力 → canonical 入口模块"映射，使任何沿"grep 落到症状 → 顺 import 链上溯"路径工作的人或 AI 必然停在 scanner。
3. **生命周期层断点** — `resolved` 实证标准过松，只要求"模块存在 + 测试通过"，不要求"调用方迁移率"。CONSTITUTION 原则 5（实证驱动）在 Phase 完成验收处留有盲区。

`detectVerifyCommands` 的弱推断（packageManager 非 gradle 即默认 mvn；packageManager=null 时全返回 null）此前已修过几个具体 bug（ledger §8 中 `scanner-java-default-maven` / `verify-java-fallback-maven` 等），但根本结构未改——它仍然是"language + packageManager → 命令字符串"的硬映射，与 Capability 推导模型并行存在。

### 1.3 与最终目标的关系

BLUEPRINT §2.6 是"项目识别从结论型推断到证据驱动决策"的横切关注点。Phase 1 已交付**模型**；Phase 2 目标"完整 Fact 收集器 + Candidate 排序 + `dsh doctor` + `.dsh/project.yml`"；Phase 3 目标"`detectVerifyCommands` 退役 + scanner 内部改为 Intelligence 驱动 + verify plan 从 Capability 推导"。

本 spec 一次性覆盖 **Phase 2 全集 + Phase 3 的 `detectVerifyCommands` 退役**，不再按 Tier 拆分实施。理由（项目早期）：

- 4 个原本独立的 spec 会产生 4 倍治理开销（spec / plan / task / review）
- 4 项变更共享同一个 source of truth（intelligence），交付边界自然内聚
- 没有外部依赖压力强迫拆 Phase（不是赶 release）
- 24 fixture benchmark 可一次性验收合并后效果

`project-intelligence-phase2` / `project-intelligence-phase3` / `pie-phase2-tier2-doctor-card` / `pie-phase2-tier3-project-yml` / `runtime-path-resolution-ctxdirs` 五条 ledger 条目本 spec 全部收并。

## 2. 目标与非目标

### 2.1 目标

1. **完整 Fact 收集器**：`intelligence.collectFacts` 扩展，新增 `submodule.<name>.<system>` / `submodule.<name>.lang.<lang>` / `framework.<name>` / `project_yml.*` 四类 Fact，分别对应"子模块构建描述符浅扫"、"子模块语言推断"、"framework 内容关键字扫描（pom.xml + package.json）"、"`.dsh/project.yml` 显式锁定"
2. **Capabilities 扩展**：`deriveCapabilities` 输出新增 `lint` key（覆盖 maven checkstyle / gradle checkstyle / eslint / ruff / golangci-lint / cargo clippy 等）
3. **toLegacyTechStack 完整投影**：填充 `modules: SubModule[]` 与 `framework: string | null`，下游 `context-builder` / `cli/init` 文案零字符回归
4. **scanner.detectTechStack 物理删除**：连同 `scanSubModules` / `detectFramework` / `detectJavaFramework` / `detectLanguageByFiles` / `detectPackageManager` / `detectPythonPM` / `detectTypeScriptModule` / `detectJavaModule` / `detectPythonModule` 等全部 helper
5. **scanner.detectVerifyCommands 物理删除**：连同 `findScript` helper；4 verify 字段（test/lint/typecheck/build）由 `pickVerifyPlan(capabilities)` 投影函数从 `ProjectCapability.command` 推导
6. **5 处生产调用点全部切换**：详见 §1.1 表格
7. **`dsh doctor` 命令**：新增 `packages/cli/src/commands/doctor.ts`，输出 `toProjectCard(assembleIntelligence(cwd))` 结果；`--write` flag 把当前 Intelligence 决策序列化为 `.dsh/project.yml` 草稿（供人工编辑后 commit）
8. **Project Card 注入 LLM prompt**：`context-builder.buildRepoContext` 在 Tech Stack 章节后追加 Project Card 段（来源：`toProjectCard(assembleIntelligence(cwd))`），让模型可见"已知 / 推断 / 未知 / 能力清单"
9. **`.dsh/project.yml` 人工确认层**：新增 zod schema `ProjectYml`；`assembleIntelligence` 在读取 facts 后，若 `.dsh/project.yml` 存在，将其字段作为 `project_yml.*` Fact 注入，并在 Decision 层以 `mode: "auto"` + `confidence: 1.0` 锁定（人工 override 优先级最高）
10. **ctxDirs 字面量重构**：`repair-loop.resolveSourcePath` + `failure-detector.extractCompilationErrors` 接受 `ProjectIntelligence` 注入（或其投影 `moduleRoots: string[]`），按 intelligence 已知的 submodule paths 切段；删除两处字面量 `["/backend/", "/frontend/", ...]`
11. **scanner.ts 拆分**：把保留的 RepoContext 装配能力（`generateRepoContext` / `generateDirectoryTree` / `findKeyFiles` / `getRecentGitLog`）迁移到新文件 `packages/repo/src/repo-context.ts`；`scanner.ts` 物理删除
12. **类型契约**：`TechStack` / `SubModule` / `VerifyCommands` / `RepoContext` 全部保留并迁移到合适位置（`TechStack` / `SubModule` → `intelligence.ts`，`VerifyCommands` / `RepoContext` → `repo-context.ts`）；下游签名零变化

### 2.2 非目标

> 提示：列在此处的"非目标"如果属于「未来某天可能要做」性质，必须同步在 §9 跟踪事项中登记一条 `deferred`。

1. ❌ 不补 `@deprecated` 标记或任何渐进迁移层——按用户指示，项目早期"能移除就移除"，不积累兼容层。

（v1.0 中列为非目标的其余 5 条已并入 §2.1。）

## 3. 设计

### 3.1 数据流总图

```
                          ┌────────────────────┐
                          │  .dsh/project.yml  │ (可选；人工锁定)
                          └─────────┬──────────┘
                                    │
                                    ▼
cwd ──→ collectFacts(cwd) ──→ Facts ──→ generateCandidates ──→ decide ──→ deriveCapabilities
                                                                                │
                                                                                ▼
                                                                ProjectIntelligence
                                                                  ├──→ toLegacyTechStack ──→ TechStack (5 callers)
                                                                  ├──→ toProjectCard ──────→ prompt Base 层
                                                                  ├──→ pickVerifyPlan ─────→ VerifyCommands (cli/init)
                                                                  └──→ moduleRoots ────────→ repair-loop / failure-detector
```

### 3.2 Submodule Fact

`collectFacts` 在现有顶层文件扫描后，浅扫 cwd 下每个非隐藏、非 `node_modules` / `.dsh` / `target` / `dist` 的直接子目录。对每个子目录检查 6 种 build descriptor，命中产出：

```
key:    submodule.<name>.<system>
value:  true
source: { type: "file", path: "<name>/<descriptor>" }
confidence: high
```

举例（release-hub 形状）：

```
submodule.backend.maven      ← backend/pom.xml
submodule.frontend.npm       ← frontend/package.json
submodule.backend.lang.java
submodule.frontend.lang.typescript
```

### 3.3 Framework Fact

**Java（pom.xml 内容关键字）**：`spring-boot` / `springframework.boot` → `framework.spring-boot`；`quarkus` → `framework.quarkus`；`micronaut` → `framework.micronaut`。cwd 顶层与所有 submodule pom.xml 都扫。

**Node（package.json deps + devDeps）**：`next` → `framework.next.js`；`react` + `vite` → `framework.vite-react`；纯 `react` → `framework.react`；`vue` → `framework.vue`；`svelte` → `framework.svelte`；`express` → `framework.express`；`fastify` → `framework.fastify`。识别优先级与现有 `scanner.detectFramework` 完全一致。

每个 framework Fact 携带其来源 path，便于 `toLegacyTechStack` 决定挂载到 primary 还是 submodule。

### 3.4 Capabilities 扩展

`deriveCapabilities` 输出新增 `lint` key，规则：

| build / lang | command | 
|---|---|
| maven | `mvn checkstyle:check -q` |
| gradle | `gradle checkstyleMain` |
| typescript / javascript | 优先 `pkg.scripts.lint`，回退 `npx eslint .` |
| python | `ruff check .`（poetry 项目加前缀 `poetry run`） |
| go | `golangci-lint run` |
| rust | `cargo clippy` |
| 其他 | `status: unavailable` |

status 规则与现有 build/test/typecheck 一致：构建系统已 `auto` 决策时 `available`；解释型语言 + 缺包管理器时 `likely`。

### 3.5 ProjectIntelligence 投影：四个视图

```ts
// 已有
export function toLegacyTechStack(pi): TechStack;
export function toProjectCard(pi): string;

// 新增
export function pickVerifyPlan(pi: ProjectIntelligence): VerifyCommands {
  // 从 capabilities 反推
  const get = (key: "build"|"test"|"typecheck"|"lint") =>
    pi.capabilities.find(c => c.key === key && c.status !== "unavailable")?.command ?? null;
  return { build: get("build"), test: get("test"), typecheck: get("typecheck"), lint: get("lint") };
}

export function moduleRoots(pi: ProjectIntelligence): string[] {
  // 投影出 submodule.* facts 的目录名列表（含 cwd "."）
}
```

### 3.6 `dsh doctor` 命令 + Project Card 注入

**新文件** `packages/cli/src/commands/doctor.ts`：

```ts
export async function runDoctor(opts: { write?: boolean }) {
  const cwd = process.cwd();
  const pi = assembleIntelligence(cwd);
  console.log(toProjectCard(pi));
  if (opts.write) {
    const yml = renderProjectYml(pi);                     // 把 decisions 序列化
    fs.writeFileSync(path.join(cwd, ".dsh", "project.yml"), yml);
    console.log("\n✓ Wrote .dsh/project.yml (edit and commit to lock decisions)");
  }
}
```

**`main.ts` 注册**：`cli.command('doctor').option('--write')`。

**`context-builder.buildRepoContext` 注入**：

```ts
// 原有逻辑保留（Tech Stack 章节文案）
// 在 Tech Stack 章节后追加：
parts.push("");
parts.push(toProjectCard(assembleIntelligence(cwd)));
```

由于 `context-builder.ts` 现在接收 `RepoContext`（不含 cwd），需要把 `ProjectIntelligence` 作为输入注入到 `RepoContext`（新增字段 `intelligence: ProjectIntelligence`）。所有 `generateRepoContext` 调用点同步传 `cwd`。

### 3.7 `.dsh/project.yml` schema + override

```yaml
# .dsh/project.yml — 人工锁定 project intelligence 决策
# 任何字段缺省即沿用 assembleIntelligence 推断
language: java                 # 锁定 primary language
buildSystem: maven             # 锁定 build system
framework: spring-boot         # 锁定 framework
modules:                       # 锁定 submodules
  - path: backend
    language: java
    buildSystem: maven
    framework: spring-boot
  - path: frontend
    language: typescript
    framework: vue
verifyOverride:                # 可选：人工覆盖 verify plan
  test: "mvn -pl backend test"
```

**zod schema** 在 `packages/repo/src/project-yml.ts`。

**override 语义**：`assembleIntelligence` 读 `.dsh/project.yml` 后：
- 出现的字段以 `project_yml.*` Fact 形式注入，confidence: high
- Decision 层在该 key 上直接 short-circuit 返回 `mode: "auto"` + `confidence: 1.0`，evidence 为 "manual override (.dsh/project.yml)"
- 未出现的字段沿用 candidate / decide 流程

### 3.8 ctxDirs 重构

`repair-loop.resolveSourcePath` 与 `failure-detector.extractCompilationErrors` 当前各自硬编码：

```ts
const markers = ["/backend/", "/frontend/", "/src/", "/lib/", "/app/", "/pkg/", "/cmd/"];
```

替代设计：两函数签名追加参数 `moduleRoots: string[]`，由调用方从 `ProjectIntelligence` 投影传入。

```ts
function extractFailureSourceLocations(verifyOutput: string, moduleRoots: string[]) { ... }
function extractCompilationErrors(output: string, moduleRoots: string[]) { ... }
```

`moduleRoots` 内容：从 `pi.facts` 中所有 `submodule.<name>.*` 的 name + `src` / `lib` / `app` 等 layout hints（来自 `intelligence.collectFacts` 已有的 layout fact）。**列表来源动态**（依实际项目）；旧字面量删除。

兜底：如果 `moduleRoots` 为空（小项目），回退到 basename。

调用链：repair-loop / failure-detector 在 core 包，intelligence 在 repo 包，依赖方向合规（`cli → core → repo`）。

### 3.9 scanner.ts 物理删除 + RepoContext 拆分

**新文件** `packages/repo/src/repo-context.ts`（迁移）：

- `generateRepoContext(cwd, stack)` → `generateRepoContext(cwd, pi)`（输入由 TechStack 改 ProjectIntelligence，更直接）
- `generateDirectoryTree`、`findKeyFiles`、`getRecentGitLog` 全部迁移
- 类型 `RepoContext` 同步迁移；新增字段 `intelligence: ProjectIntelligence`（§3.6 用到）；`techStack` 字段由 `toLegacyTechStack(intelligence)` 在 builder 内投影，保持下游签名

**`scanner.ts`** 物理删除（整个文件）。

**`packages/repo/src/index.ts`** 更新：
- 删除：`detectTechStack` / `detectVerifyCommands` / `generateRepoContext`（从 scanner.js 的 re-export）+ 类型 `TechStack` / `SubModule` 也 re-export 改自 intelligence.js
- 新增：`runDoctor` / `pickVerifyPlan` / `moduleRoots` / `readProjectYml` / `writeProjectYml` 等
- 保留：`RepoContext` / `VerifyCommands` re-export 改自 repo-context.js

## 4. 数据模型 / 契约变更

| 契约 | 变化 |
|---|---|
| `TechStack` interface | 不变；定义位置 scanner.ts → intelligence.ts |
| `SubModule` interface | 不变；定义位置 scanner.ts → intelligence.ts |
| `VerifyCommands` interface | 不变；定义位置 scanner.ts → repo-context.ts |
| `RepoContext` interface | **新增字段** `intelligence: ProjectIntelligence`；定义位置 scanner.ts → repo-context.ts |
| `ProjectFact.key` 命名空间 | **新增** `submodule.*` / `framework.*` / `project_yml.*` 三组 |
| `ProjectCapability` keys | **新增** `lint`（之前只有 build/test/typecheck/patch） |
| `ProjectIntelligence` interface | 不变（capabilities 数组本身扩展条目数，类型不变） |
| `ProjectYml` (新) | 新增 zod schema：language / buildSystem / framework / modules / verifyOverride，全字段可选 |
| `@dsh/repo` 顶层导出 | 删除 `detectTechStack` / `detectVerifyCommands`；新增 `pickVerifyPlan` / `moduleRoots` / `readProjectYml` / `writeProjectYml` / `ProjectYml` |
| CLI 命令集 | 新增 `dsh doctor [--write]` |
| `extractCompilationErrors` / `extractFailureSourceLocations` 签名 | 追加参数 `moduleRoots: string[]` |
| 文件层 | **新增** `packages/repo/src/repo-context.ts` / `packages/repo/src/project-yml.ts` / `packages/cli/src/commands/doctor.ts`；**删除** `packages/repo/src/scanner.ts` |

## 5. 成功标准

### 5.1 功能验收

- [ ] `pnpm run scan` 通过（lint + typecheck + test）
- [ ] `grep -rn 'detectTechStack\|detectVerifyCommands' packages/ --include='*.ts' | grep -v node_modules | grep -v dist` 返回 **0 处生产调用**（仅在测试 / git 历史可能残留引用）
- [ ] `packages/repo/src/scanner.ts` 文件不存在
- [ ] `repair-loop.ts` + `failure-detector.ts` 中 `["/backend/"`、`"/frontend/"` 字面量列表已消失
- [ ] `intelligence.collectFacts` 在测试 fixture（顶层无 pom + `backend/pom.xml` + `frontend/package.json`）下产出 `submodule.backend.maven`、`submodule.frontend.npm` 等 Facts
- [ ] `toLegacyTechStack` 在同一 fixture 下返回 `{ language: "java", packageManager: "maven", framework: "spring-boot" (若 pom 含), modules: [{path:"backend",...}, {path:"frontend",...}] }`
- [ ] `dsh doctor` 命令在 4 类 fixture（typescript / python / java+vue / 顶层 + submodule 混合）上输出非空 Project Card
- [ ] `dsh doctor --write` 生成的 `.dsh/project.yml` 通过 zod schema 校验
- [ ] `.dsh/project.yml` 锁定 `buildSystem: gradle` 后，`assembleIntelligence` 即使在含 `pom.xml` 的目录也返回 `buildSystem.selected = "gradle"`（人工覆盖优先）
- [ ] `pickVerifyPlan` 在 4 类 fixture 上推导出与原 `detectVerifyCommands` 等价或更完整（含 lint）的命令集
- [ ] `context-builder.buildRepoContext` 输出含"## Project Card"章节

### 5.2 行为验收（数据驱动）

- [ ] 24 fixture replicated benchmark 跑通；对比基线 `260508-003359` / `260513-013656`：`completed` 不退化（≥ baseline），`testsPassed` 在 N≥3 replication + hard cleanup 条件下不低于 baseline；单 fixture pass rate 用 Wilson 95% CI 判断是否显著退化，高方差 fixture（pass rate 约 25%–75%）单独标注，不按普通退化归因
- [ ] release-hub 系列 fixture（`rh-*`）识别为 `java + maven + spring-boot`，`modules[]` 含 frontend submodule
- [ ] `context-builder.buildRepoContext` 在 3 个代表性 fixture（typescript / python / java+vue）上的字符级 diff：除 Project Card 新章节外，原有 Tech Stack 章节零回归
- [ ] repair-loop 在含路径前缀的 verifyOutput 上仍能正确切回相对路径（用 release-hub 路径样本做回归测试）

### 5.3 性能 / 成本验收

- [ ] `assembleIntelligence` 单次耗时（含浅扫子模块 + 读 project.yml）相对原 `detectTechStack` ≤ +30%（毫秒量级，可接受）
- [ ] Project Card 注入 prompt 后 token 增量 ≤ 600 tokens（Project Card 通常 < 30 行）

## 6. 风险与缓解

> 提示：风险表中标记为"已知妥协 / 临时方案"的条目，在实施时落到代码中，必须同步在 §9 跟踪事项中登记一条 `debt`。

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `toLegacyTechStack` 反推 modules/framework 与原 scanner 输出存在细微差异，引起 prompt / init 输出字符回归 | 中 | 中 | §5.2 引入"3 fixture buildRepoContext 字符级 diff（除 Project Card）零回归"硬验收；差异先核对语义再决定调整反推还是接受 |
| Project Card 注入改变模型行为，benchmark 出现随机波动 | 中 | 中 | §5.2 要求 N≥3 randomized A/B + hard cleanup；总通过数不低于 baseline 且单 fixture Wilson 95% CI 无显著退化时保留。若出现显著退化 → 调整 Project Card 文案 / 临时关闭 |
| `.dsh/project.yml` schema 设计错误（字段过于宽松或过于严格） | 中 | 中 | 先 prototype，跑 ≥3 个 fixture 实测 `dsh doctor --write` 输出，确认人工编辑工作流自洽再固化 |
| `pickVerifyPlan` 对解释型语言（python/typescript）capabilities=`likely` 时返回 null，导致 cli/init.ts 写出的 config.yml 缺命令 | 中 | 高 | `likely` 状态显式记录在 reason；cli/init 在缺命令时 fall back 到 `pkg.scripts.lint/test/...`（与原 detectVerifyCommands 同款 fallback 逻辑）；24 fixture 验收涵盖 typescript / python |
| ctxDirs 重构后 `moduleRoots` 在小项目（无子模块）下为空，路径切段失败 | 低 | 中 | 兜底：moduleRoots 为空时回退到 basename（与现状一致）；测试覆盖"无 submodule 的 ts 项目" |
| Capabilities 新增 lint key 后 `intelligence.test.ts` / 下游测试需要更新 | 高 | 低 | 实施时同步更新；本身就是契约扩展的正常成本 |
| scanner.ts 拆分到 repo-context.ts 后下游 import 路径变化 | 高 | 低 | 通过 `@dsh/repo` re-export 屏蔽内部路径变化，下游 import 不动 |
| `canonical-module-wiring-rule` 治理缺失再次导致"已实施 ≠ 已迁移"——本 spec 自身是这条缺失的产物 | 高 | 中 | §5.1 已含 "0 处生产调用" 硬验收；§9 保留 `canonical-module-wiring-rule` debt 条目作为元层补救跟踪 |

## 7. 实施策略

### 7.1 分 Phase

每步独立 commit，便于 review 与按需 revert。

| Step | 目标 | 关键产物 |
|---|---|---|
| 1 | intelligence.ts 数据模型扩展：submodule Fact + framework Fact + project_yml Fact + Capabilities lint key | `intelligence.ts` 修改 + `intelligence.test.ts` 增 ≥5 case |
| 2 | `pickVerifyPlan` + `moduleRoots` 投影函数 | `intelligence.ts` 新增 + 单测 |
| 3 | `.dsh/project.yml` schema 与读写：`packages/repo/src/project-yml.ts` | 新文件 + 单测 + assembleIntelligence override 集成测试 |
| 4 | `toLegacyTechStack` 扩展：modules + framework 反推 | `intelligence.ts` 修改 + parity test |
| 5 | RepoContext 拆分：`packages/repo/src/repo-context.ts` 新建，迁移 generateRepoContext 系；`RepoContext` 新增 `intelligence` 字段 | 新文件 + scanner.ts 瘦身 |
| 6 | 切换 4 处 `detectTechStack` 调用点 | pipeline / static-scanner / cli-init / benchmark-runner |
| 7 | 切换 1 处 `detectVerifyCommands` 调用点（cli/init） | cli/init.ts |
| 8 | scanner.ts 物理删除 + `repo/index.ts` 导出收敛 | 删文件 + index 改 |
| 9 | `dsh doctor` 命令：`packages/cli/src/commands/doctor.ts` + `main.ts` 注册 | 新命令 |
| 10 | Project Card 注入 prompt：`context-builder.buildRepoContext` 修改 + 3 fixture 字符级 diff 验证 | context-builder.ts |
| 11 | ctxDirs 重构：`repair-loop.resolveSourcePath` + `failure-detector.extractCompilationErrors` 接收 moduleRoots 参数；删除字面量列表 | repair-loop.ts + failure-detector.ts + 单测 |
| 12 | 24 fixture benchmark + 字符级 diff 验收 + 报告归档 | `docs/reports/knowledge/<date>-pie-phase2-3-baseline.md` |

### 7.2 回退策略

- Step 5（RepoContext 拆分）前：scanner.ts 仍工作，任何步骤可单独 revert
- Step 8（scanner.ts 删除）后：如 §5.2 行为验收退化 → 先尝试微调 candidate 评分 / 反推映射；3 次调整未收敛 → revert 至 Step 7 之前的状态（scanner 与 intelligence 并存），spec 转 `blocked`
- Step 10（Project Card 注入）单独可 revert：在 context-builder 加 feature flag `INJECT_PROJECT_CARD`，默认 true；benchmark 退化时切 false 不影响其它 Step

### 7.3 不在本 spec 范围

> 提示：列在此处的"非范围"如果属于"未来要做"性质，必须同步在 §9 跟踪事项中登记一条 `deferred`。

- 任何 `@deprecated` 标记或渐进迁移层（按用户口径"项目早期能移除就移除"，无 deferred）
- BLUEPRINT §2.6 Phase 3 中"verify plan 从 ProjectCapability 推导"的**模型增强**部分（如多模块独立 verify plan、test selectivity）—— 本 spec 只做 cli/init 写 config 时的投影，不动 runVerifyAssertions 协议
- spec 模板治理修订（"调用方迁移率"硬验收项纳入 spec 模板）—— 见 §9 `canonical-module-wiring-rule`

## 8. 不在本 spec 范围

（与 §7.3 同义。）

## 9. 本 spec 引发的跟踪事项

> **CONSTITUTION 原则 8 强制**：以下条目必须在本 spec 状态 ≥ in_review 之前同步登记到 `docs/project-ledger.md` §8。

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
| debt | canonical-module-wiring-rule | spec 模板 / CONSTITUTION 原则 5 展开：新模块取代旧模块时，Phase 完成验收必须含「调用方迁移率 = 100% AND 旧 API 物理删除」硬条目 | P2 | 起因：`project-intelligence-phase1` 标 resolved 时遗漏 wiring，导致本 spec 出现。本条解决"未来再次发生"的元层风险 |
| evidence | pie-phase2-3-baseline-comparison | 本 spec Step 12 完成时收集：24 fixture full benchmark vs `260508-003359` / `260513-013656`；context-builder.buildRepoContext 字符级 diff 报告 | P1 | 验证 Phase 2/3 合并退役不破坏 benchmark 表现 |
| deferred | verify-plan-model-enhancement | benchmark 数据揭示 verify plan 在多模块项目 / test selectivity 场景出现需求时启动 | P3 | §7.3 中显式排除的剩余范围：多模块独立 verify plan、test selectivity 等 verify 模型增强；本 spec 只做 cli/init 写 config 时的 capabilities → VerifyCommands 投影 |

**ledger §8 同步动作（in_review 推送时一并执行）：**

（说明性清单，不构成新声明；上方表格才是本 spec 引发的跟踪事项。）

- `project-intelligence-phase2`：waiting 保持；trigger 字段补述"Phase 2 全集由本 spec v1.1 覆盖"；本 spec resolved 时同步转 resolved
- `project-intelligence-phase3`：waiting → **cancelled**（superseded：detectVerifyCommands 退役由本 spec 覆盖；剩余 verify 模型增强见 §7.3 与上方 `verify-plan-model-enhancement` 条目）
- `pie-phase2-tier2-doctor-card`：waiting → **cancelled**（superseded：本 spec §3.6 覆盖）
- `pie-phase2-tier3-project-yml`：waiting → **cancelled**（superseded：本 spec §3.7 覆盖）
- `runtime-path-resolution-ctxdirs`：waiting → **cancelled**（superseded：本 spec §3.8 覆盖）
- `pie-phase2-tier1-baseline-comparison`：waiting → **cancelled**（superseded by 上方 `pie-phase2-3-baseline-comparison`）
- `canonical-module-wiring-rule`：waiting 保持（治理元层，本 spec 不覆盖）

## 10. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-13 | v1.0 (draft) | 初始 spec：PIE Phase 2 Tier 1 切片（子模块 + framework Fact + scanner.detectTechStack 退役） |
| 2026-05-13 | v1.1 (in_review) | 范围扩张：合并原 §2.2 中四条非目标（Tier 2 dsh doctor + Project Card 注入 / Tier 3 .dsh/project.yml / ctxDirs 重构 / Phase 3 detectVerifyCommands 退役）。文件名延续 v1.0 命名以保 ledger 引用稳定 |
| 2026-05-15 | v1.2 (in_review) | 修订 §5.2 benchmark 验收：废弃 deterministic `testsPassed ±2` 阈值，改为 N≥3 replication + hard cleanup + Wilson 95% CI 退化判定；同步更新 Project Card 风险缓解 |
