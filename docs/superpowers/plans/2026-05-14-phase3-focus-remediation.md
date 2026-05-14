# DSH Phase 3 聚焦整改实施计划

> **给后续 agentic worker 的要求：** 执行本计划时必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项勾选推进。

**目标：** 让 DSH 的公开入口、ProjectIntelligence 主路径状态、Benchmark 证据、事务级自修复证据，以及 CLI 一键入口在 Phase 3 口径下保持一致。

**总体判断：** 用户给出的指令方向正确，但部分前提已经落后于当前仓库事实。当前不应重做 scanner 退役或 ProjectIntelligence 接入，而应做事实同步、验收补缺、failure matrix 和最小 `dsh run`。

**技术栈：** TypeScript ESM、pnpm workspace、`cac` CLI、`node:test`、`zod`、`packages/eval` benchmark runner。

---

## 0. 指令甄别结论

### 仍然成立，必须处理

- `README.md`、`BLUEPRINT.md`、`docs/project-ledger.md`、`CLAUDE.md` 的状态描述不完全一致。
- `README.md` clone 地址仍是旧地址。
- `README.md` 当前基线仍写 `8/24`，而 ledger 记录的最新稳定全量是 `11/24`，最新 replicated evidence 是 `60/72 = 83.3%`。
- `dsh run` 还没有 CLI 命令入口。
- 缺少一份面向 Phase 3 的 benchmark failure matrix。

### 已经完成，不应重复做

- `packages/repo/src/scanner.ts` 已经物理删除。
- `packages/core/src/pipeline.ts` 已调用 `assembleIntelligence` 和 `generateRepoContext(cwd, pi)`。
- `packages/cli/src/commands/init.ts` 已调用 `assembleIntelligence`、`toLegacyTechStack` 和 `pickVerifyPlan`。
- `Project Card` 已在 `packages/core/src/context-builder.ts` 默认注入，并支持 `DSH_INJECT_PROJECT_CARD=false` 关闭。
- `.dsh/project.yml` 已存在，对应 `packages/repo/src/project-yml.ts`，当前 schema 是扁平字段：`language`、`buildSystem`、`framework`、`modules`、`verifyOverride`。
- `transactional-self-correction P1` 已部分实现：patch / repair checkpoint、managed files、rollback 标记、stuck-on-error hint 均已存在。
- 2026-05-14 N=3 replicated benchmark 证据显示 Project Card on 为 `60/72 = 83.3%`，约等价 `20/24`，已经超过 Phase 3 `>60%` 目标。

### 需要调整口径

- 不要另起一套 `.dsh/project.yml` 嵌套 `{ value, source }` schema，除非新 spec 批准迁移。当前最小人工确认层已经有测试。
- 不做 TUI、MCP、多 Provider、Memory、Web Search、子 Agent 系统或 Skills 市场。
- 不要随意重跑 144 trial replicated benchmark。该实验耗时约 18.8 小时。只有行为变更后才需要全量或 replicated 复跑。

---

## 文件范围

### 预计修改

- `README.md`：修正定位、clone 地址、当前阶段、benchmark baseline / 最新证据、使用说明。
- `BLUEPRINT.md`：同步 ProjectIntelligence 当前实现状态，避免把已完成事项写成未来目标。
- `docs/project-ledger.md`：同步最新证据和下一轮优先级。
- `CLAUDE.md`：修正 “scanner / 6 commands” 等过期描述。
- `packages/cli/src/main.ts`：注册 `dsh run`。
- `packages/cli/src/commands/run.ts`：新增一键执行命令。
- `packages/cli/src/commands/run.test.ts`：覆盖输出状态映射。
- `packages/core/src/pipeline.ts`：如有必要，补 `runFullPipeline` 的 `handoff_path` 持久化和 `dryRun` 透传。
- `packages/core/src/task-state.ts`：如有必要，确认 `handoff_path` schema 可用。
- `packages/core/src/pipeline.test.ts`：如 core 行为调整，补测试。
- `docs/reports/knowledge/20260514-phase3-failure-matrix.md`：新增 Phase 3 failure matrix。

### 只读参考

