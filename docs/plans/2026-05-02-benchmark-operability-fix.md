# Benchmark 可操作性修复实现计划

> 关联 Spec: `docs/specs/2026-05-02-benchmark-operability-fix.md`

## 文件映射

| 文件 | 职责 |
|------|------|
| `packages/eval/src/task-fixtures.ts` | 新增 ProtocolOp 类型 + Zod schema + 接口字段 |
| `packages/eval/src/task-fixtures.test.ts` | Zod 校验测试 |
| `packages/eval/src/benchmark-runner.ts` | 按协议操作分类统计 |
| `packages/eval/src/fixtures/*.yaml` | 全部 41 个 fixture 补齐字段 |
| `BLUEPRINT.md` | 细化 Phase 2 退出条件 |
| `.github/workflows/benchmark.yml` | 新建 CI workflow |
| `run-benchmark.ts` | 新增 --ci 模式 |
| `docs/tasks/2026-05-02-baseline-benchmark.md` | 状态 → done |
| `docs/TASK-SPEC.md` | 更新 §6 索引 |

## Phase 1: Fixture 协议操作元数据 (p0)

### Task 1: 新增 ProtocolOp 类型与 Zod 校验

- [ ] 在 `task-fixtures.ts` 中定义 `ProtocolOp` 类型和 `ProtocolOpSchema`
- [ ] `TaskFixture` 接口新增 `expectedProtocolOperations: ProtocolOp[]`
- [ ] `loadFixtures()` / `loadAllFixtures()` 中加 Zod 校验
- [ ] 更新 `task-fixtures.test.ts`：测试 Zod 拒绝缺字段/空数组/无效值的 fixture

### Task 2: 为全部 41 个 fixture 补齐 expectedProtocolOperations

- [ ] 分析每个 fixture 的 taskPrompt，推断预期触发的协议操作
- [ ] 逐个 YAML 文件添加 `expectedProtocolOperations` 字段
- [ ] `loadAllFixtures` 加载不报错

### Task 3: Benchmark runner 增加按协议操作分类统计

- [ ] `TaskResult` 新增 `actualProtocolOps` 字段（实际触发的操作）
- [ ] `runTask` 中从 `parseChanges()` 提取实际操作类型
- [ ] `formatEvaluationReport` 新增协议操作统计表

## Phase 2: Phase 2 退出条件细化 (p1)

### Task 4: 细化 BLUEPRINT Phase 2 退出条件

- [ ] 替换 BLUEPRINT.md §3 中的退出条件为 7 个可验证条件
- [ ] 每个条件含阈值和数据来源

## Phase 3: Benchmark CI (p1)

### Task 5: 新建 benchmark CI workflow

- [ ] 创建 `.github/workflows/benchmark.yml`
- [ ] 手动触发 + 每周定时
- [ ] 120 分钟 timeout，API key 走 Secrets

### Task 6: run-benchmark.ts 增加 --ci 模式

- [ ] 解析 `--ci` flag
- [ ] CI 模式下输出 JSON 行格式
- [ ] CI 模式下不执行需要交互的操作

## Phase 4: Task 生命周期修复 (p2)

### Task 7: 关闭旧 task 并更新索引

- [ ] `baseline-benchmark` task 状态 `in_review` → `done`，补充 notes
- [ ] 更新 `TASK-SPEC.md` §6 索引表

## 验证方式

```bash
pnpm -r run typecheck   # 所有 package 类型检查通过
pnpm -r run test         # 所有测试通过
pnpm run lint            # Lint 通过
```
