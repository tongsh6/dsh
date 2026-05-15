# <spec 标题>

> 状态: draft | 日期: YYYY-MM-DD | 作者: <name>
>
> 目标: <一句话说明本 spec 要解决什么问题、产出什么>

## 1. 问题定义

### 1.1 当前状态

<描述现状：什么模块 / 什么流程 / 什么契约 / 什么数据>

### 1.2 痛点 / 实证证据

<列出现状的具体问题，配上实证数据（benchmark / 报告 / 代码引用）。
不要写"我觉得"，要写"X 报告显示 Y 数据指向 Z"。>

### 1.3 与最终目标的关系

<本问题在 BLUEPRINT 哪个 Phase / 哪条原则 / 哪个用户场景下被 surfaced。
不要孤立写问题，要点出它影响哪个最终目标。>

## 2. 目标与非目标

### 2.1 目标

1. ...
2. ...

### 2.2 非目标

> 提示：列在此处的"非目标"如果属于「未来某天可能要做」性质，必须同步在 §9 跟踪事项中登记一条 `deferred`，否则 CI 会失败。

1. ❌ ...
2. ❌ ...

## 3. 设计

### 3.1 ...

### 3.2 ...

## 4. 数据模型 / 契约变更

<schema、API、协议、状态机、文件格式等。如无变更可写"无"。>

## 5. 成功标准

### 5.1 功能验收

- [ ] ...

### 5.2 行为验收（数据驱动）

- [ ] ...

### 5.3 性能 / 成本验收

- [ ] ...

### 5.4 Canonical wiring 验收（替代旧模块 / 旧 API 时必填）

> 仅当本 spec 引入 successor / canonical 模块、入口、协议或 API 来替代 legacy 实现时启用；不适用时写"不适用：本 spec 不替代既有入口"。

- [ ] canonical 入口已命名：`<new module / API / command>`
- [ ] legacy 入口已命名：`<old module / API / command>`
- [ ] 生产调用点迁移率 = 100%；证据命令：`rg '<legacy symbol>' <prod paths>` 返回 0 处生产调用（测试 / 文档 / git 历史残留需说明）
- [ ] legacy API 已物理删除；如保留兼容层，已在 §9 登记 `deferred` / `debt` 并写明退出条件
- [ ] 顶层 export / CLI / runtime wiring 指向 canonical 入口
- [ ] 相关测试覆盖 canonical 入口，而不是只覆盖 legacy wrapper

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| ... |  |  | ... |

> 提示：风险表中标记为"已知妥协 / 临时方案"的条目，在实施时落到代码中，必须同步在 §9 跟踪事项中登记一条 `debt`。

## 7. 实施策略

### 7.1 分 Phase

| Phase | 目标 | 关键产物 |
|-------|------|---------|
| ... |  |  |

### 7.2 回退策略

<v0.X 上线后若数据退化，如何回退到 v0.X-1？>

### 7.3 不在本 spec 范围

> 提示：列在此处的"非范围"如果属于"未来要做"性质，必须同步在 §9 跟踪事项中登记一条 `deferred`。

## 8. 不在本 spec 范围

<与 §7.3 重复语义时择一保留；推荐用 §7.3 + §8 分别表达"实施层不做"与"设计层不覆盖"。>

## 9. 本 spec 引发的跟踪事项

> **CONSTITUTION 原则 8 强制**：以下条目必须在本 spec 状态 ≥ in_review 之前同步登记到 `docs/project-ledger.md` §8 长期跟踪事项表格。CI 脚本（`scripts/check-tracked-items.ts`，G3 实现中）会校验差集。
>
> 字段约定（与 ledger §8 对齐，但 source 字段在本表中省略，隐式 = 当前 spec 文件路径）：

| type | id | trigger | priority | notes |
|------|----|---------|----------|-------|
| deferred / bug / debt / evidence | <kebab-case 唯一 id> | <activate_when / resolve_when / pay_when / collect_when> | P0 / P1 / P2 / P3 | <补充上下文，可选> |

> 示例（提交前删除）：
>
> | deferred | feature-X-incremental-mode | 本 feature 跑 ≥10 fixture 验证后启动 | P2 | §2.2 第 3 项 |
> | bug | known-edge-case | 修 module/Y.ts:42 的 race condition | P3 | §6 风险 #2 |
> | debt | tmp-coerce-workaround | schema 放宽后改 unknown 类型 | P3 | §3.4 数据模型 |
> | evidence | sample-size-insufficient | 跑 ≥20 共同 fixture | P2 | §5.2 行为验收 |

## 10. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| YYYY-MM-DD | v1.0 (draft) | 初始 spec |
