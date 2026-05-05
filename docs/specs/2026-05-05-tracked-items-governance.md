# 长期跟踪事项治理（Tracked-Items Governance）

> 状态: draft | 日期: 2026-05-05 | 作者: loong
>
> 目标: 建立项目级「长期跟踪事项」治理机制，覆盖 4 类易遗忘信息（延后事项 / 已知 bug / 技术债 / 待跟进证据），三层防漂移（宪法 / 台账 / CI），让"以后再做"不再依赖记忆。

## 1. 问题定义

### 1.1 现状

DSH 当前已有：
- `CONSTITUTION.md`（最高原则）
- `BLUEPRINT.md`（阶段路线）
- `docs/project-ledger.md`（项目事实台账，CLAUDE.md 引导新会话 AI 必读）
- `docs/specs/`（设计文档）
- `docs/tasks/`（任务卡片，含 backlog 状态）

但**没有任何机制**保证以下信息不被遗忘：

| 信息类型 | 当前散落位置 | 遗忘风险 |
|----------|------------|---------|
| 延后事项（spec 的 non-target / future work） | spec 散文中、`v0.5 再做` 之类注释 | spec 关闭即不可见 |
| 已知 bug（实证发现但本期不修） | benchmark 报告、commit message | 报告归档即遗忘 |
| 技术债（明知不诚实但临时妥协） | 代码注释 / spec 风险表 | 代码 review 后失忆 |
| 待跟进证据（数据/对比/复跑） | 报告 caveat、spec 的"待验证" | 报告关闭即丢失 |

### 1.2 实证触发点（2026-05-05 patch-loop spec 起草）

`docs/specs/2026-05-05-patch-loop-architecture.md` 列了：
- 6 个非目标（§2.2）
- 5 个不在范围（§8）
- 7 个风险与缓解（§6）
- 散文中提到的 v0.5 / Phase 5 / Phase 7 工作

按当前体系，spec 关闭后这些条目**没有任何主动唤起机制**。新会话 AI 即使读了 ledger 也看不到它们。

### 1.3 目标用户

1. 当前会话的人 / AI（避免成为"留下烂摊子"的一方）
2. 未来会话的人 / AI（启动时能完整看到全部跟踪事项）
3. 阶段切换决策者（Phase 退出时主动复审）
4. CI（机器执行层兜底）

## 2. 目标与非目标

### 2.1 目标

1. **统一术语**：「跟踪事项」(tracked item) = 4 类（deferred/bug/debt/evidence）的合集
2. **统一登记入口**：`docs/project-ledger.md` §8「长期跟踪事项」表格
3. **强制约束**：CONSTITUTION 加原则 8，规定登记义务
4. **阶段复审**：BLUEPRINT 每 Phase 退出条件加一条复审 checkbox
5. **机器兜底**：CI 脚本扫描 spec/report 中的标记 vs ledger §8 索引差集
6. **成本极低**：人工登记一条 < 30 秒；CI 脚本 < 200 行

### 2.2 非目标

- ❌ 不做 issue tracker（不替代 GitHub Issues / Linear）
- ❌ 不做优先级自动调度（status 改变仍由人决定）
- ❌ 不做跟踪事项的"历史回溯版本管理"（信任 git history）
- ❌ 不为已废弃 spec 中的事项做迁移（仅约束 spec 完成日期 ≥ 2026-05-05 的）
- ❌ 不做跨仓库跟踪（仅 dsh 仓库内）

## 3. 设计

### 3.1 4 类跟踪事项的统一字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `deferred` \| `bug` \| `debt` \| `evidence` | 类型 |
| `id` | string | 短标识，跨表唯一，如 `patchloop-repair-upgrade` |
| `source` | string | 来源引用：`spec:<path>` / `report:<run_id>` / `code:<file>:<line>` |
| `title` | string | 一句话描述 |
| `trigger` | string | 启动/解决条件（语义随类型微调，见 §3.2） |
| `priority` | `P0`–`P3` | 同 task 优先级 |
| `status` | `waiting` \| `ready` \| `in_progress` \| `resolved` \| `cancelled` | 跟踪事项的生命周期 |
| `last_reviewed` | YYYY-MM-DD | 上次复审日期 |
| `notes` | string (optional) | 备注 / 关联引用 |

