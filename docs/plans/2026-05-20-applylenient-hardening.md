# applyPatchLenient 落点核验 + 窗口扩展(Bug B 修复)PLAN

> 状态: draft | 日期: 2026-05-20
>
> **设计依据**:见 ledger §8 即将新增的 `patchloop-unified-diff-applylenient-corrupts`(bug,P0)。
> `applyPatchLenient`(`patch-parser.ts:1227-1310`)在严格层 `diff.applyPatch` 抛异常时作为
> 兜底,但当前实现违反补丁工具铁律——**拼不准就该失败,绝不产出无法核验的文件**。
> 实测(2026-05-20):**喂 r8 真实 patch 给当前实现,产出与基准实跑落盘的损坏
> `openai-compatible.ts` 逐字节相等(`=== true`)**;埋点版数字坐实落点错位 18 行、
> 最高匹配 1/9、`splice(70, 删9 插7)` 无条件删源 71-79 行真实代码。
>
> **复现器在手**:`/tmp/bugb-repro/repro.mjs`(端到端)、`/tmp/bugb-repro/which-layer.mjs`
> (严格层抛异常确认)、埋点版 instrumented harness(数字坐实 5 个缺陷)。
>
> **关联**:CONSTITUTION 原则 2/3/5 | ledger §8 `patchloop-search-replace-risk-realized`
> (覆盖 SEARCH/REPLACE 分支,本 plan 是其姊妹议题:unified-diff `applyPatchLenient` 分支)
> | route Y(已实施)解耦——salvage 还原 `<PATCH>` 块后,内层 diff 仍可能撞 Bug B,
> 两者各管一段

## 1. 文件映射

| 文件 | 类型 | 改动 |
|------|------|------|
| `packages/core/src/patch-parser.ts:1227-1310` | 修改 | `applyPatchLenient`:落点核验 + 窗口扩展 + 打分 off-by-one 修复 |
| `packages/core/src/patch-parser.test.ts` | 修改 | 新增 ≥6 例 unified-diff `applyPatchLenient` 单测,含 r8 byte-level 回归(without fix 产出 Frankenstein;with fix `return null` 让 applyPatch 报 failed) |
| `packages/core/src/__fixtures__/bugb-r8-openai-compatible.ts.txt`(暂定) | 新建 | r8 hunk 标本(原始文件 + r8 patch text + 期望:apply 失败) |
| `docs/project-ledger.md` §8 | 修改 | 新增 `bug | patchloop-unified-diff-applylenient-corrupts`;本 plan 完成后 status → resolved |

**不动**:`applyPatch` 主函数(严格层调用)、`splitPatchByFile`、`parseHunks`、其他 apply 路径(SEARCH/REPLACE / CREATE / INSERT — 各自分支独立)。

## 2. 分阶段任务

### Phase 1:核心修复 —— 落点核验 + 阈值收紧(P0)

**目标:从"拼不准也 splice"变成"拼不准就 return null"**。

- [ ] 1.1 把 `bestScore === 0 ? null : ...` 改为 `bestScore < ctxLineCount ? null : ...`:
  - `ctxLineCount = (hunk.lines.filter(l => l.startsWith(" ") || l.startsWith("-"))).length`
  - 必须**全部非 + 行精确匹配** bestMatch 才放行
- [ ] 1.2 加 splice 前删除核验:
  - 对 `bestMatch` 处即将删除的 `toRemove` 行,逐行确认等于 hunk 对应的非 + 行
  - 不等 → `return null`
- [ ] 1.3 修打分 off-by-one(`:1286`):
  - `sourceLines[candidate + li]` 用了 patch 下标 `li`,遇 `+` 行后源对齐漂移
  - 改为维护独立 `srcLineOffset`,只在非 + 行递增
- [ ] 1.4 单测 byte-level:
  - r8 真实 hunk + `5e1d3ee` 原始 `openai-compatible.ts` → 当前实现产出 Frankenstein,fix 后必须 `return null`(让 `applyPatch` 报 failed,而非写入)
  - r8 hunk 1(import,行号准):fix 后必须**成功**(不引入回归)
  - 行号准 + 上下文 100% 匹配:成功
  - 行号近(±2)+ 上下文 100% 匹配:成功
  - 行号错(>5)+ 上下文 100% 匹配:**失败**(窗口够不着)— 留 Phase 2 解决
  - 行号准 + 上下文部分匹配:**失败**(阈值收紧的体现)
  - 行号准 + 内容删除位置错位:**失败**(删除核验)
- [ ] 1.5 `pnpm --filter "./packages/core" run test` 全绿(含已有测试不退化)

### Phase 2:搜索窗口扩展(P1)

**目标:行号偏差 >5 但上下文完全匹配的合法 patch 也能找到落点**。

- [ ] 2.1 把窗口从 `±5` 扩为**全文件扫**(`for (let c = 0; c < sourceLines.length; c++)`),只接受 `score === ctxLineCount` 的候选
- [ ] 2.2 若全文件出现**多个**完全匹配的候选 → `return null`(歧义,拒绝 apply)
- [ ] 2.3 单测:
  - 行号错 18 行(r8 hunk 2 真实情况)+ 上下文完全匹配 + 源中唯一 → 成功落点
  - 同一上下文在源中出现两次 → `return null`
