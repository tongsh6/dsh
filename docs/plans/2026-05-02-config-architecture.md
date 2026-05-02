# 配置管理架构统一实现计划

> 关联 Spec: `docs/specs/2026-05-02-config-architecture.md`

## 文件映射

| 文件 | 职责 |
|------|------|
| `packages/repo/src/config-loader.ts` | **重写** — 唯一读写入口 |
| `packages/repo/src/config-loader.test.ts` | **新建** — merge 语义测试 |
| `packages/repo/src/index.ts` | 修改 — 导出新函数 |
| `packages/core/src/pipeline.ts` | 修改 — 删除 readLocalConfig，改用 loadDshConfig |
| `packages/cli/src/utils/config.ts` | 修改 — readConfig → loadDshConfig re-export |
| `packages/cli/src/commands/init.ts` | 修改 — writeFileSync → writeDshConfig |
| `packages/cli/src/commands/plan.ts` | 修改 — 显式传 key |
| `packages/cli/src/commands/patch.ts` | 修改 — 显式传 key |
| `packages/cli/src/commands/repair.ts` | 修改 — 显式传 key |
| `packages/provider/src/client.ts` | 修改 — fromEnv 去掉 config 正则回退 |
| `packages/provider/src/client.test.ts` | 修改 — 更新测试 |
| `packages/eval/src/benchmark-runner.ts` | 修改 — writeFileSync → writeDshConfig；去除 readExistingApiKey |
| `run-benchmark.ts` | 修改 — 显式传 key |

## Phase 1: 基础设施 — config-loader 重写

### Task 1: 重写 config-loader.ts
- [ ] 定义 `DshConfig` 类型接口
- [ ] 保持 `loadDshConfig(cwd): DshConfig`
- [ ] 新增 `mergeConfig(existing, overrides): DshConfig`
- [ ] 新增 `writeDshConfig(cwd, overrides): void`
- [ ] 新增 `readApiKey(cwd): string | null`
- [ ] 更新 `index.ts` 导出

### Task 2: 编写 config-loader 测试
- [ ] merge 对象 → 嵌套保留
- [ ] merge 数组 → 整体替换
- [ ] merge 标量 → 覆盖
- [ ] writeDshConfig 写入不存在 config 时创建新文件
- [ ] writeDshConfig 写入已存在 config 时保留无关字段

## Phase 2: 写路径迁移

### Task 3: init 改用 writeDshConfig
- [ ] 替换 `yaml.dump + writeFileSync` 为 `writeDshConfig`
- [ ] 只传 init 探测到的字段

### Task 4: benchmark-runner 改用 writeDshConfig
- [ ] 替换 `yaml.dump + writeFileSync` 为 `writeDshConfig`
- [ ] 删除 `readExistingApiKey` 内部函数

## Phase 3: 读路径收敛

### Task 5: pipeline.ts 改用 loadDshConfig
- [ ] 删除 `readLocalConfig` / `readLocalConfigStrict`
- [ ] 改为 `import { loadDshConfig } from "@dsh/repo"`

### Task 6: cli/utils/config.ts 收敛
- [ ] `readConfig` → re-export `loadDshConfig`

### Task 7: provider fromEnv 清理
- [ ] 去掉正则读取 config 的逻辑
- [ ] fromEnv 只查环境变量
- [ ] 更新 client.test.ts

### Task 8: CLI 命令 + run-benchmark 显式传 key
- [ ] plan.ts / patch.ts / repair.ts：loadDshConfig + 显式传 key 给 client
- [ ] run-benchmark.ts：同上

## Phase 4: 回归验证

### Task 9: 全量回归
- [ ] `pnpm -r run typecheck` 通过
- [ ] `pnpm -r run test` 通过（无回归）
- [ ] `pnpm -w run scan` 通过

## 验证方式

```bash
pnpm -w run scan   # lint + typecheck + test
```
