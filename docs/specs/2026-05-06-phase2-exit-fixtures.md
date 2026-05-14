# Phase 2 退出 — Fixture 补齐 SPEC

> 状态: draft v0.6 | 日期: 2026-05-14 | 作者: loong / ai
>
> 目标: 把 Phase 2 仅剩的两条退出条件（v0.4 协议操作覆盖率、多语言）补齐到可勾选状态。
>
> v0.5 变更: 增加 controlled benchmark suite 策略；loamlog / release-hub / pi-proof-forge 作为正在推进项目时，Phase 2 严格退出只基于专用 benchmark 分支 + 固定提交，不跟随 live main。
>
> v0.6 变更（doc-lag 回补）：§3.3 第 2 条 + §3.5 + §4.6 与 commit `f97aae3` 实施现状对齐。原 §4.6 设计的 3 个"双侧单 fixture" (F9/F10/F11)，`f97aae3` 实施时拆为 3 个 "单侧成对 fixture" (`<scenario>-{backend,frontend}`) 共 6 个 yaml，但 spec 未同步更新。本版本回补此差异，**不改 fixture 实现**。

## 1. 问题定义

### 1.1 Benchmark 池实际缺口（基于 260506-004042）

Benchmark 实际跑的 fixture 池 = `pi-/loam-/rh-` 前缀，共 13 个。

| 维度 | 现状 | 缺口 |
|------|------|------|
| CREATE 覆盖 | 标注 7 / 实测 5 | ✅ |
| PATCH 覆盖 | 标注 9 / 实测 2 | ✅ |
| SEARCH_REPLACE 覆盖 | 标注 1 / 实测 7 | ❌ 标注 ≥2 |
| INSERT 覆盖 | 标注 0 / 实测 2 | ❌ 标注 ≥3 |
| DELETE 覆盖 | 标注 0 / 实测 0 | ❌ 标注 ≥3 + ≥1 实测触发 |
| RENAME 覆盖 | 标注 0 / 实测 0 | ❌ 标注 ≥3 + ≥1 实测触发 |
| TS 多语言 | loamlog 5/5 ✅ | ✅（仅 loamlog 即满足，dsh 自身不参与） |
| Java+Vue（rh）混合 | 0 个混合 fixture | ❌ ≥3 |

严格按 BLUEPRINT 条件「每种操作 ≥3 个 fixture 标注预期触发，且 ≥1 个 fixture 实际触发」计算，当前协议覆盖只有 **2/6**（CREATE/PATCH）。SEARCH_REPLACE 和 INSERT 虽有实测触发，但标注数不达标；DELETE/RENAME 标注和实测都缺失。

### 1.2 关键技术前提（决定 DELETE/RENAME 设计可行性）

调研 `packages/core/src/patch-parser.ts`：

- **DELETE 实现**: `fs.unlinkSync(absPath)` —— 物理删除，与 PATCH 清空文件在 fs 层有差别（前者文件不存在、后者文件存在但 0 字节）
- **RENAME 实现**: `fs.renameSync(fromAbs, toAbs)` —— 与「CREATE 新名 + DELETE 旧名」在 fs 层**完全等价**，只在协议块文本中可区分

**含义**:
- DELETE 可以靠 fs 验证（`! test -f <path>`）把模型自然逼向 `<DELETE>`：模型若用 PATCH 清空，文件仍存在，verify 失败 → repair 阶段重试更可能换 DELETE
- RENAME 在 fs 层无法与 CREATE+DELETE 区分，唯一驱动模型选 RENAME 的因素是 **token 经济性**：`<RENAME from to/>` 是 30 tokens 的 self-closing；`<CREATE>` 必须重写全文。文件越大、模型越倾向 RENAME

### 1.3 失败 fixture 根因分析

#### `loam-docs-provider-readme`

- **现象**: 260506-205009 / 260506-205732 两次单 fixture run 都是 patch loop `<DONE/>`，但 0 change，verify 失败。
- **直接证据**: `~/dsh-bench/repos/loamlog` 中存在未跟踪文件 `docs/providers.md`；该文件不是 git tracked 文件，但被上一轮 benchmark 遗留。模型读到目标文件已存在且内容完整，于是合理终止。
- **根因裁决**: 主因是 **benchmark 工具实现问题**：`prepareBranch` / `resetToMain` 只执行 `git reset --hard`，没有 `git clean -fd`，untracked 产物跨 fixture 污染。fixture 本身需要补充前置条件「目标文件不存在」，但不能靠增加 `maxRepairRounds` 解决。
- **设计结论**: 保留为 CREATE 单一目标 fixture 可以成立；修复点是 benchmark 隔离清理 + fixture 前置条件显式化，而不是把 `expectedProtocolOperations` 或 repair 轮数当万能旋钮。