- `docs/reports/knowledge/20260514-pie-phase2-3-baseline.md`
- `docs/reports/runlogs/260514020257-pie-replicated/results.json`
- `docs/specs/2026-05-13-pie-phase2-tier1-submodule-fact-promotion.md`
- `docs/specs/2026-05-10-transactional-self-correction.md`
- `docs/tasks/2026-05-10-patch-loop-rollback-p1.md`

---

## Task 1：P0 文档事实入口同步

**文件：**

- 修改：`README.md`
- 修改：`BLUEPRINT.md`
- 修改：`docs/project-ledger.md`
- 修改：`CLAUDE.md`

- [ ] **Step 1：修正 README 标题、定位和 clone 地址**

README 开头应表达为：

```markdown
# DSH — DeepSeek-native, benchmark-gated, verify-first Coding Harness

一个围绕 DeepSeek 模型行为深度优化的终端编程助手，覆盖从任务理解、代码生成、验证修复到交接沉淀的验证闭环。

**核心流程:** Plan → Patch → Verify → Repair → Handoff
**当前阶段:** Phase 3（工具化 / 验证闭环攻坚）
**Phase 3 起点基线:** testsPassed 11/24 = 45%（`260508-003359` / `260509-165142`）
**Phase 3 目标:** testsPassed > 60%
**最新实证:** 2026-05-14 N=3 replicated benchmark：Project Card on `60/72 = 83.3%`，约等价 `20/24`，详见 `docs/reports/knowledge/20260514-pie-phase2-3-baseline.md`
```

安装命令改为：

```bash
git clone https://github.com/tongsh6/dsh.git
cd dsh
pnpm install
pnpm -r run build
```

- [ ] **Step 2：修正 README 模块结构**

模块结构应更新为：

```text
packages/
├── cli/        # CLI 入口，当前 7 个命令（init/plan/patch/verify/repair/handoff/doctor），本轮补 run
├── core/       # 核心引擎 — 流水线、协议解析、修复循环、静态治理、工具系统
├── provider/   # DeepSeek API 客户端，thinking/non-thinking 路由
├── repo/       # 项目分析 — ProjectIntelligence、RepoContext、文件排序、规则加载、Git 辅助
└── eval/       # Benchmark 执行器、任务夹具、评分与报告
```

在 Task 5 实现 `dsh run` 后，再在 README 使用说明中加入：

```bash
dsh run "添加用户注销接口" --max-repair-rounds 5
```

- [ ] **Step 3：修正 BLUEPRINT 的 ProjectIntelligence 状态**

在 `BLUEPRINT.md` §2.6 保留 scanner 问题作为历史背景，但新增当前实现状态：

```markdown
**当前实现状态（2026-05-14）**：`scanner.ts` 已退役，生产路径通过 `assembleIntelligence` 生成 `ProjectIntelligence`；`init` 使用 `pickVerifyPlan` 投影验证命令；`pipeline` 通过 `generateRepoContext(cwd, pi)` 注入 RepoContext；LLM 上下文默认包含 Project Card，并可通过 `DSH_INJECT_PROJECT_CARD=false` 关闭。
```

Phase 3 的描述不要暗示 TUI、MCP、子 Agent 是本阶段目标。

- [ ] **Step 4：同步 project-ledger**

在 `docs/project-ledger.md` §1 增加最新证据：

```markdown
- **最新 replicated benchmark evidence**: Project Card on `60/72 = 83.3%` over 24 fixtures × 3 reps — `docs/reports/knowledge/20260514-pie-phase2-3-baseline.md`；该结果已超过 Phase 3 `>60%` 目标，但 3 个 hard-fail fixture 仍需根因分析。
```

Top Priority 更新为：

- P0：文档事实入口同步 + failure matrix。
- P1：调查 hard-fail fixtures：`pi-bugfix-count-defs`、`rh-refactor-branch-orchestrator`、`rh-test-dashboard-version`。
- P2：补最小 `dsh run`。

- [ ] **Step 5：同步 CLAUDE.md**

修正过期描述：

- “6 commands” 改为 “当前 7 commands，本轮计划补 `run`”。
- “repo scanner” 改为 “ProjectIntelligence / RepoContext / file ranking / rules / git helpers”。