### 3.2 trigger 字段的语义（按 type 区分）

- `deferred`：activate_when —— 何时**启动**为 active task（如"v0.4 上线后跑 ≥10 fixture"）
- `bug`：resolve_when —— 何时**修复**（如"修 EXEC_SHELL_BLOCK_PATTERNS"）
- `debt`：pay_when —— 何时**偿还**（如"schema 放宽且类型改 unknown"）
- `evidence`：collect_when —— 何时**补齐数据**（如"≥10 fixture 重跑 OpenCode 对比"）

### 3.3 CONSTITUTION 新增原则 8

```markdown
### 原则 8：长期跟踪事项可追溯（Tracked-Items Traceable）

**任何 spec / 报告 / 代码评审中标记的延后事项、已知 bug、技术债、
待跟进证据必须登记到 docs/project-ledger.md §8 长期跟踪事项表格。**

| 信息出现位置 | 登记义务方 | 登记时点 |
|-------------|----------|---------|
| spec §「非目标」/§「延后事项」 | spec 作者 | spec 状态 ≥ in_review 之前 |
| benchmark 报告 / 实证发现 | 报告作者 | 报告归档同 PR |
| 代码评审标识的技术债 | reviewer 或 PR 作者 | merge 前 |
| 实证数据缺口 | 写报告的人 | 报告归档同 PR |

不得删除已登记条目；只能将 status 改为 `resolved` 或 `cancelled`。
spec 关闭、报告归档、PR merge 时若漏登记，CI 检查会阻断（见
scripts/check-tracked-items.ts）。
```

### 3.4 project-ledger.md §8 表格

放在 ledger 最后一节（不强制，便于追加）：

```markdown
## 8. 长期跟踪事项

> 治理依据：CONSTITUTION 原则 8。新会话 AI 启动时必读。任何状态非
> resolved/cancelled 的条目都需要在合适时机被复审。

| type | id | source | title | trigger | prio | status | last_reviewed |
|------|----|----|------|---------|------|--------|---------------|
| deferred | patchloop-repair-upgrade | spec:2026-05-05-patch-loop | repair-loop 升级 v0.4 协议 | v0.4 patch loop 上线后跑 ≥10 fixture | P2 | waiting | 2026-05-05 |
| bug | exec-shell-redirect | report:260504-185028 | exec_shell 把 `2>&1` 误判为危险 | 修 EXEC_SHELL_BLOCK_PATTERNS | P3 | waiting | 2026-05-05 |
| debt | tool-args-coerce | code:packages/core/src/pipeline.ts:300 | tool args 用 string-coerce 临时方案 | schema 放宽为 z.record(z.unknown()) + 全链路类型 unknown | P3 | waiting | 2026-05-05 |
| evidence | dsh-vs-oc-resample | report:compare-20260502-120419 | 5 fixture 样本量不足以断言 60% vs 100% | 跑 ≥10 共同 fixture，含工具系统启用版 | P2 | waiting | 2026-05-05 |
```

### 3.5 BLUEPRINT.md 每 Phase 退出条件加 checkbox

```markdown
### 当前阶段（Phase X）的退出条件
- [ ] ... 既有条件 ...
- [ ] **长期跟踪事项复审** —— 遍历 project-ledger.md §8 全部条目，对
      每个 status=waiting 的事项做出决策：
        - trigger 已满足 → status 转 ready，并创建对应 task 卡片
        - trigger 未满足 → 更新 last_reviewed 为本次复审日期
        - 已被 superseded → status 转 cancelled，备注新替代条目 id
      复审记录归档到 `docs/reports/phase-X-exit-review.md`
```

