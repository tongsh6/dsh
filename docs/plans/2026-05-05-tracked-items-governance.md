# 长期跟踪事项治理 实施计划

> 状态: draft | 日期: 2026-05-05 | Spec: `docs/specs/2026-05-05-tracked-items-governance.md`
>
> 把治理体系拆为 G1–G4 四个 Phase，G1+G2 阻塞 patch-loop 进入 plan/task；G3+G4 可与后续工作并行。

## Phase G1: 文档基础（CONSTITUTION + BLUEPRINT + ledger §8）

### Step G1.1: CONSTITUTION 加原则 8

**文件**: `CONSTITUTION.md`（修改）

- 在第三章「技术原则」之后、第四章「修订程序」之前插入「原则 8：长期跟踪事项可追溯」全文
- 原则文本来自 spec §3.3
- 修订历史表加一行 `2026-05-05 | v1.1 | 加原则 8`
- 顶部「最后修订」日期更新为 2026-05-05

### Step G1.2: ledger §8 章节 + 迁移本期已知条目

**文件**: `docs/project-ledger.md`（修改）

- 文件末尾追加 `## 8. 长期跟踪事项` 章节
- 表头与字段顺序按 spec §4.1
- 写入本期 ≥4 条迁移条目（与 spec §3.4 示例同）：
  - `deferred patchloop-repair-upgrade` —— repair-loop 升级 v0.4
  - `bug exec-shell-redirect` —— exec_shell 把 `2>&1` 误判为危险
  - `debt tool-args-coerce` —— tool args 用 string-coerce 临时方案
  - `evidence dsh-vs-oc-resample` —— DSH vs OC 仅 5 fixture 样本不足
  - `debt history-spec-backfill` —— 历史 spec 未按原则 8 回填跟踪事项（与 spec §3.8 + 用户决策对应）
  - `deferred bug-D-resolution` —— exec_shell allow-list 调整（与 patch-loop 协同时启动）
  - `bug B-multi-file-output` —— patch loop 上线前的临时记录，patch-loop 实施时转 resolved 或 cancelled

### Step G1.3: BLUEPRINT 每 Phase 退出 checkbox

**文件**: `BLUEPRINT.md`（修改）

- 在「当前阶段（Phase 2）的退出条件」表中追加一条 checkbox（spec §3.5 文本）
- 在 §3 阶段概览之后插入「Phase 退出复审协议」小节（说明 checkbox 的执行流程：遍历 → 决策 → 归档到 reports/phase-X-exit-review.md）
- 修订历史表加一行

### Step G1.4: G1 全量自检

```bash
grep -c "原则 8" CONSTITUTION.md           # ≥ 2 (标题 + 引用)
grep -c "## 8. 长期跟踪事项" docs/project-ledger.md   # = 1
grep -c "Phase 退出复审" BLUEPRINT.md        # ≥ 1
```

## Phase G2: spec 模板 + 回填 patch-loop spec

### Step G2.1: 创建 spec 模板

**文件**: `docs/specs/_template.md`（新建）

- 含标准结构：状态 / 1 问题定义 / 2 目标与非目标 / 3 设计 / 4 数据模型 / 5 成功标准 / 6 风险 / 7 实施策略 / 8 不在本 spec 范围 / **9 本 spec 引发的跟踪事项**（新章节）/ 10 修订历史
- §9 为表格占位（按 spec §3.6 格式，至少 type / id / trigger / priority / notes 列）
- 顶部 `> 状态: draft` 等模板占位符

### Step G2.2: patch-loop spec 回填 §「跟踪事项」章节

**文件**: `docs/specs/2026-05-05-patch-loop-architecture.md`（修改）

- 把 §2.2 非目标 + §6 风险 + §8 不在本 spec 范围中**会延期跟进**的条目抽出
- 在文件末尾、§9 修订历史之前插入新章节「§9 本 spec 引发的跟踪事项」（修订历史顺延为 §10）
- 条目示例（候选，最终以 spec 实际内容为准）：
  - `deferred repair-loop-v04` —— v0.5 把 repair-loop 切到 v0.4 协议
  - `deferred patch-loop-rollback` —— 事务 rollback / stash-apply（v0.5）
  - `evidence patch-loop-vs-batch-comparison` —— v0.4 上线后跑 ≥3 fixture × 3 次对比 v0.3
  - `deferred patch-loop-protocol-negotiation` —— spec §2.2 第 4 项的协议自动协商
  - `deferred phase4-agent-loop` —— BLUEPRINT Phase 4 完整 Agent Loop

### Step G2.3: 把 G2.2 条目同步登记到 ledger §8

**文件**: `docs/project-ledger.md`（修改）

- 把 G2.2 抽出的条目加到 §8 表格
- 每条 `source` 字段填 `spec:docs/specs/2026-05-05-patch-loop-architecture.md`

### Step G2.4: G2 全量自检

```bash
grep -c "## .* 本 spec 引发的跟踪事项" docs/specs/_template.md           # = 1
grep -c "## .* 本 spec 引发的跟踪事项" docs/specs/2026-05-05-patch-loop-architecture.md   # = 1
# 数 patch-loop spec §「跟踪事项」中条目数 vs ledger §8 中 source=patch-loop 的条目数
# 二者应相等
```

## Phase G3: CI 脚本

### Step G3.1: scripts/check-tracked-items.ts 实现