- [ ] **Step 6：验证文档同步结果**

运行：

```bash
rg -n "git@github.com:loong/dsh|testsPassed 8/24|scanner, file-ranker|6 commands" README.md BLUEPRINT.md docs/project-ledger.md CLAUDE.md
```

期望：

- 不再出现旧 clone 地址。
- README 不再出现过期 `testsPassed 8/24`。
- 不再把 `scanner.ts` 写成 canonical 项目识别入口。

---

## Task 2：ProjectIntelligence 主路径验收与小缺口加固

**文件：**

- 仅在测试暴露缺口时修改：`packages/repo/src/intelligence.ts`
- 仅在测试暴露缺口时修改：`packages/repo/src/project-yml.ts`
- 测试：`packages/repo/src/intelligence.test.ts`
- 测试：`packages/repo/src/project-yml.test.ts`
- 测试：`packages/core/src/context-builder.test.ts`
- 测试：`packages/cli/src/commands/init.test.ts`

- [ ] **Step 1：确认生产代码中没有旧 scanner 调用**

运行：

```bash
rg -n "detectTechStack|detectVerifyCommands|from \"./scanner|scanner\\.js" packages scripts --glob '*.ts'
```

期望：

- `packages/` 中没有生产 import 或调用。
- `tool-executor.test.ts` 中的 fixture 字符串可以保留，因为它测试 grep 行为。
- `scripts/diagnose-realistic-patch.ts` 如果仍引用旧 `dist` scanner API，应改为 `assembleIntelligence`，或明确标为废弃。优先改掉，避免后续误导。

- [ ] **Step 2：补齐安全断言**

如果当前测试未覆盖，新增以下行为测试：

```ts
it("does not confirm Node package manager without lockfile", () => {
  withTmp((tmp) => {
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({
      name: "x",
      devDependencies: { typescript: "^5.0.0" },
      scripts: {},
    }), "utf-8");
    fs.writeFileSync(path.join(tmp, "tsconfig.json"), "{}", "utf-8");
    touch(path.join(tmp, "src", "a.ts"), "export const a = 1;");
    touch(path.join(tmp, "src", "b.ts"), "export const b = 2;");
    touch(path.join(tmp, "src", "c.ts"), "export const c = 3;");
    const pi = assembleIntelligence(tmp);
    const stack = toLegacyTechStack(tmp, pi);
    const plan = pickVerifyPlan(tmp, pi);
    assert.equal(stack.packageManager, null);
    assert.equal(plan.test, null);
  });
});
```

```ts
it("does not default Python verify commands without project evidence", () => {
  withTmp((tmp) => {
    touch(path.join(tmp, "a.py"), "x=1");
    touch(path.join(tmp, "b.py"), "x=1");
    touch(path.join(tmp, "c.py"), "x=1");
    const plan = pickVerifyPlan(tmp, assembleIntelligence(tmp));
    assert.equal(plan.test, null);
    assert.equal(plan.lint, null);
    assert.equal(plan.typecheck, null);
  });
});
```

如果 Python 测试失败，修改 `fillPythonFallback`：只有存在 `pyproject.toml`、`requirements.txt`、`poetry.lock`、`uv.lock` 或 `Pipfile` 等证据时才生成 pytest / ruff / mypy 命令。

- [ ] **Step 3：检查 Project Card 内容合同**

扩展 `toProjectCard` 测试，确保输出包含：

- `Known`
- 适当场景下的 `Inferred (unconfirmed)` 或 `Unknown`
- `Capabilities`
- 默认不暴露 capability shell command，只有 `includeCommands: true` 才暴露。

运行：

```bash
pnpm --filter @dsh/repo run test
pnpm --filter @dsh/core run test -- context-builder
```

期望：相关测试全部通过。

---

## Task 3：建立 Benchmark Failure Matrix

**文件：**

- 新增：`docs/reports/knowledge/20260514-phase3-failure-matrix.md`
- 读取：`docs/reports/runlogs/260514020257-pie-replicated/results.json`
- 读取：`docs/reports/knowledge/20260514-pie-phase2-3-baseline.md`

