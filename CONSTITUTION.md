# DSH Project Constitution v1.3

> 状态: active | 批准: 2026-05-02 | 最后修订: 2026-05-21
>
> 本宪法是 dsh 项目的最高原则文件。所有贡献者（人类和 AI）必须遵守。

## 第一章：核心原则

### 原则 1：设计文档先行（Design Doc First）

**任何涉及行为变更、新增功能、或影响超过 1 个文件的工作，必须先有设计文档，后有代码实现。**

| 变更类型 | 所需文档 |
|---------|---------|
| 新功能 / 新模块 | Spec（设计说明） + Plan（实现计划） |
| 重大重构（>3 个文件） | Spec 或 Plan |
| Bug 修复（>1 个文件或行为可变） | Plan |
| 单文件 typo / 格式修正 | 直接 commit |
| 依赖版本 patch 升级 | 直接 commit |

**文档层级：**

```
CONSTITUTION.md     ← 最高原则（本文件）
    │
    ▼
spec/               ← 设计说明：描述"做什么"和"为什么"
    │
    ▼
plan/               ← 实现计划：将 spec 拆解为 Phase + Task 序列
    │
    ▼
tasks/              ← 任务卡片：可独立执行的最小工作单元
```

**Spec 必须包含：**
- 目标与非目标（明确边界）
- 设计依据（为什么这样做，不那样做）
- 架构与数据模型
- 成功标准（可量化）
- 风险与限制

**Plan 必须包含：**
- 文件映射（哪些文件要改）
- 分阶段任务列表（带 checkbox）
- 验证方式（测试命令）
- 依赖关系

**设计文档存放位置：** `docs/specs/` 和 `docs/plans/`

**执行细节参见：** `docs/TASK-SPEC.md`

---

### 原则 2：验证闭环（Verify-Gated）

**没有经过验证的代码不算完成。**

- 每次代码变更必须通过 `pnpm run scan`（lint + typecheck + test）
- 新增代码必须有对应测试
- AI 生成的 patch 必须通过 verify 才能进入下一阶段
- CI 是强制门禁，不可绕过

**验证层级：**
1. 开发者本地 `pnpm run scan`
2. AI 工具 verify 步骤
3. CI 自动化（PR 触发）

---

### 原则 3：最小变更（Minimal Change）

**每次变更只做一件事，做到刚好够用。**

- 不引入任务范围外的重构
- 不为"可能"的未来需求预留抽象
- 三行重复好过一个不成熟的抽象
- 不删除"看起来没用"的代码（除非确认无引用）
- Bug 修复不需要附带周边清理

**反模式：**
- "顺便改一下" — 不在当前 task 范围内
- "以后可能会用" — 不在当前 spec 范围内
- "我觉得这样更好" — 设计意图由 spec 决定，不由实现者临时判断

---

### 原则 4：可审计与可回滚（Auditable & Reversible）

**每次变更必须可追溯、可解释、可回滚。**

- Commit message 说明 why，不是 what
- 每个 commit 对应一个逻辑变更
- 不 squash 不相关的变更
- 破坏性变更必须在 spec 中说明迁移路径
- Git 历史是审计记录，不可改写（不 force-push main）

---

### 原则 5：实证驱动（Evidence-Driven）

**核心假设必须用数据验证。**

- dsh 的定位是"DeepSeek 专属优化"——这必须通过对比 benchmark 数据证明
- 每次协议升级、prompt 调整后，必须重跑 benchmark 确认不退化
- 直觉可以驱动假设，但假设必须用数据验证
- 不做"我觉得这样更好"的优化——拿 benchmark 数据说话

**新模块替代旧模块时，"新模块已存在"不等于"迁移已完成"。** 任何引入 successor / canonical 模块并替代 legacy 模块或 API 的 spec，成功标准必须显式包含：

- canonical 入口与 legacy 入口的命名
- 生产调用点迁移率 = 100%（用 `rg` / import 图 / 导出面检查给出证据）
- legacy API 物理删除；若确需保留兼容层，必须登记 ledger §8 跟踪事项并写清退出条件
- 顶层 export / CLI / runtime wiring 均指向 canonical 入口

测试通过只能证明新路径可运行，不能单独证明旧路径已退役。

---

## 第二章：AI 协作规则

### 规则 1：AI 不可自行批准最终产出

- AI 不能将 task 从 `in_review` 置为 `done`（需人类确认）
- AI 不能自行修改 spec 文件（设计意图变更需人类确认）
- AI 不能跳过 `pnpm run scan` 就声称完成