#### `rh-test-dashboard-version`

- **现象**: 260506-004042 报告显示通过，但 patch loop 中多次把 `CREATE` / `PATCH` 当作 tool name 调用，且当前 bench repo 里两个测试文件均为未跟踪文件。
- **直接证据**: `~/dsh-bench/repos/release-hub` 中存在未跟踪的 `DashboardAppServiceTest.java` 与 `VersionUpdateAppServiceTest.java`。旧 verification command 只跑 Maven 测试，不先断言目标文件由本轮变更产生，容易被遗留文件造成虚假通过。
- **根因裁决**: 主要是 **benchmark 隔离问题 + 工具协议提示问题**，不是单纯 fixture 命令问题。当前为 verification command 增加 `test -f ...` 只能降低虚假通过概率，不能替代工作树清理；`CREATE`/`PATCH` 被当作 tool 的问题需要后续 prompt/tool schema 隔离设计处理。
- **设计结论**: 该 fixture 是纯 Java 后端测试 fixture，不满足 release-hub 作为 Java+Vue 混合前后端项目的代表性要求。它可以留作 Java 单特性 fixture，但不能计入「rh Java+Vue 混合 ≥3」退出条件。

### 1.4 BLUEPRINT 文本修正

BLUEPRINT.md L170 把 release-hub 误归为 TypeScript：

```
- [ ] **多语言** — Python（pi-proof-forge）+ TypeScript（dsh/loamlog/release-hub）...
```

应改为：

```
- [ ] **多语言** — Python（pi-proof-forge）≥3 + TypeScript（loamlog）≥3 + Java+Vue 混合（release-hub 后端 Java + 前端 Vue）≥3
```

**修正影响**:
- TS 维度：移除 dsh 与 release-hub，由 loamlog 5/5 独自满足，无新增工作
- Java+Vue 维度：从 BLUEPRINT 原文的「Phase 3 目标」前置为 Phase 2 退出条件之一，与用户反馈对齐
- ledger §1 多语言行需同步修正
- 不影响其它退出条件

## 2. 非目标

- 不建 dsh 自身仓库镜像、不为 dsh- 前缀 fixture 设计（用户明确反对）
- 不改 pipeline / patch-parser / prompt-builder
- 不在任务 prompt 中显式写「请使用 DELETE/RENAME 操作」之类的偷懒指令
- 不为凑数标注 `expectedProtocolOperations` 而违背 fixture 真实场景
- 不修 P1 待跟踪问题（tool_use 误写协议操作名）— 由后续单独 spec 处理
- 不更换目标仓库作为当前主路径；先把现有真实项目冻结成可复现 benchmark 基线。仓库替换作为后备方案，仅在冻结分支仍无法稳定维护时启动。

## 3. 设计原则

### 3.1 单一目标 fixture + 复合型 fixture 分层

每个有缺口的协议操作分两层覆盖：

1. **单一目标 fixture（每个操作 1 个）**: 任务场景纯净，目标只验证该操作的核心能力。如「删除一个独立的废弃文件」、「重命名一个 200 行的库文件」。验证命令直接对应该操作的物理结果。
2. **复合型 fixture（每个操作 ≥2 个）**: 任务是真实重构/feature 场景，多协议操作并存是任务自然属性。如「重构 X 模块：拆分新模块 + 删除旧文件 + 修引用」既需要 CREATE 又需要 DELETE。

「≥3 标注」由 1 单一 + 2 复合凑齐。「≥1 实测触发」由单一 fixture 强逼模型走该操作（设计上让其它操作不可能通过 verify）。

### 3.2 每个 fixture 必须显式回答 4 个问题

| 字段 | 含义 |
|------|------|
| 设计目标 | 这个 fixture 测试什么能力或场景 |
| 验证目标 | verificationCommands 实际检查什么物理结果 |
| 预期协议操作（标注） | `expectedProtocolOperations` 列表 |
| 自然触发理由 | 为什么模型在该任务下会选用这些操作（任务语义、文件大小、token 经济性、verify 约束） |

不允许仅靠 prompt 指令「请使用 X 操作」——必须由任务本身的物理/经济约束驱动。