- [ ] **Step 1：基于最新 replicated evidence 生成矩阵**

采用 `260514020257-pie-replicated` 作为最新高质量证据，因为它使用了 N=3 和 hard cleanup。

矩阵初稿：

| fixture | repo | 当前结果 | 失败类型 | 根因 | 修复策略 | 预计收益 | 修复后结果 |
|---|---|---|---|---|---|---|---|
| pi-bugfix-count-defs | pi-proof-forge | 0/6 pass | semantic_incorrect | 模型修了 checker 计数逻辑，但没有补 `tools/infra` 中期望的函数定义 | 单 fixture 复现；为 expected definitions 补 source-context hint | 修成后 +1 fixture | pending |
| rh-refactor-branch-orchestrator | release-hub | 0/6 pass | patch_apply_failure | 大型跨 service refactor 中 patch loop 产出 `<empty>` 或 failed patch | 不做大重构；先分析 failed patch turn，必要时拆 fixture 或增强大 refactor patch emission guard | 修成后 +1 fixture | pending |
| rh-test-dashboard-version | release-hub | 0/6 pass | wrong_verification_command | Maven 命令在 `releasehub-common` 上触发 `No tests to run`，与 `-am -DfailIfNoTests=true` 有关 | 调整 fixture verify 命令，避免 upstream 无匹配测试模块失败 | 修成后 +1 fixture | pending |
| loam-refactor-rename-distill-state | loamlog | on 1/3, off 0/3 | patch_apply_failure | 高方差，常见 empty/failed patch | 分析 failed patch turn，补 rename-specific prompt guard | 稳定性 +1 | pending |
| loam-bugfix-cli-error-handling | loamlog | on 2/3, off 2/3 | semantic_incorrect | 高方差，部分语义修复后 verify 仍失败 | 复盘共同 verify output；只有模式重复才加 detector | 稳定性 | pending |
| loam-refactor-provider-dedup | loamlog | on 3/3, off 2/3 | context_missing | Project Card on 提升稳定性 | 保持 Project Card 默认开启 | 无需立即修 | accepted |
| loam-refactor-reorganize-tests | loamlog | on 3/3, off 2/3 | context_missing | Project Card on 提升稳定性 | 保持 Project Card 默认开启 | 无需立即修 | accepted |
| rh-mixed-remove-starter-ping-demo-frontend | release-hub | on 3/3, off 2/3 | context_missing | Project Card on 提升稳定性 | 保持 Project Card 默认开启 | 无需立即修 | accepted |

- [ ] **Step 2：加入失败类型优先级**

报告中加入：

```markdown
## Top Failure Types

1. `patch_apply_failure`：hard-fail / 高方差 fixture 的最高杠杆类型，常见表现是 empty patch 或 failed patch。
2. `wrong_verification_command`：`rh-test-dashboard-version` 是具体 Maven verify bug，应优先做 targeted fix。
3. `semantic_incorrect`：`pi-bugfix-count-defs` 需要单 fixture 复现后再修，不做泛化 prompt 改写。
```

- [ ] **Step 3：记录 benchmark 前后对比**

“修复前”记录：

- Phase 3 起点 baseline：`11/24 = 45%`。
- 最新 replicated evidence：Project Card on `60/72 = 83.3%`。

“修复后”在未做行为修改前写 `not rerun in this task`。如果 Task 4 修改 fixture verify 或 repair 行为，至少运行：

```bash
pnpm run build
node run-benchmark.ts --filter=rh-test-dashboard-version --parallel=1
node run-benchmark.ts --filter=pi-bugfix-count-defs --parallel=1
```

---

## Task 4：只做有复现依据的 Benchmark 定点修复

**文件：**

- 复现后才修改：`packages/eval/src/fixtures/rh-test-dashboard-version.yaml`
- 复现后才修改：`pi-bugfix-count-defs` 对应 fixture YAML
- 复现后才修改：`packages/core/src/prompt-builder.ts` 或 `packages/core/src/repair-loop.ts`
- 测试：`packages/eval/src/task-fixtures.test.ts`
- 测试：`packages/eval/src/benchmark-runner.test.ts`

