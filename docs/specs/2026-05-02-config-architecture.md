# DSH 配置管理架构统一 SPEC v1.0

> 状态: active | 日期: 2026-05-02

## 1. 问题定义

`.dsh/config.yml` 的读写分散在 3 个包、5 个读函数、2 个写入口中，互不感知。问题表现：

- **写入语义是"覆盖"而非"合并"** — `dsh init` 和 benchmark runner 各自凭空生成完整 config 后覆盖写入，导致用户手工配置的任何字段（`api_key`、`top_n`、`command`）静默丢失
- **读逻辑三份复制** — `repo/config-loader.ts`、`core/pipeline.ts`、`cli/utils/config.ts` 各有一套相同的 `readFile → yaml.load → catch → {}` 
- **provider 用正则抓 YAML** — `DeepSeekClient.fromEnv()` 用正则 `/api_key:\s*["']?([^"'\n]+)["']?\s*$/` 解析 YAML，绕过所有已有解析器

这不是 `api_key` 一个字段的问题，是**任何字段都可能在不知情时被覆盖**。

## 2. 目标

统一配置读写入口，语义从"覆盖"改为"合并"。

## 3. 非目标

- 不改变 config.yml 的结构
- 不改动 CLI 命令的参数接口
- 不涉及 task-state.json 的读写
- 不做配置 schema 校验（那是 Phase 3 工具化之后的事）

## 4. 设计

### 4.1 统一读写入口

**单一模块：`packages/repo/src/config-loader.ts`**

```
当前（分散式）：
  repo/config-loader.ts  → loadDshConfig()      读
  core/pipeline.ts        → readLocalConfig()     读
  cli/utils/config.ts     → readConfig()          读
  provider/client.ts      → 正则 api_key          读
  cli/commands/init.ts    → 凭空生成 + 覆盖写入   写
  eval/benchmark-runner   → 凭空生成 + 覆盖写入   写

目标（收敛式）：
  repo/config-loader.ts  → loadDshConfig()       唯一读入口
                         → writeDshConfig()       唯一写入口（merge 语义）
                         → readApiKey()           从 config 读 key
                         → mergeDshConfig()       合并工具
```

### 4.2 writeDshConfig — merge 语义

```
writeDshConfig(cwd, overrides):
  1. loadDshConfig(cwd)          → 读取旧 config
  2. mergeDshConfig(old, overrides) → 深度合并
  3. yaml.dump(merged)           → 写入文件
```

merge 规则：`overrides` 中的字段覆盖 `old` 中同名字段，`old` 中未提及的字段原样保留。
- 嵌套对象（如 `deepseek`、`static_scan`）递归合并，不整体替换
- 数组字段（如 `rules.files`、`verificationCommands`）整体替换，不拼接
- 标量字段（`string`、`number`、`boolean`）直接覆盖

### 4.3 调用方适配

**`dsh init` — 从"生成+覆盖"改为"合并写入"：**

```typescript
// 之前：凭空生成完整 config，覆盖写入
const config = { project: {...}, verify: {...}, deepseek: {api_key: ""}, ... };
fs.writeFileSync(configPath, yaml.dump(config));

// 之后：只传 init 探明的字段，merge 写入
writeDshConfig(cwd, {
  project: { name, language, package_manager },
  verify: { test, lint, typecheck, build },
  static_scan: { enabled: true, command: verify.lint },
  rules: { files: [...] },
  deepseek: { default_model, flash_model, max_repair_rounds, thinking_default },
  // 不传 api_key — 旧值自动保留
});
```

**benchmark runner — 从"凭空生成+覆盖"改为"合并写入"：**

```typescript
// 之前：凭空生成完整 config
const config = { project: {...}, verify: {...}, deepseek: {api_key: ""}, ... };
fs.writeFileSync(configPath, yaml.dump(config));

// 之后：只传 benchmark 需要覆盖的字段
writeDshConfig(repoPath, {
  verify: { test: fixture.verificationCommands[0] },
  deepseek: { max_repair_rounds: fixture.maxRepairRounds ?? 3 },
  // project/rules/api_key 等自动保留旧值
});
```

### 4.4 读路径收敛

| 当前位置 | 当前函数 | 改为 |
|----------|---------|------|
| `repo/config-loader.ts` | `loadDshConfig()` | 保持不变，唯一读入口 |
| `core/pipeline.ts` | `readLocalConfig()` / `readLocalConfigStrict()` | 改为 `import { loadDshConfig } from "@dsh/repo"` |
| `cli/utils/config.ts` | `readConfig()` | 改为 `import { loadDshConfig } from "@dsh/repo"` |
| `provider/client.ts` | 正则提取 `api_key` | 改为 `import { readApiKey } from "@dsh/repo"` |

**问题：provider → repo 依赖方向**

当前依赖链：`cli → core → provider + repo`。provider 不依赖 repo。如果 provider 要从 repo 导入，会引入新依赖。但 provider 已经"越界"了——它用正则解析 YAML，本质上是绕过架构偷偷读 config。

替代方案：不让 provider 导 repo。而是让调用方在创建 client 时显式传入 key。

