# DSH Task Specification & Workflow v1.0

> 状态: active | 日期: 2026-05-02 | 适用范围: dsh 项目开发

## 1. 定位

本文档定义 dsh 项目自身的**任务规范格式**和**任务生命周期管理流程**。适用于人类和 AI 协作开发 dsh 本身。

**不是:** dsh 执行引擎的 task-state 协议（那是 `packages/core/src/task-state.ts` 的职责）
**是:** 怎么给 dsh 项目提任务、怎么写、怎么跟踪、怎么算做完

## 2. 任务文件格式

### 2.1 文件命名

```
docs/superpowers/tasks/{YYYY-MM-DD}-{slug}.md
```

- 日期：创建日期，用于排序
- slug：短横线连接的英文概要，不超过 40 字符
- 示例：`2026-05-02-sarif-parser-completion.md`

### 2.2 文件结构

每个任务文件包含 YAML frontmatter + markdown body。

```markdown
---
id: "<kebab-case unique id>"
status: backlog | ready | in_progress | in_review | done | blocked | cancelled
priority: p0 | p1 | p2 | p3
type: feature | bugfix | refactor | test | docs | infra
spec_ref: "<path to related spec, optional>"
plan_ref: "<path to related plan, optional>"
dependencies: ["<task-id>", ...]
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
assignee: "<github handle or 'ai'>"
---

# <简短标题，一句动词短语>

## Objective
<1-2 句话：做完这个任务，什么变了？为什么值得做？>

## Context
<必要的背景信息：关联的 spec 章节、当前代码状态、已知约束>

## Acceptance Criteria
- [ ] <可验证的条件 1>
- [ ] <可验证的条件 2>
- [ ] <可验证的条件 3>

## Steps
<可选：复杂任务的拆解步骤。简单任务可以省略，直接靠 AC 驱动>

### Step 1: <步骤名>
- 做什么
- 涉及文件

### Step 2: <步骤名>
...

## Notes
<额外的技术备注、风险提示、参考链接>
```

### 2.3 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 全局唯一标识，用 kebab-case，如 `sarif-parser-completion` |
| `status` | 是 | 见 §3 生命周期 |
| `priority` | 是 | p0=阻塞性紧急, p1=本迭代必须, p2=本迭代期望, p3=backlog |
| `type` | 是 | feature/bugfix/refactor/test/docs/infra |
| `spec_ref` | 否 | 关联的设计 spec 文件路径（相对项目根目录） |
| `plan_ref` | 否 | 关联的实现 plan 文件路径 |
| `dependencies` | 否 | 前置依赖的任务 ID 列表 |
| `created` | 是 | 创建日期 |
| `updated` | 是 | 最后更新日期 |
| `assignee` | 否 | 负责人 |

### 2.4 任务类型与模板

#### Feature（新功能）
```markdown
---
type: feature
---
## Acceptance Criteria
- [ ] 新功能可被 CLI 命令或 API 调用触发
- [ ] 有对应的单元测试（覆盖 happy path + 2 个 edge case）
- [ ] `pnpm -r run typecheck` 通过
- [ ] `pnpm -r run test` 通过
- [ ] 新行为在设计 spec 中有对应说明（或同步更新 spec）
```

#### Bugfix（修 bug）
```markdown
---
type: bugfix
---
## Acceptance Criteria
- [ ] bug 的复现条件已被测试用例覆盖
- [ ] 修复后测试通过
- [ ] 无回归（现有测试全部通过）
- [ ] 修复逻辑在设计 spec 中无矛盾
```

#### Refactor（重构）
```markdown
---
type: refactor
---
## Acceptance Criteria
- [ ] 外部行为不变（现有测试无需修改即通过）
- [ ] 如有新增测试，覆盖重构引入的新抽象
- [ ] typecheck + lint 通过
- [ ] 如接口有变，更新相关 spec
```

#### Test（测试补充）
```markdown
---
type: test
---
## Acceptance Criteria
- [ ] 新增测试覆盖目标函数/模块的 happy path + edge cases
- [ ] 测试风格与现有测试一致（node:test + assert，或 vitest）
- [ ] 不修改被测源代码（除非是纯测试任务允许的微小调整）
- [ ] `pnpm -r run test` 全部通过
```

#### Docs（文档）
```markdown
---
type: docs
---
## Acceptance Criteria
- [ ] 文档准确反映当前代码行为（非规划中的行为）
- [ ] 文档中的命令/示例可实际执行
- [ ] 关联的 spec/plan 交叉引用路径正确
```

#### Infra（基础设施）
```markdown
---
type: infra
---
## Acceptance Criteria
- [ ] CI 配置变更后有对应的本地验证方式
- [ ] 不破坏现有 CI 流程
- [ ] 配置变更说明在 commit message 中有明确理由
```

## 3. 任务生命周期

```
                  ┌─────────┐
                  │ backlog │ ← 新建任务的默认状态
                  └────┬────┘
                       │ 明确优先级、解除依赖
                  ┌────▼────┐
                  │  ready   │ ← 所有依赖完成，可以开始
                  └────┬────┘
                       │ 开始工作
                  ┌────▼─────┐
                  │ in_progress │
                  └────┬─────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌──────────┐ ┌─────────┐ ┌──────────┐
    │ blocked  │ │in_review│ │ cancelled│
    └──────────┘ └────┬────┘ └──────────┘
          │            │ AC 全部满足
          │       ┌────▼────┐
          └──────►│   done   │
                  └──────────┘
```

### 3.1 状态说明