### 3.3 严格 benchmark 约束

1. **不依赖隐式前置文件**：新 fixture 只使用目标 repo 中已 tracked 的真实文件。不能要求人工在 bench repo 放置未跟踪占位文件；`git clean -fd` 会删除它们。
2. **rh 混合 fixture 定义**（v0.6 扩展）：计入 Java+Vue 多语言条件的 rh fixture 必须形成 "backend + frontend pair"，二选一：
   - **(a) 双侧单 fixture**：单 fixture 同时修改 `backend/**/*.java` 和 `frontend/**/*.ts|vue`，验证命令两侧都检查；或
   - **(b) 单侧成对 fixture**：两个独立 fixture，分别只改 backend / 只改 frontend，但共享同一业务场景（如同一 dashboard 字段的后端实现 + 前端展示），通过 fixture id 前缀 `<scenario>-{backend,frontend}` 标识 pair 关系。每个 yaml 的 `designGoal` 字段必须显式标注"rh 混合对 X 侧"。
   - **计数规则**：在"Java+Vue 混合 ≥3" 退出条件下，每 pair 计为 1 个混合 fixture（不是 2 个）。
   - **实施决策（commit `f97aae3`）**：F9/F10/F11 均按 (b) 实施。理由：(i) 测分阶段能力，模型在纯 Java vs 纯 TS+Vue 上的信号可拆解；(ii) 双侧 fixture 失败时 verify 定位困难，单侧 fixture 易于诊断；(iii) parallel 调度粒度更细，减少 tail latency；(iv) 与 spec §3.3 第 3 条 "fixture 仍应写成少量明确命令" 协同（双侧 verify 链过长）。
3. **验证命令真实执行**：benchmark runner 已支持将全部 `verificationCommands` 组合成一条 `&&` 链执行；fixture 仍应写成少量明确命令，避免只有第一条生效的旧问题。
4. **协议实测验收**：DELETE/RENAME 的单一目标 fixture 必须在 `actualProtocolOps` 中出现目标操作；否则即使文件结果正确，也不能算协议覆盖达标。
5. **shell 可移植**：验证命令不使用 process substitution；需要比较 HEAD 内容时使用 POSIX-safe 管道或 `cmp`。

### 3.4 Controlled Benchmark Suite 策略

loamlog、release-hub、pi-proof-forge 都是正在推进的真实项目，直接把 live main 作为严格 benchmark 基线会把项目演进误判为工具质量波动。因此 Phase 2 严格退出采用 **专用 benchmark 分支 + 固定提交**：

| 项目 | benchmark 分支 | fixture 基线 |
|------|----------------|--------------|
| loamlog | `dsh-benchmark/loamlog-phase2` | fixture `benchmarkRef.commit` 指向该分支上的固定 SHA |
| pi-proof-forge | `dsh-benchmark/pi-phase2` | fixture `benchmarkRef.commit` 指向该分支上的固定 SHA |
| release-hub | `dsh-benchmark/release-hub-phase2` | fixture `benchmarkRef.commit` 指向该分支上的固定 SHA |

执行规则：

1. fixture 可声明 `benchmarkRef.repo`、`benchmarkRef.branch`、`benchmarkRef.commit`。runner 优先从 `commit` 创建 `dsh-bench-<fixture-id>` 临时分支；没有 commit 时退回 branch；再没有才退回默认分支。
2. fixture 必须声明 `preflightFiles` 覆盖设计依赖的 tracked 文件。runner 在基线签出后执行 `git ls-files --error-unmatch`；缺失则 fixture 失败，不能进入模型执行。
3. fixture 必须声明 `designGoal` 与 `verificationGoal`，把“测试什么能力”和“用什么物理证据验收”写进 YAML，而不是只藏在 spec 文档里。
4. live main 可作为非阻塞 canary：定期跑同一批 fixture 对比漂移，但不能用于 Phase 2 退出判定。

### 3.5 fixture 数量预算

| 操作 | 单一 | 复合 | 备注 |
|------|------|------|------|
| SEARCH_REPLACE | 0 新建 | 2 标注调整 + rh 混合复合 | 基于任务局部替换语义，不基于历史运行结果 |
| INSERT | 1 新建 | 2 复合 | 其中 1 个来自 rh 混合 fixture |
| DELETE | 1 新建 | 2 复合 | 其中 1 个来自 rh 混合 cleanup |
| RENAME | 1 新建 | 2 复合 | 其中 1 个来自 rh 混合 rename |
| **rh Java+Vue 混合** | — | 3 新建（按 §3.3 计为 3 pair） | 每对必须 Java + Vue 双侧覆盖（双侧单 fixture 或单侧成对 fixture，二选一） |