- [ ] **Step 1：优先修 `rh-test-dashboard-version` verify 命令**

先复现：

```bash
node run-benchmark.ts --filter=rh-test-dashboard-version --parallel=1
```

如果仍是 `releasehub-common: No tests to run`，只调整该 fixture 的 Maven 命令。候选形态：

```bash
cd backend && mvn -pl releasehub-application test -Dtest="DashboardAppServiceTest,VersionUpdateAppServiceTest" -q -DfailIfNoTests=true
```

如果 `-am` 与 `-DfailIfNoTests=true` 导致 upstream 无匹配测试模块失败，则不要使用 `-am`。

- [ ] **Step 2：复跑修复后的 fixture**

运行：

```bash
pnpm --filter @dsh/eval run test
node run-benchmark.ts --filter=rh-test-dashboard-version --parallel=1
```

期望：

- fixture schema 测试通过。
- `rh-test-dashboard-version` 不再因 `No tests to run` 失败。

- [ ] **Step 3：再调查 `pi-bugfix-count-defs`**

复现：

```bash
node run-benchmark.ts --filter=pi-bugfix-count-defs --parallel=1
```

如果模型反复只修改 `tools/check_v2_constraints.py`，不要改 ProjectIntelligence；应补针对该 fixture 的上下文或 repair hint，让模型看到 expected function definitions 应该落在 `tools/infra`。

- [ ] **Step 4：本轮最多修两个具体 blocker**

不要在本轮做大范围 prompt 重写。只有当单 fixture 复现证明 blocker 明确，且修复范围小于等于两个文件时才动代码。

---

## Task 5：实现最小可用 `dsh run`

**文件：**

- 新增：`packages/cli/src/commands/run.ts`
- 修改：`packages/cli/src/main.ts`
- 测试：`packages/cli/src/commands/run.test.ts`
- 如有必要修改：`packages/core/src/pipeline.ts`
- 如有 core 修改则测试：`packages/core/src/pipeline.test.ts`

- [ ] **Step 1：新增命令 wrapper**

`packages/cli/src/commands/run.ts` 行为：

- 调用 `createClient(cwd)`。
- 调用 `runFullPipeline`。
- 支持：
  - `dsh run "任务描述"`
  - `dsh run "任务描述" --dry-run`
  - `dsh run "任务描述" --max-repair-rounds 5`
  - 可选 `--type <type>`，沿用 `plan` 的 task type。
- 命令结束后输出：
  - `Status:`
  - `Changed files:`
  - `Verify summary:`
  - `Repair rounds:`
  - `Handoff path:`
  - `Next action:`

状态映射：

- `verified` → 输出 `Status: verified`
- `repair_exhausted` → 输出 `Status: repair_exhausted`
- `patch_failed` → 输出 `Status: patch_failed`

- [ ] **Step 2：注册 CLI**

在 `packages/cli/src/main.ts` 增加：

```ts
import { runCommand } from "./commands/run.js";
```

并注册：

```ts
cli
  .command("run <description>", "Run plan → patch → verify → repair → handoff")
  .option("--type <type>", "Task type: bugfix, feature, refactor, test, docs")
  .option("--dry-run", "Generate patch without applying changes")
  .option("--max-repair-rounds <n>", "Max repair rounds", { default: 5 })
  .action((description, opts) => runCommand(description, opts));
```

- [ ] **Step 3：必要时让 `runFullPipeline` 记录 handoff path**

如果当前 `runFullPipeline` 只调用 `runHandoff` 但不写回 state，应改为：

```ts
const handoffPath = await runHandoff({ cwd });
state = { ...state, handoff_path: handoffPath };
writeTaskState(cwd, state);
return state;
```

如果要支持 `--dry-run`，给 `FullPipelineParams` 增加 `dryRun?: boolean`，并透传给 `runPatch`。

- [ ] **Step 4：补测试**

测试覆盖：

- `main.ts` 注册了 `run`。
- `runCommand` 在 core 返回 `verified` 时输出 `Status: verified`。
- `runCommand` 在 core 返回 `repair_exhausted` 时输出 `repair_exhausted`。
- `runCommand` 在 patch 失败时输出 `patch_failed`。
- `runFullPipeline` 写入 `handoff_path`。