| 状态 | 含义 | 谁可以推进 |
|------|------|-----------|
| `backlog` | 已记录但未排期，可能缺依赖或优先级未定 | — |
| `ready` | 所有依赖满足，可以开始实现 | 开发者将其置为 `in_progress` |
| `in_progress` | 正在工作中 | 开发者完成后置为 `in_review` |
| `in_review` | 代码已完成，等待 AC 验证和 review | Reviewer 验证通过后置为 `done`，不通过则退回 `in_progress` |
| `done` | AC 全部满足，代码已合入主分支 | — |
| `blocked` | 被外部依赖阻塞，等待其他任务或决策 | 阻塞解除后置为 `ready` |
| `cancelled` | 不再需要，或设计变更导致任务无效 | — |

### 3.2 状态转换规则

1. `backlog → ready`：必须满足 (a) priority 已确定 (b) dependencies 全部 done
2. `ready → in_progress`：assignee 明确，且同一 assignee 的 `in_progress` 任务不超过 2 个（防止并行过度）
3. `in_progress → in_review`：代码已提交（commit 或 PR），AC 逐项自查通过
4. `in_review → done`：独立 reviewer 确认 AC 全部满足，代码已合并
5. `in_review → in_progress`：review 发现问题，退回修改
6. `in_progress → blocked`：遇到无法自行解决的依赖
7. 任何状态 → `cancelled`：任务不再需要

### 3.3 Definition of Done（通用）

每个任务完成时必须满足：

- [ ] **代码**：通过 typecheck + lint + test（即 `pnpm run scan`）
- [ ] **测试**：新增代码有对应测试覆盖
- [ ] **文档**：如有行为变更，关联 spec 已同步更新
- [ ] **提交**：commit 遵循项目约定格式，消息说明 why 而非 what
- [ ] **无回归**：`git diff main...HEAD` 无意外变更

## 4. Spec → Plan → Task 三层体系

```
spec/           ← 设计文档：描述"要做什么"和"为什么这样做"
  └── plan/     ← 实现计划：将 spec 拆解为 Phase + Task 序列
        └── tasks/  ← 任务卡片：可独立执行的最小工作单元
```

### 4.1 三层职责

| 层 | 文件 | 生命周期 | 受众 |
|----|------|---------|------|
| **Spec** | `docs/superpowers/specs/*.md` | 长周期，版本号管理 | 所有人 |
| **Plan** | `docs/superpowers/plans/*.md` | 中周期，Phase 完成后更新 | 开发者 |
| **Task** | `docs/superpowers/tasks/*.md` | 短周期，做完即归档 | 执行者 |

### 4.2 流转关系

1. **新建能力** → 先写 Spec（或更新已有 Spec）
2. **Spec 稳定后** → 写 Plan，拆出 Task 列表
3. **每个 Task** → 创建独立 `.md` 文件，初始状态 `backlog`
4. **Task done** → 更新 Plan 中的 checkbox
5. **Plan 全部 done** → 更新 Spec 版本号
6. **Task 归档** → 移到 `docs/superpowers/tasks/archive/`（可选）

### 4.3 何时跳过 Plan/Task 文件

以下情况可以跳过正式 task 文件，直接在 commit 中完成：

- 单行/单文件 typo 修复
- 注释修正
- 不影响行为的代码格式调整
- 依赖版本 patch 升级

原则：**任何涉及行为变更、新增功能、修改超过 1 个文件的工作，必须有 task 文件。**

## 5. 与 AI 协作的约定

### 5.1 Task 文件的 machine-readability

- 所有 task 文件使用 YAML frontmatter，确保 AI 工具能解析 status/dependencies/priority
- Acceptance Criteria 使用 `- [ ]` checkbox，便于自动扫描未完成项
- `spec_ref` 和 `plan_ref` 用相对路径，AI 可跟随读取

### 5.2 AI 执行 task 的流程

```
1. 读取 task 文件 → 理解 Objective + AC
2. 读取 spec_ref + plan_ref → 理解完整上下文
3. 执行 Steps（如有）→ 逐步骤完成
4. 自检 AC → 逐项确认
5. 运行 pnpm run scan → 确保质量门禁
6. 更新 task status → in_review
7. 通知人类 review → 不自行置为 done
```

### 5.3 AI 不可自行做的事

- 不能自行将 task 从 `in_review` 置为 `done`（需人类确认）
- 不能自行修改 spec 文件（需人类确认设计意图变更）
- 不能跳过 `pnpm run scan` 就声称完成

## 6. 当前 task 索引

> 此章节由 AI 或开发者维护，列出当前活跃的 task 文件。
> 每次 task 状态变更时同步更新此索引。

| ID | 标题 | 状态 | 优先级 | 指派 |
|----|------|------|--------|------|
| `semgrep-parser` | 实现 Semgrep JSON parser | done | p1 | ai |
| `parser-fixture-tests` | 为所有 parser 添加 fixture 测试 | done | p1 | ai |
| `create-claude-md` | 创建 CLAUDE.md 并修复 config.yml | done | p1 | ai |
| `spec-v0.3-upgrade` | 设计文档体系重整：SPEC v0.2 → v0.3 | done | p1 | ai |
| `baseline-benchmark` | 跑通基线对比 Benchmark | done | p2 | ai |
| `fixture-protocol-metadata` | 补齐 Fixture 协议操作覆盖元数据 | done | p0 | ai |
| `benchmark-ci-workflow` | 新建 Benchmark CI Workflow | done | p1 | ai |
| `phase2-exit-criteria-refinement` | 细化 BLUEPRINT Phase 2 退出条件 | done | p1 | ai |
| `task-lifecycle-fix` | Task 生命周期修复 | done | p2 | ai |

## 7. 修订历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-02 | v1.0 | 初始版本，定义 task 格式、生命周期、三层体系、AI 协作约定 |