设计层 yaml 总数：1（INSERT 单一）+ 1（DELETE 单一）+ 1（RENAME 单一）+ 2（非 rh 复合）+ 3（rh Java+Vue 混合）= **8 个 yaml**。

**实施层 yaml 总数（v0.6 回补）**：commit `f97aae3` 按 §3.3 (b) 把 3 个 rh 混合 fixture 拆为 3 pair × 2 单侧 = 6 个 yaml；其它 5 个保持。实施总新建 yaml：5 + 6 = **11 个**。

调整标注：**3 个 fixture** (`pi-docs-check-tools`, `loam-bugfix-cli-error-handling`, `pi-test-error-handler`)。

新 fixture 池规模：**设计** 13 + 8 = 21；**实施** 13 + 11 = **24 个 fixture**（pair 按 §3.3 计为 3，总数仍满足 21 设计语义）。

## 4. Fixture 详细设计

### 4.1 标注调整（不新建）

#### F1: `loam-bugfix-cli-error-handling.yaml` 标注扩展

- **设计目标**: 验证多文件小范围错误处理修复能用 SEARCH_REPLACE 精准替换异常处理分支
- **验证目标**: 不变
- **标注变化**: `[PATCH]` → `[PATCH, SEARCH_REPLACE]`
- **自然触发理由**: 该任务修改 3 个 CLI 文件中现有错误处理分支，每处都是局部替换而非新增文件或整文件重写；模型需要先 `read_file` 复制原始分支，再用 SEARCH/REPLACE 替换。历史实测只能作为佐证，不能作为标注依据

#### F2: `pi-test-error-handler.yaml` 标注扩展

- **设计目标**: 单文件测试补强，模型在小范围添加测试方法时偏好 SEARCH_REPLACE
- **验证目标**: 目标测试文件中新增两个错误类型测试，且 `python3 -m pytest tests/unit/domain/test_error_handler.py -v` 通过
- **标注变化**: `[PATCH]` → `[PATCH, SEARCH_REPLACE]`
- **自然触发理由**: 该任务只在现有 `ErrorHandlerTests` 类中插入/替换少量测试方法和 import，SEARCH_REPLACE 能以类定义或现有测试方法为锚点做小范围变更

#### F3: `pi-docs-check-tools.yaml` 标注扩展

- **设计目标**: README 在指定章节后追加新工具说明
- **标注变化**: `[PATCH]` → `[PATCH, INSERT]`
- **自然触发理由**: 任务明确要求在 `tools/README.md` 的 `"CI 校验"` 章节之前新增章节；这是 INSERT 的天然场景，锚点稳定且比整段 diff 更经济

### 4.2 INSERT 单一目标 fixture

#### F4: `loam-docs-readme-distill-observability`（新建）

- **设计目标**: 验证 INSERT 在大型 tracked markdown 文件中基于稳定标题插入新章节
- **真实前置**: loamlog `README.md` 已 tracked，约 432 行，含 `## Architecture` 与 `## Current Direction`
- **任务**: 在 `README.md` 的 `## Architecture` 章节之后、`## Current Direction` 之前插入 `## Distill Observability` 章节，说明 distill DAG、state KV、evidence 三类观测点
- **预期文件**: `README.md`
- **验证命令**:
  - `grep -q "^## Distill Observability" README.md`
  - `awk '/^## Architecture/{seen=1} seen && /^## Distill Observability/{found=1} /^## Current Direction/{exit found ? 0 : 1}' README.md`
- **预期协议操作**: `[INSERT]`
- **自然触发理由**: 大文件中两个稳定 heading 之间插入完整章节，INSERT 只需要 heading anchor；PATCH 需要行号和大段上下文，不如 INSERT 直接

### 4.3 DELETE 单一目标 fixture

#### F5: `pi-clean-duplicate-matching-report`（新建）

- **设计目标**: 验证 DELETE 能物理移除一个 tracked、独立、无需保留的生成样例文件
- **真实前置**: pi-proof-forge 中 `matching_reports/mr-20260227235900.yaml` 已 tracked，属于历史 placeholder matching report；不被 Python import
- **任务**: 清理过期 placeholder matching report `matching_reports/mr-20260227235900.yaml`，只保留较新的样例报告
- **预期文件**: `matching_reports/mr-20260227235900.yaml`（不应存在）
- **验证命令**:
  - `! test -f matching_reports/mr-20260227235900.yaml`
  - `python3 -m pytest tests/ -q`（确保删除未破坏其它）