### 3.6 spec 内嵌「跟踪事项」章节（标准章节）

每份新 spec 必须含：

```markdown
## §X 本 spec 引发的跟踪事项

| type | id | trigger | priority | notes |
|------|----|---------|---------|-------|
| deferred | repair-loop-upgrade | v0.4 上线后 ≥10 fixture | P2 | §2.2 第 3 项 |
| ... |

> 上述条目本 spec 提交时必须同步登记到 project-ledger §8。
```

老 spec（2026-05-05 之前）不强制回填，但鼓励。

### 3.7 CI 脚本：scripts/check-tracked-items.ts

```ts
// 职责：
// 1. 扫描 docs/specs/*.md，找每份 spec 的「## 本 spec 引发的跟踪事项」章节
//    抽取所有 (type, id, source) 三元组
// 2. 解析 docs/project-ledger.md §8 表格，抽取所有登记条目
// 3. 比对：spec 中存在但 ledger 缺 → 报错；ledger 中 source 文件不存在 → 报错
// 4. 抽 docs/reports/*/analysis.md 中的「## 跟踪事项」章节，同样比对
// 5. 输出 markdown 报告 + 非零退出码（CI 失败）
```

scan 范围：
- `docs/specs/*.md`（创建日期 ≥ 2026-05-05）
- `docs/reports/*/analysis.md`（如存在）
- `docs/project-ledger.md` §8 解析

CI 集成：在 `.github/workflows/scan.yml` 加一步 `pnpm exec tsx scripts/check-tracked-items.ts`。

#### 3.7.1 错误退出条件

| 错误 | 退出码 | 说明 |
|------|--------|------|
| spec 中条目未在 ledger 登记 | 1 | 强制登记 |
| ledger 条目的 source 路径不存在 | 1 | 防漂移 |
| ledger 条目 status=waiting 且 last_reviewed 超过 90 天 | 0（仅 warn） | 软提醒 |
| 表格列数不对 / 字段空缺 | 1 | 格式校验 |

### 3.8 数据迁移

- 把 patch-loop spec §2.2 / §6 / §8 的所有条目立刻登记到 ledger §8（本期产物）
- 把当前会话发现的 Bug A（已修）、Bug C（已修）、Bug D（待修）、debt（args coerce）、evidence（DSH vs OC 样本不足）登记
- 历史 spec 不强制回填

## 4. 数据模型

### 4.1 ledger §8 表格 markdown 格式约定

- 字段顺序固定：`type | id | source | title | trigger | prio | status | last_reviewed`
- 每行单行（不允许换行）
- type 用小写枚举值
- status 用小写枚举值
- last_reviewed 必须是 ISO 8601 日期（YYYY-MM-DD）

### 4.2 spec §「跟踪事项」表格格式

- 至少含 `type | id | trigger | priority`
- `source` 字段在 spec 中省略（隐式 = 当前 spec 文件路径）
- `notes` 字段可选

### 4.3 status 状态机

```
waiting → ready → in_progress → resolved
   │         │         │
   └─────────┴─────────┴───→ cancelled
```

转换规则：
- `waiting → ready`：trigger 满足，由 phase 退出复审或日常复审触发
- `ready → in_progress`：对应 task 卡片创建并启动
- `in_progress → resolved`：对应 task done
- 任意状态 → `cancelled`：被 superseded 或决策不再做

## 5. 成功标准

### 5.1 功能验收

- [ ] CONSTITUTION 加原则 8（修订版本号 → v1.1）
- [ ] BLUEPRINT 加 Phase 退出复审 checkbox
- [ ] project-ledger §8 章节存在 + 含本期 ≥4 条迁移条目
- [ ] patch-loop spec §「跟踪事项」章节存在 + 与 ledger §8 一致
- [ ] scripts/check-tracked-items.ts 实现 + CI 集成
- [ ] CI 脚本本地跑过（绿）
- [ ] 故意制造一条不一致（删 ledger 一行）→ CI 红，修复后绿（手动验证）

