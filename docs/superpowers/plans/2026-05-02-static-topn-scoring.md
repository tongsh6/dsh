# 静态扫描 Top N 可解释评分实现计划

> 关联 Spec: `docs/superpowers/specs/2026-05-02-static-topn-scoring.md`

## 文件映射

| 文件 | 职责 |
|------|------|
| `packages/core/src/static-topn.ts` | **新建** — scoring, reason generation, config resolution |
| `packages/core/src/static-topn.test.ts` | **新建** — 每个维度的单元测试 + 集成测试 |
| `packages/core/src/static-scanner.ts` | 修改 — 替换 selectTopFindings/buildTopNReasoning |
| `packages/core/src/index.ts` | 修改 — 导出新类型和函数 |

## Phase 1: 核心模块

### Task 1: 创建 static-topn.ts

- [ ] 定义 `TopNWeights`、`TopNConfig`、`DimensionScore`、`ScoredFinding` 类型
- [ ] 实现 `resolveTopNConfig(config)` — 从 config.yml 解析权重，缺项用默认值
- [ ] 实现 `scoreFindings(findings, changedFiles, weights)` — 为全部 finding 计算 6 维得分
- [ ] 实现 `selectTopFindings(findings, changedFiles, config)` — 排序 + 取 top N
- [ ] 实现 `buildReason(dimensions)` — 生成人类可读原因
- [ ] 实现 `formatScoredFindings(scored)` — 格式化输出

### Task 2: 集成到 static-scanner.ts

- [ ] 替换 `selectTopFindings` 内部函数为 `static-topn.ts` 版本
- [ ] 替换 `buildTopNReasoning` 为使用 `ScoredFinding.reason`
- [ ] `resolveStaticScanConfig` 扩展以解析 `selection.weights`
- [ ] 更新 `index.ts` 导出

### Task 3: 编写测试

- [ ] 每个维度的最大值和零值情况校验
- [ ] 权重为 0 时维度禁用
- [ ] 排序确定性校验（相同分数的 findings 稳定排序）
- [ ] scannerOrder tiebreaker 校验
- [ ] 配置解析：空 config、部分配置、完整配置

## 验证方式

```bash
pnpm --filter @dsh/core test   # 新模块 ~10 个测试 + 现有测试不退化
pnpm -r run typecheck           # 全部 package 类型检查通过
pnpm -r run test                # 全部 294+ 测试通过
```

## 依赖

无依赖。此 plan 独立于 benchmark operability fix。

## 成功标准（来自 Spec §7）

- [ ] 6 个维度有单测覆盖
- [ ] 权重设为 0 正确禁用
- [ ] 排序仅依赖 total 降序
- [ ] scannerOrder 仅 tiebreaker
- [ ] 空 config 返回默认值
- [ ] formatScoredFindings 风格一致
- [ ] typecheck + test 通过