- **预期协议操作**: `[DELETE]`
- **自然触发理由**:
  - 任务语义即清理一个完整文件
  - 验证命令 `! test -f` 强制文件物理不存在，PATCH 清空会失败 → repair 阶段会换 DELETE
  - 文件内容本身不需要迁移，DELETE 是唯一自然的最小变更

### 4.4 RENAME 单一目标 fixture

#### F6: `loam-refactor-rename-distill-state`（新建）

- **设计目标**: 验证 RENAME 操作在大文件场景下的 token 经济性优势驱动
- **真实前置**: loamlog `packages/distill/src/state.ts` 已 tracked，约 228 行；`engine.ts`、`index.ts`、多个测试文件引用 `./state.js`
- **任务**: 将 `packages/distill/src/state.ts` 重命名为 `packages/distill/src/distill-state.ts`，内容不变，并更新所有 import/export 路径
- **预期文件**:
  - `packages/distill/src/distill-state.ts`（新位置，内容与原文件完全一致）
  - 若干 import 文件（更新引用）
- **验证命令**:
  - `test -f packages/distill/src/distill-state.ts`
  - `! test -f packages/distill/src/state.ts`
  - `git show HEAD:packages/distill/src/state.ts | cmp - packages/distill/src/distill-state.ts`
  - `pnpm typecheck`（import 路径正确）
- **预期协议操作**: `[RENAME, SEARCH_REPLACE]`（重命名 + 改 import）
- **自然触发理由**:
  - 任务语义即「重命名」，且明确「内容不变」
  - 文件约 228 行：CREATE+DELETE 需要重写全文，RENAME 只需 self-closing 操作 —— 经济性悬殊
  - 即使 fs 验证不能区分两种实现，actualProtocolOps 的标注差异让我们能验证模型是否真选了 RENAME（这是协议覆盖率统计的目的）

### 4.5 复合型 fixture（DELETE/RENAME 各补 1 个非 rh 的）

#### F7: `pi-docs-prune-stale-report-reference`（新建，复合型 DELETE）

- **设计目标**: 验证真实 cleanup 任务中的「删除旧产物 + 更新文档引用」组合
- **真实前置**: pi-proof-forge `matching_reports/mr-20260228000000.yaml` 和 README/tools README 均为 tracked 文件；README 多处引用 `tools/sample_raw.txt`
- **任务**: 删除过期 matching report `matching_reports/mr-20260228000000.yaml`，并在 `README.md` 的 pipeline 示例后补一句说明：示例输入仍使用 `tools/sample_raw.txt`，matching report 不再随仓库保存为固定样例
- **预期文件**: `matching_reports/mr-20260228000000.yaml` 不存在，`README.md` 被局部更新
- **验证命令**:
  - `! test -f matching_reports/mr-20260228000000.yaml`
  - `grep -q "matching report 不再随仓库保存为固定样例" README.md`
  - `python3 -m pytest tests/`
- **预期协议操作**: `[DELETE, INSERT]`
- **自然触发理由**:
  - 删除旧产物用 DELETE；在 README 现有示例附近追加说明用 INSERT 更自然
  - 这是 cleanup + 文档同步，不是单纯为了凑 DELETE

#### F8: `loam-refactor-reorganize-tests`（新建，复合型 RENAME）

- **设计目标**: 验证真实测试文件命名整理中的 RENAME
- **真实前置**: loamlog `packages/distill/src/dag-runner.test.ts` 已 tracked，约 370 行，根脚本通过 `find ... -name '*.test.ts'` 发现测试
- **任务**: 将 `packages/distill/src/dag-runner.test.ts` 重命名为 `packages/distill/src/distill-dag-runner.test.ts`，内容不变
- **预期文件**: 新测试文件存在，旧测试文件不存在
- **验证命令**:
  - `test -f packages/distill/src/distill-dag-runner.test.ts`
  - `! test -f packages/distill/src/dag-runner.test.ts`
  - `git show HEAD:packages/distill/src/dag-runner.test.ts | cmp - packages/distill/src/distill-dag-runner.test.ts`
  - `pnpm test`