### 5.2 行为验收

- [ ] 任何后续 spec 提交 PR 时，若漏登记，CI 阻断
- [ ] Phase 2 退出复审时（待 patch-loop 上线后），ledger §8 至少 1 条 status 改变
- [ ] 90 天未复审的条目在 CI 中被 warn

### 5.3 维护成本

- [ ] 单条新增登记耗时 < 30 秒（人工）
- [ ] CI 脚本运行时间 < 5 秒
- [ ] 月度全表复审时间 < 15 分钟

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 表格变得太长（> 50 条） | 中 | 中 | 按 status 分块 + 折叠；resolved/cancelled 可归档到 §8.1 |
| 字段格式约定被打破 | 中 | 高 | CI 强制；可加 lint 规则（markdownlint custom） |
| 人在 spec 中写了 deferred 但偷偷不登记 | 低 | 中 | CI 扫描 spec 中的 `## 本 spec 引发的跟踪事项` 节，差集检查 |
| 历史 spec 没回填导致 CI 报错 | 中 | 低 | CI 仅扫描创建日期 ≥ 2026-05-05 的 spec |
| 表格被多人同时编辑出现 git 冲突 | 中 | 低 | 接受 —— 表格条目独立行，冲突小；约定按 id 字典序排列 |
| 治理增加了文档负担让人不写 spec | 低 | 高 | spec 模板内嵌「跟踪事项」章节占位；模板示例完善 |

## 7. 实施策略

### 7.1 分 4 个 Phase

| Phase | 目标 | 关键产物 |
|-------|------|---------|
| **G1** | 文档基础 | CONSTITUTION 原则 8、BLUEPRINT 退出 checkbox、ledger §8 章节（含迁移条目） |
| **G2** | spec 模板与回填 | spec 模板加「跟踪事项」章节、patch-loop spec 回填 §「跟踪事项」 |
| **G3** | CI 脚本 | scripts/check-tracked-items.ts、本地跑通、加测试 |
| **G4** | CI 集成与验证 | scan.yml 加步骤、人造不一致验证、绿/红切换验证 |

G1 → G2 → G3 → G4 顺序执行。G1+G2 可同 PR；G3+G4 可同 PR。

### 7.2 与 patch-loop spec 的关系

**先 G1+G2 完成后再启动 patch-loop spec → plan/task 拆分**。
理由：patch-loop spec 的「跟踪事项」章节必须按新模板写，否则一上线就违反原则 8。

G3+G4 可与 patch-loop 实施并行（不阻塞）。

### 7.3 不在本 spec 范围

| 事项 | 留待 |
|------|------|
| 跟踪事项跨 phase 看板 | 等条目数 > 30 时再考虑 |
| 跟踪事项的可视化（dashboard） | 优先级低，markdown 表格已足够 |
| 与 GitHub Issues 联动 | non-target |
| 跟踪事项自动 promotion 推荐（"该 ready 了"） | 等 CI 稳定后考虑 |

## 8. 本 spec 引发的跟踪事项

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
| deferred | tracked-items-dashboard | 跟踪事项数 > 30 时启动 | P3 | §7.3 |
| deferred | tracked-items-auto-promotion | CI 脚本稳定运行 90 天后启动 | P3 | §7.3 |
| evidence | governance-overhead-baseline | G4 完成 30 天后统计实际维护成本 vs §5.3 估算 | P3 | 验证 §5.3 假设 |

> 本 spec 标记的上述条目须在 PR 合并时同步登记到 ledger §8。

## 9. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-05 | v1.0 (draft) | 初始 spec：4 类跟踪事项的统一治理机制，含 CONSTITUTION 原则 8、ledger §8、BLUEPRINT 退出 checkbox、CI 脚本 |