### 规则 2：AI 必须遵循文档层级

- 接到任务 → 先查是否有对应 spec/plan/task
- 没有文档 → 先问人类是否需要创建（除非是原则 1 允许的直接变更）
- 有文档 → 严格按文档执行，不自行扩大范围

### 规则 3：AI 应该主动发现并标记问题

- 发现 spec 与实际代码不一致 → 标记，不静默
- 发现 plan 已过期 → 标记，建议更新
- 发现设计缺陷 → 记录到 task notes，不绕过

---

## 第三章：技术原则

### 原则 6：DeepSeek 原生（DeepSeek-Native）

- 所有优化围绕 DeepSeek 模型行为，不做通用多模型适配
- thinking/non-thinking 路由基于实测数据，不做猜测
- 协议设计优先考虑 DeepSeek 的成功率特征

### 原则 7：文件系统是 API（File System as API）

- 输入：`.dsh/config.yml`、`task-state.json`、项目文件
- 输出：patches、handoff markdown、scan reports
- 不做 MCP、不做 Web server、不做数据库
- 通过文件系统与上下游工具对接

### 原则 8：长期跟踪事项可追溯（Tracked-Items Traceable）

**任何 spec / 报告 / 代码评审中标记的延后事项、已知 bug、技术债、待跟进证据必须登记到 `docs/project-ledger.md` §8 长期跟踪事项表格。**

| 信息出现位置 | 登记义务方 | 登记时点 |
|-------------|----------|---------|
| spec §「非目标」/§「跟踪事项」 | spec 作者 | spec 状态 ≥ in_review 之前 |
| benchmark 报告 / 实证发现 | 报告作者 | 报告归档同 PR |
| 代码评审标识的技术债 | reviewer 或 PR 作者 | merge 前 |
| 实证数据缺口 | 写报告的人 | 报告归档同 PR |

不得删除已登记条目；只能将 status 改为 `resolved` 或 `cancelled`。spec 关闭、报告归档、PR merge 时若漏登记，CI 检查会阻断（见 `scripts/check-tracked-items.ts`）。

跟踪事项 4 类（type 字段）：

- `deferred` —— 延后事项：本期非目标但未来要做（trigger 字段表 activate_when）
- `bug` —— 已知 bug：本期不修但需登记（trigger 字段表 resolve_when）
- `debt` —— 技术债：已知妥协或分阶段设计债（trigger 字段表 pay_when）
- `evidence` —— 待跟进证据：数据/对比/复跑等实证缺口（trigger 字段表 collect_when）

详见设计 spec：`docs/specs/2026-05-05-tracked-items-governance.md`。

---

### 原则 9：无临时手段（No Temporary Workarounds）

**DSH 处于开发阶段，没有时间压力；所有解决方案必须按长期正确性设计和验证，不接受以赶时间为理由的临时手段。**

- 不用"先临时关掉 / 绕过 / 硬编码 / fixture 特判 / prompt 特判"替代根因修复。
- Feature flag、双轨实现、分阶段迁移只允许作为可审计的工程演进手段，必须有明确目标、验收标准、退出条件和实证计划；不得作为隐藏问题的永久开关。
- 技术债只能是经 spec / ledger 明确登记的分阶段设计债，不能把已知错误包装成"临时方案"继续推进。
- 单 fixture 失败不得用 harness 侧答案泄漏、任务提示污染、特殊 case 分支修复；必须回到类别级机制、协议、状态机、验证信号或模型交互设计。
- 如果一个修法只能解释为"为了这次通过"，而不能解释为"长期系统行为更正确"，则不得合入。

---

## 第四章：修订程序

### 宪法修订

1. 提出修订 PR，说明理由和影响范围
2. 所有活跃贡献者 review
3. 批准后更新版本号和日期
4. 重大修订（原则变更）需要至少 2 人同意

### 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-02 | v1.0 | 初始宪法：5 项核心原则 + 3 条 AI 协作规则 + 2 项技术原则 + 修订程序 |
| 2026-05-05 | v1.1 | 第三章追加原则 8：长期跟踪事项可追溯（依据 `docs/specs/2026-05-05-tracked-items-governance.md`） |
| 2026-05-15 | v1.2 | 原则 5 追加 canonical wiring 验收规则：successor 模块替代 legacy 模块时，必须证明生产调用点 100% 迁移且旧 API 删除或登记退出条件 |
| 2026-05-21 | v1.3 | 第三章追加原则 9：无临时手段；明确开发阶段无时间压力，禁止以临时绕过、fixture 特判、硬编码等替代长期正确性修复 |