- [ ] 2.4 性能 sanity:对一个 10K 行文件扫描的耗时;若 >100ms 单 hunk,加 hash-based 索引(否则保留朴素扫描)

### Phase 3:apply 后写盘前最终核验(P1)

**目标:即使 splice 落点对,写盘前再算一次"这个 splice 是否真等价于声明的变更"**。

- [ ] 3.1 splice 后用 source `result` 重新模拟正向 diff,验证:
  - 应被删除的源行 = hunk 的 `-` 行集合
  - 应被插入的新行 = hunk 的 `+` 行集合
  - 不通过 → `return null`,**绝不 `writeFileSync`**
- [ ] 3.2 `applyPatch:1216-1218` 的 `writeFileSync` 加守卫:`result` 必须非空、非 null,且通过 §3.1 核验
- [ ] 3.3 单测:构造 splice 看似成功但实际写了错误内容的场景 → 必须被 §3.1 拦下

### Phase 4:文档 + commit + push

- [ ] 4.1 ledger §8 新增 `bug | patchloop-unified-diff-applylenient-corrupts | code:patch-parser.ts | ...`(描述 5 个具体缺陷 + r8 复现器路径);完成后 status → resolved
- [ ] 4.2 ledger §1 加 2026-05-2X 一条:概述修复过程、单测 byte-level 通过、benchmark smoke 数据点
- [ ] 4.3 分组 commit:
  - `fix(core): harden applyPatchLenient against off-target splice and silent corruption` —— Phase 1+2+3 全部代码 + 单测
  - `docs: log Bug B fix and resolve patchloop-unified-diff-applylenient-corrupts` —— Phase 4 docs
- [ ] 4.4 push

## 3. 验证方式

| 层级 | 命令 / 检查 | 验收 |
|------|-------------|------|
| 单测 byte-level | `pnpm --filter "./packages/core" run test` | r8 真实 hunk → 当前 = Frankenstein;fix 后 = `return null`;**至少 6 例 unified-diff applyPatchLenient 用例** 0 失败 |
| 全量 | `pnpm run scan` | lint + typecheck + 全部 package 测试全绿 |
| 跟踪事项 | `tsx scripts/check-tracked-items.ts` | PASS |
| 集成 | `applyPatch(cwd, r8patchText)` 端到端 | 返回 `{success: false, error: "Failed to apply patch to ..."}` 而非 `{success: true}` 配 corrupted 文件 |
| Benchmark smoke(可选) | `--filter=loam-refactor --reps=1`(6 trials,~50min) | 任意 trial 不再出现 r8 类型的 hunk apply 后文件破坏(repair 看到的不再是 Frankenstein) |

## 4. 依赖关系

- 无外部依赖。
- **不依赖** route Y(`dsml-recovery`)—— Bug A 与 Bug B 各管一段:Bug A 把模型发的合法 `<PATCH>` 救回,Bug B 把救回来的 diff 正确应用或拒绝。
- **不依赖** route X spec 的批准 —— 即使将来编辑走原生工具,内层 diff 内容仍要走 `applyPatch` / `applyPatchLenient`。
- 与 ledger §8 `patchloop-search-replace-risk-realized`(SEARCH/REPLACE 分支)并行,**不互替**。

## 5. 不在本计划范围

1. ❌ **`diff` 库严格层的行为改动**:严格层抛异常是正常 OK,本 plan 只改兜底层。
2. ❌ **SEARCH/REPLACE 应用语义**:`patchloop-search-replace-risk-realized` 已覆盖。
3. ❌ **CREATE / INSERT / DELETE / RENAME 应用路径**:各自独立分支,本 plan 不动。
4. ❌ **协议改动 / prompt 改动 / 模型层修复**:Bug B 是 DSH 端纯本地代码 bug,与模型无关。
5. ❌ **完全替换 `applyPatchLenient` 为别的算法**(如 Myers / git apply):重写工程量大,本 plan 是最小修复保证不产 Frankenstein 文件,不追求完美匹配率。

## 6. 风险与限制

1. **阈值收紧会让一些"勉强能拼对"的 patch 也失败**:这正是设计目标。原行为是"拼不准也 splice → 偶尔产 Frankenstein";新行为是"拼不准就 fail → 进入 repair 重试"。fail 是可恢复的,Frankenstein 文件会污染所有后续轮次。
2. **全文件扫描的性能**:对常见源文件(<10K 行)单 hunk 扫描 O(n×ctxLineCount),naïve 实现 < 10ms。大文件(>50K 行 / 罕见)需加索引,Phase 2.4 测后定。
3. **同上下文多匹配的歧义拒绝可能增加 fail 率**:若同一段上下文(如重复的 `}` + 空行)在源中多次出现,新逻辑会 fail。Repair 路径要有能力处理这种 fail(repair 已有重试机制)。
4. **不修 Bug B 不会让 route Y 失效**:两者独立。Bug B 不修也不会引入新问题,只是高频 corruption 持续存在。
5. **不预期 testsPassed 一定显著上升**:Bug B 修复的直接收益是"少了一类灾难性失败模式",但 benchmark 失败原因多元(模型能力、verify 严苛度、fixture 难度等),修了 Bug B 不保证通过率上升,只保证**失败原因不再是 DSH 应用层拼错**。