- **预期协议操作**: `[RENAME]`
- **自然触发理由**:
  - 任务语义明确为重命名且内容不变；370 行测试文件用 RENAME 比 CREATE+DELETE 经济得多
  - 继续保持 `.test.ts` 后缀，避免测试发现机制变化成为噪音

### 4.6 rh Java+Vue 混合 fixture（3 个 pair，承担多语言条件）

> 设计层描述 3 个**双侧单 fixture** (F9/F10/F11)。实施层 (commit `f97aae3`) 按 §3.3 (b) 拆为 3 个 **单侧成对 fixture**：
>   - F9 `rh-mixed-dashboard-generated-at` → `-backend.yaml` + `-frontend.yaml`
>   - F10 `rh-mixed-remove-starter-ping-demo` → `-backend.yaml` + `-frontend.yaml`
>   - F11 `rh-mixed-rename-common-dialog-and-settings-controller` → `rh-mixed-rename-entity-dialog-frontend.yaml` + `rh-mixed-rename-settings-controller-backend.yaml`
>
> 实施 yaml 共 6 个，但按 §3.3 (b) 计数规则共 3 个 pair，等价于 3 个混合 fixture。设计目标和验证目标保持不变；只是同一业务场景在 yaml 层被拆解为 backend/frontend 两份独立任务。


#### F9: `rh-mixed-dashboard-generated-at`（新建）

- **设计目标**: 验证现有 dashboard API 的后端 DTO 扩展 + 前端展示联动
- **真实前置**: 后端已有 `DashboardController` / `DashboardAppService`；前端已有 `frontend/src/api/dashboardApi.ts` 与 `frontend/src/views/dashboard/Dashboard.vue`
- **任务**: Dashboard stats 增加 `generatedAt` 字段（ISO 字符串），后端响应中填充当前时间；前端类型和 Dashboard 页面显示“更新时间”
- **预期文件**:
  - `backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/dashboard/DashboardController.java`
  - `frontend/src/api/dashboardApi.ts`
  - `frontend/src/views/dashboard/Dashboard.vue`
- **验证命令**:
  - `grep -q "generatedAt" backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/dashboard/DashboardController.java`
  - `grep -q "generatedAt" frontend/src/api/dashboardApi.ts`
  - `grep -q "generatedAt" frontend/src/views/dashboard/Dashboard.vue`
  - `cd backend && mvn test -pl releasehub-interfaces -am -q`
  - `cd frontend && pnpm typecheck`
- **预期协议操作**: `[PATCH, INSERT, SEARCH_REPLACE]`
- **自然触发理由**:
  - 后端 record 字段和前端 TypeScript interface 是小范围替换/追加
  - Dashboard 模板在已有 stats cards 附近插入更新时间 UI，INSERT 是自然选择

#### F10: `rh-mixed-remove-starter-ping-demo`（新建）

- **设计目标**: 验证 Java+Vue cleanup 中的 DELETE 复合操作
- **真实前置**: release-hub 仍有 starter/demo 文件 `frontend/src/components/HelloWorld.vue`、`frontend/src/components/__tests__/HelloWorld.spec.ts` 和 backend `/api/v1/ping` 的 `PingController.java` / `PingApiTest.java`
- **任务**: 移除 starter/demo 资产：删除 HelloWorld 组件及其测试，删除 PingController 及对应 PingApiTest；保持应用业务功能和构建通过
- **预期文件**:
  - `frontend/src/components/HelloWorld.vue` 不存在
  - `frontend/src/components/__tests__/HelloWorld.spec.ts` 不存在
  - `backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/rest/PingController.java` 不存在
  - `backend/releasehub-bootstrap/src/test/java/io/releasehub/bootstrap/api/PingApiTest.java` 不存在
- **验证命令**:
  - `! test -f frontend/src/components/HelloWorld.vue`
  - `! test -f frontend/src/components/__tests__/HelloWorld.spec.ts`
  - `! test -f backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/rest/PingController.java`
  - `! test -f backend/releasehub-bootstrap/src/test/java/io/releasehub/bootstrap/api/PingApiTest.java`
  - `cd backend && mvn test -pl releasehub-interfaces,releasehub-bootstrap -am -q`
  - `cd frontend && pnpm typecheck`
- **预期协议操作**: `[DELETE]`
- **自然触发理由**:
  - 任务语义是删除完整 demo/starter 文件
  - 验证命令要求文件不存在，PATCH 清空无法通过
  - 同时覆盖后端 Java 文件和前端 Vue 文件，满足 rh 混合定义