测试必须避免真实网络调用。

- [ ] **Step 5：运行 CLI / core 测试**

```bash
pnpm --filter @dsh/core run test
pnpm --filter @dsh/cli run test
pnpm --filter @dsh/cli run typecheck
```

---

## Task 6：transactional-self-correction P1 证据闭环

**文件：**

- 仅测试暴露缺口时修改：`packages/core/src/pipeline.ts`
- 仅测试暴露缺口时修改：`packages/core/src/repair-loop.ts`
- 测试：`packages/core/src/pipeline.test.ts`
- 测试：`packages/core/src/rollback.test.ts`
- 报告：`docs/reports/knowledge/20260514-phase3-failure-matrix.md`

- [ ] **Step 1：确认已有测试覆盖**

运行：

```bash
pnpm --filter @dsh/core run test
```

检查是否覆盖：

- 模型过早 `<DONE/>` 且没有任何修改时，会被拒绝。
- 连续两轮相同 verify output 会注入 stuck-on-error。
- patch round / managed files 会记录 touched files。
- verify 未通过时，handoff 不会被描述成成功。

- [ ] **Step 2：只补缺失测试**

如果缺测试，补以下合同：

- patch loop 提前 `<DONE/>` 且无修改时，记录 `invalid_reason: "done_with_no_changes"`。
- 两轮相同 verify output 后，repair prompt 包含 `stuck-on-error` 或 `修复停滞`。
- patch 成功修改文件后，`managed_files` 包含 touched files。
- `runFullPipeline` 在 verify 未通过时最终保持 `repair_exhausted`。

- [ ] **Step 3：记录证据**

在 failure matrix 报告中加入：

```markdown
## Transactional Self-Correction P1 Evidence

- Local unit tests: `pnpm --filter @dsh/core run test`
- Existing smoke evidence: `docs/reports/runlogs/260512-225408/` and `docs/reports/runlogs/260513-013656/`
- Remaining evidence gap: full 24-fixture repairSuccess net effect should be measured after any behavior-changing repair-loop patch.
```

---

## Task 7：最终质量门禁与报告

**文件：**

- 本任务不改代码，只跑验证并写最终报告。

- [ ] **Step 1：运行仓库质量命令**

```bash
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run test
```

期望全部通过。

- [ ] **Step 2：按变更范围运行 benchmark**

如果只改文档和 `dsh run`：

```bash
pnpm run scan
```

如果改了 fixture verify 或 repair 行为：

```bash
node run-benchmark.ts --filter=rh-test-dashboard-version --parallel=1
node run-benchmark.ts --filter=pi-bugfix-count-defs --parallel=1
node run-benchmark.ts --parallel=3
```

期望：

- 被触碰的 fixture 改善，或暴露更窄根因。
- 全量 benchmark 不低于 `15/24`。如果未达到，必须列出回归 fixture 和失败类型。

- [ ] **Step 3：最终报告格式**

最终回复按用户要求输出：

```markdown
# DSH Phase 3 整改执行报告

## 1. 本次改动摘要
## 2. 文档修正
## 3. ProjectIntelligence 主路径接入情况
## 4. Benchmark Failure Matrix
## 5. Benchmark 修复前后对比
## 6. transactional-self-correction P1 实施情况
## 7. dsh run 实施情况
## 8. 新增 / 修改测试
## 9. 执行过的质量命令
## 10. 当前仍存在的问题
## 11. 下一轮优先级建议
```

---

## 推荐执行顺序

1. Task 1：先做文档事实同步。
2. Task 2：验证 ProjectIntelligence 主路径和补小测试。
3. Task 3：建立 failure matrix。
4. Task 5：补最小 `dsh run`。
5. Task 6：补 transactional-self-correction P1 证据闭环。
6. Task 4：只有复现明确且修复很小，才做 benchmark targeted fix。
7. Task 7：质量门禁和最终报告。

不要在 Task 3 之前开始 Task 4。没有 failure matrix 的修复会退回到“凭直觉优化”的老问题。
