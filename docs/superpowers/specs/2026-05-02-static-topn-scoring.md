# 静态扫描 Top N 可解释评分 SPEC v1.0

> 状态: active | 日期: 2026-05-02 | 依赖: static-scan-governance v1.0

## 1. 问题定义

当前 `static-scanner.ts` 的 `selectTopFindings` 只有 2 维评分（severity + changed file），top_n_reasoning 是纯字符串，无法回答：这个 finding 为什么比那个更优先？building-blocking 错误有没有被正确优先？安全密钥有没有被压倒其他所有问题？

## 2. 目标

实现 6 维可配置的 Top N scoring pipeline。每个选中的 finding 产出结构化的维度得分、总分、和可读的选中原因。

## 3. 非目标

- 不做 Baseline（pre-scan/post-scan diff，区分历史 vs 新增）——那是 Phase 4
- 不做独立 `dsh scan` 命令 —— 那是 Phase 5
- 不做 CI 产物上传 —— 那是 Phase 6
- 不做治理报告升级（handoff 展示 score breakdown）—— 那是 Phase 7
- 不改变 AI 修复逻辑（`repairStaticScanTopN` 不变）
- 不改变 finding 解析器（`static-finding-parser.ts` 不变）

## 4. 评分模型

### 4.1 6 个维度

| # | 维度 | 字段名 | 默认权重 | 规则 |
|---|------|--------|----------|------|
| 1 | Severity | `severity` | 400 | critical=400, high=300, error=200, medium=100, warning=50, low/info=0 |
| 2 | Changed file | `changedFile` | 300 | finding.file 在 changedFiles 中 = 300, 否则 = 0 |
| 3 | Security/secret | `security` | 200 | finding.category 为 security 或 secret = 200, 否则 = 0 |
| 4 | Build blocking | `buildBlocking` | 150 | finding.severity ≥ error AND finding.category ∈ {bug, type} = 150, 否则 = 0 |
| 5 | Rule confidence | `ruleConfidence` | 50 | finding.rule ≠ null = 50, 否则 = 0（泛化文本匹配得分低） |
| 6 | Scanner order | `scannerOrder` | 0 | -(finding 在原始列表中的 index) / 1000，仅 tiebreaker |

### 4.2 总分计算

```
total = severity + changedFile + security + buildBlocking + ruleConfidence + scannerOrder
```

Scanner order 权重 0，仅作为 tiebreaker（值域 -0.001 ~ 0）。

### 4.3 配置化

```yaml
# .dsh/config.yml
static_scan:
  top_n: 5
  selection:
    weights:
      severity: 400
      changed_file: 300
      security: 200
      build_blocking: 150
      rule_confidence: 50
```

权重可配置，未配置项使用默认值。权重设为 0 可禁用该维度。

## 5. 数据模型

```typescript
export interface TopNWeights {
  severity: number;
  changedFile: number;
  security: number;
  buildBlocking: number;
  ruleConfidence: number;
}

export interface TopNConfig {
  topN: number;
  weights: TopNWeights;
}

export interface DimensionScore {
  severity: number;
  changedFile: number;
  security: number;
  buildBlocking: number;
  ruleConfidence: number;
  scannerOrder: number;
}

export interface ScoredFinding {
  finding: StaticScanFinding;
  dimensions: DimensionScore;
  total: number;
  reason: string; // e.g. "error severity (200) + changed file (300) + build blocking (150)"
}

export function selectTopFindings(
  findings: StaticScanFinding[],
  changedFiles: string[],
  config: TopNConfig,
): ScoredFinding[];

export function resolveTopNConfig(
  config: Record<string, unknown>,
): TopNConfig;

export function formatScoredFindings(scored: ScoredFinding[]): string;
```

### 5.1 reason 生成规则

`reason` 是 `dimensions` 的简短人类可读摘要。只列出非零维度：

```
dimensions: { severity: 200, changedFile: 300, security: 0, buildBlocking: 150, ruleConfidence: 50, scannerOrder: -0.005 }
→ reason: "error severity (200) + changed file (300) + build blocking (150) + rule confidence (50)"
```

### 5.2 task-state 集成

`StaticScanRun` 类型中 `top_n_reasoning` 保持 `string[]` 不变（存 `ScoredFinding.reason`）。

首次实现不添加 `selected_top_n_scores` 字段，Phase 7（治理报告升级）再扩展。

## 6. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/core/src/static-topn.ts` | **新建** | 核心评分逻辑 + 配置解析 |
| `packages/core/src/static-topn.test.ts` | **新建** | 评分维度测试 |
| `packages/core/src/static-scanner.ts` | 修改 | 替换 selectTopFindings 为 static-topn 版本；buildTopNReasoning 改用 ScoredFinding.reason |
| `packages/core/src/index.ts` | 修改 | 导出新类型和函数 |
| `packages/core/src/task-state.ts` | **不修改** | top_n_reasoning 保持 string[] |

## 7. 成功标准

- [ ] 所有 6 个维度有单元测试覆盖（每个维度的最大值和零值情况）
- [ ] 权重设为 0 可正确禁用维度
- [ ] 排序结果仅依赖 total 降序
- [ ] scannerOrder 仅作 tiebreaker（其他维度相同时生效）
- [ ] `resolveTopNConfig` 返回默认值当 config 为空或缺失
- [ ] `formatScoredFindings` 输出格式与现有 `formatFindings` 风格一致
- [ ] `pnpm -r run typecheck` 通过
- [ ] `pnpm -r run test` 通过（含新模块 ~10 个测试）
- [ ] 现有 static-scanner 测试不退化