#### F11: `rh-mixed-rename-common-dialog-and-settings-controller`（新建）

- **设计目标**: 验证 Java+Vue 双侧命名整理中的 RENAME + 引用更新
- **真实前置**: 前端 `frontend/src/components/common/EntityDialog.vue` 已 tracked，约 101 行，被多个 Vue 视图 import；后端 `SettingsController.java` 已 tracked，被 Spring classpath 扫描
- **任务**: 将通用弹窗组件 `EntityDialog.vue` 重命名为 `CrudEntityDialog.vue` 并更新所有前端 import；将后端 `SettingsController.java` 重命名为 `SystemSettingsController.java`，保持 request mapping 不变
- **预期文件**:
  - `frontend/src/components/common/CrudEntityDialog.vue`
  - `backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/settings/SystemSettingsController.java`
  - 旧文件不存在，引用更新
- **验证命令**:
  - `test -f frontend/src/components/common/CrudEntityDialog.vue`
  - `! test -f frontend/src/components/common/EntityDialog.vue`
  - `test -f backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/settings/SystemSettingsController.java`
  - `! test -f backend/releasehub-interfaces/src/main/java/io/releasehub/interfaces/api/settings/SettingsController.java`
  - `grep -R "CrudEntityDialog" frontend/src/views`
  - `cd backend && mvn test -pl releasehub-interfaces -am -q`
  - `cd frontend && pnpm typecheck`
- **预期协议操作**: `[RENAME, SEARCH_REPLACE]`
- **自然触发理由**:
  - 两侧任务语义都是重命名且内容主体不变
  - Vue import 和 Java class name 需要 SEARCH_REPLACE 更新引用/声明
  - RENAME 比 CREATE+DELETE 更经济，也能直接计入协议覆盖

## 5. BLUEPRINT 文本修正

修改 `BLUEPRINT.md` L170：

```diff
-- [ ] **多语言** — Python（pi-proof-forge）+ TypeScript（dsh/loamlog/release-hub）各有 ≥3 个 fixture 执行通过。Java 为 Phase 3 目标。数据来源：benchmark 报告 Per-Task Detail
+- [ ] **多语言** — Python（pi-proof-forge）≥3 + TypeScript（loamlog）≥3 + Java+Vue 混合（release-hub 后端 Java + 前端 Vue）≥3。数据来源：benchmark 报告 Per-Task Detail
```

同时同步 ledger §1 的多语言一行。

## 6. 实施顺序

1. **F1-F3 标注调整**（3 个 yaml 局部 edit；补充自然触发理由，避免后验贴标）
2. **F4 INSERT 单一**（1 个新 yaml；使用 loamlog tracked `README.md`）
3. **F5 DELETE 单一**（1 个新 yaml；使用 pi tracked `matching_reports/mr-20260227235900.yaml`）
4. **F6 RENAME 单一**（1 个新 yaml；使用 loamlog tracked `state.ts`）
5. **F7/F8 非 rh 复合**（2 个新 yaml；使用 pi README/report、loam tracked test 文件）
6. **F9-F11 rh Java+Vue 混合**（3 个新 yaml；全部基于 release-hub tracked Java/Vue 文件）
7. **BLUEPRINT 文本修正 + ledger §1 同步**
8. **回跑 benchmark**（建议先跑 dsh-bench 仓库预演 1-2 个新 fixture 验证设计正确，再全量）
9. **更新 ledger §1 协议覆盖与多语言勾选 + 归档新 report**

## 7. 验收标准