**`fromEnv()` 所有调用点：**

| 文件 | 当前调用 | 改为 |
|------|---------|------|
| `packages/cli/src/commands/plan.ts` | `DeepSeekClient.fromEnv()` | 先 `loadDshConfig(cwd)`，显式传 key |
| `packages/cli/src/commands/patch.ts` | `DeepSeekClient.fromEnv()` | 同上 |
| `packages/cli/src/commands/repair.ts` | `DeepSeekClient.fromEnv()` | 同上 |
| `packages/cli/src/commands/handoff.ts` | 间接（通过 pipeline） | 不受影响 |
| `run-benchmark.ts` | `DeepSeekClient.fromEnv()` | 同上 |
| `packages/eval/src/benchmark-runner.ts` | 接收 client 参数 | 不受影响 |

```typescript
// CLI 命令层统一模式：
const cwd = process.cwd();
const config = loadDshConfig(cwd);
const apiKey = process.env["DEEPSEEK_API_KEY"]
  ?? (config["deepseek"] as Record<string, unknown>)?.["api_key"] as string
  ?? "";
const client = new DeepSeekClient({ apiKey });

// provider/client.ts — fromEnv 去掉 config 回退逻辑：
static fromEnv(): DeepSeekClient {
  const apiKey = process.env["DEEPSEEK_API_KEY"];
  if (!apiKey) throw new DeepSeekError("DEEPSEEK_API_KEY not set");
  return new DeepSeekClient({ apiKey });
}
```

这是更干净的方案：**provider 只读环境变量，config 读取是调用方的职责。**

## 5. 数据模型

```typescript
// packages/repo/src/config-loader.ts

export interface DshConfig {
  project?: {
    name?: string;
    language?: string;
    package_manager?: string;
  };
  verify?: {
    test?: string;
    lint?: string;
    typecheck?: string;
    build?: string;
  };
  static_scan?: {
    enabled?: boolean;
    command?: string;
    top_n?: number;
    selection?: {
      weights?: {
        severity?: number;
        changed_file?: number;
        security?: number;
        build_blocking?: number;
        rule_confidence?: number;
      };
    };
  };
  rules?: {
    files?: { path: string }[];
  };
  deepseek?: {
    default_model?: string;
    flash_model?: string;
    max_repair_rounds?: number;
    thinking_default?: boolean;
    api_key?: string;
  };
}

export function loadDshConfig(cwd: string): DshConfig;

export function writeDshConfig(
  cwd: string,
  overrides: DshConfig,
): void;

export function readApiKey(cwd: string): string | null;

// 内部函数，merge 逻辑
function mergeConfig(
  existing: DshConfig,
  overrides: DshConfig,
): DshConfig;
```

`DshConfig` 的类型约束只在**本模块内**生效——`loadDshConfig` 返回它，`writeDshConfig` 接受它。但 `mergeConfig` 的实现不依赖类型（运行时 `typeof` 判断），类型只是编译期约束，避免调用方传错字段名。

## 6. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/repo/src/config-loader.ts` | **重写** | 新增 `writeDshConfig`、`mergeConfig`、`readApiKey` |
| `packages/repo/src/config-loader.test.ts` | **新建** | merge 语义测试 |
| `packages/repo/src/index.ts` | 修改 | 导出新函数 |
| `packages/core/src/pipeline.ts` | 修改 | `readLocalConfig` → `loadDshConfig` |
| `packages/cli/src/utils/config.ts` | 修改 | `readConfig` → `loadDshConfig` re-export |
| `packages/cli/src/commands/init.ts` | 修改 | 生成+覆盖 → `writeDshConfig` |
| `packages/cli/src/commands/plan.ts` | 修改 | 创建 client 时显式传 key |
| `packages/cli/src/commands/patch.ts` | 修改 | 同上 |
| `packages/cli/src/commands/repair.ts` | 修改 | 同上 |
| `packages/provider/src/client.ts` | 修改 | 去掉 config 正则回退，fromEnv 只读环境变量 |
| `packages/provider/src/client.test.ts` | 修改 | 更新测试 |
| `packages/eval/src/benchmark-runner.ts` | 修改 | 生成+覆盖 → `writeDshConfig`；去除 `readExistingApiKey` |
| `packages/eval/src/run-benchmark.ts` | 修改 | 如有直接读 config 的地方，改为新 API |

## 7. 成功标准

- [ ] `loadDshConfig` 是三份读逻辑的唯一实现
- [ ] `writeDshConfig` 是所有配置写入的唯一入口
- [ ] merge 语义：写入 `{a: 1}` 不覆盖 `{b: 2}`
- [ ] 嵌套 merge：`{deepseek: {api_key: "x"}}` 不丢失 `deepseek.default_model`
- [ ] `dsh init --force` 不会覆盖已有的 `api_key`
- [ ] benchmark runner 不会覆盖目标仓库的 `api_key` 或其他字段
- [ ] `DeepSeekClient.fromEnv()` 不再读取文件
- [ ] `pnpm -r run typecheck` 通过
- [ ] `pnpm -r run test` 通过（无回归）
