# Benchmark 可操作性修复 SPEC v1.0

> 状态: active | 日期: 2026-05-02 | 依赖: dsh-design v0.3, dsh-eval-design v0.1

## 1. 问题定义

每次项目扫描 Benchmark 都是 Top 1 优先级，但并非"没跑过"——5 个 pi-* fixture 已执行（完成率 80%），DSH vs OpenCode 对比报告已产出。根因是四个结构性缺失导致"跑完永远不够"：

1. **Fixture 数据模型缺协议操作覆盖维度** — `TaskFixture` 接口有 `category`（任务类型），但没有 `expectedProtocolOperations`（预期触发哪些协议操作）。跑完 41 个 fixture 也回答不了 "SEARCH_REPLACE 成功率是多少"，因为 fixture 没有标注这个维度。
2. **Phase 2 退出条件不可度量** — "10+ fixture 完成率 > 60%" 没有说清楚哪 10 个、覆盖哪些操作、什么 repo。
3. **Benchmark 无 CI 自动化** — 每次手动跑：确认 API key → clone repo → 执行 → 复制报告，摩擦成本过高。
4. **Task 生命周期断裂** — `baseline-benchmark` 卡在 `in_review`，新 benchmark 需求不断产生但无新 task 跟踪。

## 2. 目标

修复这四个缺失，让 benchmark 从"每次都分析出同样结论"变为"可度量、可重复、可关闭"。

## 3. 非目标

- 不在此 spec 中实现 benchmark 回归自动检测（Phase 3 评测平台功能）
- 不在此 spec 中实现 OpenCode/Claude Code 自动化调用
- 不新增 eval 评测维度（10 维评分体系不变）

## 4. 设计

### 4.1 Fixture 协议操作元数据

**新增类型：**

```typescript
type ProtocolOp = 'CREATE' | 'PATCH' | 'SEARCH_REPLACE' | 'INSERT' | 'DELETE' | 'RENAME';
```

**TaskFixture 接口新增必填字段：**

```typescript
export interface TaskFixture {
  // ... 现有字段不变 ...
  expectedProtocolOperations: ProtocolOp[];
}
```

**Zod Schema（运行时校验）：**

```typescript
const ProtocolOpSchema = z.enum([
  'CREATE','PATCH','SEARCH_REPLACE','INSERT','DELETE','RENAME'
]);

// 在 loadFixtures() 中对每个 loaded YAML 做校验
const TaskFixtureSchema = z.object({
  // ... existing fields ...
  expectedProtocolOperations: z.array(ProtocolOpSchema).min(1,
    '每个 fixture 必须标注至少一个预期协议操作'),
});
```

**Benchmark runner 增强：**

- 解析模型响应的实际操作类型（复用 `parseChanges()` 可识别的操作类型）
- 对比 `expectedProtocolOperations` vs 实际触发的操作，记录到 `TaskResult`
- `formatEvaluationReport` 输出按协议操作分组的统计表

### 4.2 Phase 2 退出条件细化

修改 `BLUEPRINT.md` §3 "当前阶段（Phase 2）的退出条件"，从定性描述改为可逐项验证的 7 个条件，每个都含阈值和数据所在位置。

### 4.3 Benchmark CI Workflow

新建 `.github/workflows/benchmark.yml`：
- 触发：手动 (`workflow_dispatch`) + 每周六定时 (`0 2 * * 6`)
- timeout: 120 分钟
- API key 走 GitHub Secrets
- 结果以 artifact 存档
- `run-benchmark.ts` 新增 `--ci` 模式：输出 JSON 行格式

### 4.4 Task 生命周期修复

- 关闭 `baseline-benchmark` task（`in_review` → `done`）
- 为本 spec 的 3 个阶段创建独立 task 文件
- 更新 `TASK-SPEC.md` §6 索引

## 5. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/eval/src/task-fixtures.ts` | 修改 | 新增 ProtocolOp 类型 + Zod schema + expectedProtocolOperations 字段 |
| `packages/eval/src/benchmark-runner.ts` | 修改 | 新增按协议操作分类统计 |
| `packages/eval/src/task-fixtures.test.ts` | 修改 | 新增 Zod 校验测试 |
| `packages/eval/src/fixtures/*.yaml` | 修改 | 全部 41 个 fixture 补齐 expectedProtocolOperations |
| `BLUEPRINT.md` | 修改 | 细化 Phase 2 退出条件 |
| `.github/workflows/benchmark.yml` | 新建 | Benchmark CI workflow |
| `run-benchmark.ts` | 修改 | 新增 `--ci` 模式 |
| `docs/superpowers/tasks/2026-05-02-baseline-benchmark.md` | 修改 | 状态 → done |
| `docs/superpowers/TASK-SPEC.md` | 修改 | 更新 §6 索引 |
| `docs/superpowers/tasks/2026-05-02-fixture-protocol-metadata.md` | 新建 | 新 task |
| `docs/superpowers/tasks/2026-05-02-phase2-exit-criteria-refinement.md` | 新建 | 新 task |
| `docs/superpowers/tasks/2026-05-02-benchmark-ci-workflow.md` | 新建 | 新 task |

## 6. 成功标准

- [ ] 41 个 fixture 全部补齐 `expectedProtocolOperations`，Zod 校验不报错
- [ ] Benchmark runner 报告含按协议操作分类的统计表
- [ ] BLUEPRINT Phase 2 退出条件细化为 7 个可逐项打勾的条件
- [ ] `.github/workflows/benchmark.yml` 存在且语法正确
- [ ] `run-benchmark.ts --ci` 模式可用
- [ ] `baseline-benchmark` task 状态为 `done`
- [ ] `pnpm -r run typecheck` + `pnpm -r run test` 通过