| 项 | 验证方式 |
|----|---------|
| 协议覆盖标注 | 新 benchmark report 协议操作覆盖表 6 行，每行「预期 ≥3」 |
| 协议覆盖实测 | 同表「实际触发 ≥1」全部满足，特别是 DELETE/RENAME 至少各 1 fixture 实测触发 |
| TS 多语言 | benchmark report 中 loam- 前缀 ≥3 fixture completed=true（已满足） |
| Java+Vue 多语言 | benchmark report 中 rh- 前缀新增 3 个混合 fixture completed=true，且 frontend/* 文件被实际修改 |
| rh 混合定义 | F9-F11 每个 fixture 的 `filesChanged` 同时包含 `backend/**/*.java` 与 `frontend/**/*.{ts,vue}` |
| 不回归 | 现有 13 fixture 完成率仍 ≥85%（允许 1-2 fixture 抖动） |
| Fixture 设计正确性 | 每个新 fixture 跑通 ≥1 次（不触发 fixture 设计 bug 类失败） |
| Benchmark 隔离 | 每个 fixture run 前后 `git status --short --untracked-files=all` 不含上一轮产物；CREATE/DELETE/RENAME 不依赖脏工作树 |
| 协议目标实测 | F5 actualProtocolOps 含 DELETE；F6 actualProtocolOps 含 RENAME；F9-F11 分别贡献 INSERT/DELETE/RENAME 或 SEARCH_REPLACE |

## 8. 回归风险

| 风险 | 概率 | 缓解 |
|------|------|------|
| RENAME 单一/复合 fixture 模型仍走 CREATE+DELETE | 中 | F6/F8/F11 都要求内容不变或主体不变；验收必须检查 actualProtocolOps，未触发 RENAME 不算协议覆盖 |
| DELETE 模型用 PATCH 清空 | 低 | 验证命令 `! test -f` 强制走 DELETE，repair 阶段会重试 |
| 目标 repo 文件结构漂移 | 中 | 每次实施前跑 preflight：`git ls-files <path>`，不存在则不能写 YAML |
| live 项目持续演进导致 benchmark 不稳定 | 高 | Phase 2 退出只认 `benchmarkRef.commit` 固定基线；live main 只做 canary，不做 gate |
| Vue fixture 因 vitest/vite 启动慢导致 benchmark 超时 | 低 | rh-frontend fixture 验证只 typecheck + 文件存在性，不跑 vitest；如需测试可后续追加 |
| 任务 prompt 仍间接暗示协议操作 | 中 | 评审 prompt 文本：仅描述「做什么」（删除/重命名/插入章节），不写「使用 X 块」 |
| benchmark untracked 产物污染 fixture | 高 | 工具层使用 `git reset --hard` + `git clean -fd`；新增单元测试覆盖 stale untracked 文件清理 |

## 9. 长期跟踪事项

本 spec 落地完成后登记到 `docs/project-ledger.md` §8：

| type | id | trigger |
|------|----|---------|
| evidence | rename-natural-trigger-rate | 跑 ≥3 次 benchmark 后统计 RENAME 实测触发率（target ≥1/3 fixture） |
| deferred | rh-frontend-vitest-coverage | 当前 rh frontend fixture 验证仅 typecheck，未跑 vitest，待后续补齐 |
| bug | tooluse-protocol-name-collision | 模型把 CREATE/PATCH 误当 tool 名调用 tool_use API（来自 rh-test-dashboard-version 诊断），影响协议块落盘成功率，需 prompt 重设计 |

## 10. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-06 | v0.1 | 初稿 |
| 2026-05-06 | v0.2 | 移除 dsh 镜像；DELETE/RENAME 改为任务语义+token 经济性自然驱动；引入「单一+复合」分层；每 fixture 显式标设计目标/验证目标/触发理由；BLUEPRINT 修正影响补全 |
| 2026-05-06 | v0.3 | 补充两枚失败 fixture 根因；确认 benchmark untracked 清理缺失为工具实现根因；修正协议覆盖为 2/6、rh 混合 fixture 为 0/3 |
| 2026-05-06 | v0.4 | 吸收 fixture 设计 review：runner 支持多验证命令；rh 3 个 fixture 全部改为 Java+Vue 混合；所有新 fixture 改用真实 tracked 文件；验证命令去掉 process substitution |
| 2026-05-06 | v0.5 | 采用专用 benchmark 分支 + 固定 commit 作为 Phase 2 严格基线；新增 fixture 元数据 `benchmarkRef` / `preflightFiles` / `designGoal` / `verificationGoal` |
| 2026-05-14 | v0.6 | doc-lag 回补：§3.3 第 2 条扩展 "rh 混合 fixture 定义" 接纳实施现状的 "单侧成对 fixture"（(b) 选项 + 计数规则）；§3.5 fixture 数量预算补"实施层 24 个 yaml = 3 pair 计为 3"；§4.6 标题与说明对齐 commit `f97aae3` 实施现状（3 个 pair × 2 单侧 = 6 yaml）。**不改 fixture 实现**，只让文档与代码现状对齐。本次回补由 PIE Phase E benchmark 审计触发（fixture 拆分发现于 N=3 实证策略审视），ledger §8 加 debt `phase2-exit-fixture-doc-lag` 跟踪此次治理修正。 |