**文件**: `scripts/check-tracked-items.ts`（新建）

按 spec §3.7 实现 5 项校验：

1. 解析 `docs/specs/*.md` 中创建日期 ≥ 2026-05-05 的 spec 的「跟踪事项」章节
2. 解析 `docs/reports/**/analysis.md` 的「跟踪事项」章节（如存在）
3. 解析 `docs/project-ledger.md` §8 表格
4. 比对：spec/report 中条目存在但 ledger 缺 → exit 1
5. 比对：ledger 条目的 `source` 路径不存在 → exit 1
6. ledger 条目 `status=waiting` 且 `last_reviewed` 超 90 天 → console.warn（不阻断）
7. 表格列数 / 字段格式不对 → exit 1

输出格式：
- 默认：人类可读 markdown 报告 + 退出码
- `--json` flag：机器可读 JSON

### Step G3.2: 单元测试

**文件**: `scripts/check-tracked-items.test.ts`（新建）

用 fixture 目录测试 ≥6 个用例：

- happy path（spec 与 ledger 一致 → exit 0）
- spec 中条目缺登记 → exit 1
- ledger 中 source 路径不存在 → exit 1
- ledger 表格字段缺失 → exit 1
- last_reviewed 超 90 天 → exit 0 with warn
- 历史 spec（创建日期 < 2026-05-05）跳过扫描

测试用 `node:test` + `node:assert/strict`，与项目其它测试一致。

### Step G3.3: G3 自检

```bash
./packages/core/node_modules/.bin/tsx --test scripts/check-tracked-items.test.ts   # all pass
./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts                 # exit 0
```

## Phase G4: CI 集成 + 红绿验证

### Step G4.1: 接入 scan workflow

**文件**: `.github/workflows/scan.yml`（修改）

- 在现有 lint/typecheck/test 步骤之后追加一步：
  ```yaml
  - name: Check tracked items
    run: ./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts
  ```
- 与现有步骤共用同一 job

### Step G4.2: 故意制造不一致 → 验证 CI 红

**操作**（手动验证，不提交）：

1. 临时在 ledger §8 删一行
2. 本地跑 `./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts`
3. 确认 exit 1 + 报告指出哪条 spec 条目无对应 ledger 行
4. 恢复 ledger
5. 再跑确认 exit 0

### Step G4.3: 文档化 CI 行为

**文件**: `docs/project-ledger.md`（修改）

- 在 §7 关键证据索引追加：「`scripts/check-tracked-items.ts` —— 跟踪事项治理 CI 脚本，CONSTITUTION 原则 8 兜底」

## 文件变更汇总

| 文件 | 操作 | Phase | 预计行数 |
|------|------|-------|---------|
| `CONSTITUTION.md` | 修改 | G1.1 | +25 |
| `docs/project-ledger.md` | 修改 | G1.2 + G2.3 + G4.3 | +20 |
| `BLUEPRINT.md` | 修改 | G1.3 | +15 |
| `docs/specs/_template.md` | 新建 | G2.1 | ~80 |
| `docs/specs/2026-05-05-patch-loop-architecture.md` | 修改 | G2.2 | +15 |
| `scripts/check-tracked-items.ts` | 新建 | G3.1 | ~180 |
| `scripts/check-tracked-items.test.ts` | 新建 | G3.2 | ~200 |
| `.github/workflows/scan.yml` | 修改 | G4.1 | +3 |
| **总计** |  |  | **~538** |

## 验证方式

```bash
# G1+G2 自检
grep -c "原则 8" CONSTITUTION.md
grep -c "## 8. 长期跟踪事项" docs/project-ledger.md
grep -c "Phase 退出复审" BLUEPRINT.md

# G3 自检
./packages/core/node_modules/.bin/tsx --test scripts/check-tracked-items.test.ts
./packages/core/node_modules/.bin/tsx scripts/check-tracked-items.ts

# G4 自检（手动红绿验证后）
pnpm run scan   # CI 全套门禁通过
```

## 依赖关系

```
G1 (文档基础) ──┐
                ├─→ G2 (spec 模板 + 回填) ──→ patch-loop plan/task
                │                                可启动
                ├─→ G3 (CI 脚本) ──→ G4 (CI 集成)
```

- G1 / G2 是 patch-loop plan/task 的硬阻塞
- G3 / G4 与 patch-loop 实施可并行（不阻塞）

## 预计风险

| 风险 | 概率 | 缓解 |
|------|------|------|
| markdown 表格 parser 写复杂了 | 中 | 用最简正则 + tab/pipe 分隔；不依赖 markdown AST 库 |
| spec 「跟踪事项」章节标题不一致（带 § 还是不带） | 中 | spec §3.6 + 模板统一为 `## §X 本 spec 引发的跟踪事项`；CI 用宽松正则匹配 `本 spec 引发的跟踪事项` |
| 历史 spec 误触发扫描 | 低 | spec 文件名前缀日期 < 2026-05-05 → 跳过 |
| ledger §8 行格式错位（人为编辑） | 中 | CI 校验严格 8 列；表格末尾留 trailing pipe；提供 spec §「跟踪事项」→ ledger 行的快捷模板 |

## 不在本 plan 范围

- `docs/specs/_template.md` 之外的其它模板（task / plan）
- 历史 spec 的回填（已记 `debt history-spec-backfill` 跟踪事项）
- 跟踪事项 dashboard / 可视化（spec §7.3）
