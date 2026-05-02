# DSH Next Steps Implementation Plan

> **状态更新 (2026-05-02):** Phase 3（Search/Replace 回退策略）已全部实现完成。Phase 2（扩展 fixture）中 3 个 dsh-* fixture 已创建。任务跟踪方式已升级为 `docs/superpowers/TASK-SPEC.md` 定义的独立 task 文件体系。

**Goal:** 将 dsh 从"框架已搭建"推进到"有实证数据支撑 + 可对比基线 + v0.3 协议升级"

**新增治理计划:** AI 后静态扫描与 Top N 修复不是一次性小功能，完整目标和分阶段推进见 `docs/superpowers/specs/2026-05-01-static-scan-governance.md` 与 `docs/superpowers/plans/2026-05-01-static-scan-governance-plan.md`。当前 Phase 1 基础闭环已完成，Phase 2（finding parser + Semgrep + SARIF）已完成。

**Architecture:** 三个独立工作流：(1) 跑通真实 benchmark 收集实证数据，(2) 扩展可执行 fixture 到多语言多 repo，(3) ~~在 patch-parser 中实现 Search/Replace 回退策略~~ ✅ 已完成。三个流可并行推进。

**Tech Stack:** TypeScript ESM, Node.js >= 18, pnpm, DeepSeek API, Git

---

## 文件映射

| 文件 | 职责 |
|------|------|
| `run-benchmark.ts` | 已有，benchmark 入口脚本 |
| `packages/eval/src/benchmark-runner.ts` | 已有，修改：增强错误日志、支持多 repo |
| `packages/eval/src/fixtures/pi-*.yaml` | 已有 5 个，新增更多 pi-* fixture |
| `packages/eval/src/fixtures/dsh-*.yaml` | 新增，针对 dsh 自身 repo 的 fixture |
| `packages/core/src/patch-parser.ts` | 修改，新增 Search/Replace 解析和应用 |
| `packages/core/src/patch-parser.test.ts` | 修改，新增 Search/Replace 测试 |
| `packages/core/src/failure-detector.ts` | 修改，新增 search-replace-mismatch 故障模式 |

---

## Phase 1: 跑通 Benchmark 收集实证数据

### Task 1: 环境准备与验证

**Files:**
- Modify: `packages/core/src/pipeline.ts`（如需修复 benchmark 执行中暴露的 bug）

- [ ] **Step 1: 确认 DeepSeek API Key 可用**

`DeepSeekClient.fromEnv()` 读取优先级：
1. `DEEPSEEK_API_KEY` 环境变量（优先）
2. `.dsh/config.yml` 中 `deepseek.api_key` 字段（fallback）

建议设置环境变量（一次设置，所有 benchmark repo 共用）：

```bash
# 方式一：从当前 dsh 的 config.yml 读取并导出为环境变量
export DEEPSEEK_API_KEY=$(grep -oP 'api_key:\s*["'\'']?\K[^"'\''\n]+' .dsh/config.yml)
echo ${DEEPSEEK_API_KEY:+"OK: key 已设置 (${#DEEPSEEK_API_KEY} chars)"} || echo "ERROR: 无法读取 API Key"
```

或直接设置：

```bash
export DEEPSEEK_API_KEY="sk-your-key"
```

- [ ] **Step 2: 确认 pi-proof-forge 仓库可访问**

```bash
if [ -d /tmp/pi-proof-forge ]; then
  echo "OK: repo exists"
  cd /tmp/pi-proof-forge && git fetch origin && git checkout main && git pull
else
  git clone https://github.com/tongsh6/pi-proof-forge.git /tmp/pi-proof-forge
fi
```

- [ ] **Step 3: 编译 dsh 全部 package**

```bash
cd /Users/loong/workspace/code/github/ai/dsh && pnpm -r run build
```

期望：5 个 package 编译成功，dist/ 目录生成。

- [ ] **Step 4: 对 pi-proof-forge 执行 dsh init，确认 scanner 正常工作**

```bash
cd /tmp/pi-proof-forge && \
  rm -rf .dsh && \
  npx tsx /Users/loong/workspace/code/github/ai/dsh/packages/cli/src/main.ts init --force
```

期望输出：检测到 Python 项目，自动推断验证命令。

- [ ] **Step 5: Commit（如有修改）**

```bash
git add -u
git commit -m "chore: prepare environment for benchmark execution"
```

---

### Task 2: 单独执行第一个 Fixture（手动验证闭环）

**Files:**
- Read: `packages/eval/src/fixtures/pi-bugfix-count-defs.yaml`

- [ ] **Step 1: 创建 benchmark 分支并执行 plan**

```bash
cd /tmp/pi-proof-forge && \
  git checkout main && \
  git branch -D dsh-bench-pi-bugfix-count-defs 2>/dev/null; \
  git checkout -b dsh-bench-pi-bugfix-count-defs && \
  npx tsx /Users/loong/workspace/code/github/ai/dsh/packages/cli/src/main.ts plan \
    "tools/check_v2_constraints.py 的 count_definitions() 使用 text.count(signature) 做朴素子串匹配，会将注释/docstring/字符串字面量中的 def xxx( 也统计进去，产生假阳性或假阴性。请将 count_definitions() 改为使用正则表达式 re.findall(r'^def ' + re.escape(signature), text, re.MULTILINE)，只匹配行首的 def 声明。在文件顶部添加 import re。" \
    --type bugfix
```

- [ ] **Step 2: 审查计划是否合理，然后执行 patch**

```bash
cd /tmp/pi-proof-forge && \
  npx tsx /Users/loong/workspace/code/github/ai/dsh/packages/cli/src/main.ts patch --auto
```

- [ ] **Step 3: 执行 verify**

```bash
cd /tmp/pi-proof-forge && \
  npx tsx /Users/loong/workspace/code/github/ai/dsh/packages/cli/src/main.ts verify --test
```

- [ ] **Step 4: 如果验证失败，执行 repair**

```bash
cd /tmp/pi-proof-forge && \
  npx tsx /Users/loong/workspace/code/github/ai/dsh/packages/cli/src/main.ts repair --rounds 2
```

- [ ] **Step 5: 生成 handoff**

```bash
cd /tmp/pi-proof-forge && \
  npx tsx /Users/loong/workspace/code/github/ai/dsh/packages/cli/src/main.ts handoff
```

- [ ] **Step 6: 记录结果**

人工检查：
- plan 是否合理、是否识别了正确的文件
- patch 是否正确应用、文件内容是否正确
- verify 是否通过
- 如触发 repair，修复了几轮、是否成功

- [ ] **Step 7: 重置环境**

```bash
cd /tmp/pi-proof-forge && git reset --hard && git checkout main
```

- [ ] **Step 8: 如果在验证中发现 pipeline bug，修复并 commit**

根据实际执行中暴露的问题修 bug。常见可能：
- `run-benchmark.ts` 导入路径错误
- benchmark runner 中 `@dsh/core` 动态 import 失败
- scanner 未识别 pi-proof-forge 的某些 Python 文件

---

### Task 3: 用 Benchmark Runner 批量执行全部 5 个 Fixture

**Files:**
- Modify: `run-benchmark.ts`（如有必要）

- [ ] **Step 1: 确认 run-benchmark.ts 中的导入路径正确**

```bash
cd /Users/loong/workspace/code/github/ai/dsh && \
  node -e "
    import('./packages/eval/dist/task-fixtures.js').then(m => {
      const fix = m.loadAllFixtures('./packages/eval/src/fixtures');
      const piFix = fix.filter(f => f.id.startsWith('pi-'));
      console.log('pi- fixtures:', piFix.map(f => f.id).join(', '));
    }).catch(e => console.error(e));
  "
```

- [ ] **Step 2: 运行完整 benchmark**

```bash
cd /Users/loong/workspace/code/github/ai/dsh && \
  npx tsx run-benchmark.ts 2>&1 | tee /tmp/dsh-benchmark-output.txt
```

- [ ] **Step 3: 将 benchmark 报告保存到 docs/**

```bash
cp /tmp/dsh-benchmark-output.txt /Users/loong/workspace/code/github/ai/dsh/docs/superpowers/reports/
```

先创建目录：

```bash
mkdir -p /Users/loong/workspace/code/github/ai/dsh/docs/superpowers/reports
```

- [ ] **Step 4: 分析结果，记录关键指标**

从报告中提取并记录：
- 任务完成率（completed / total）
- 首次通过率（无需 repair 即 verified 的比例）
- 修复成功率（触发 repair 后修复成功的比例）
- 平均修复轮数
- 主要失败原因分类

- [ ] **Step 5: Commit 报告**

```bash
git add docs/superpowers/reports/
git commit -m "docs(report): add first dsh benchmark report against pi-proof-forge"
```

---

## Phase 2: 扩展可执行 Fixture

### Task 4: 为 dsh 自身项目创建 TypeScript Fixture

**Files:**
- Create: `packages/eval/src/fixtures/dsh-bugfix-scanner-ts.yaml`
- Create: `packages/eval/src/fixtures/dsh-refactor-config.yaml`
- Create: `packages/eval/src/fixtures/dsh-test-scanner.yaml`

- [ ] **Step 1: 创建 dsh-bugfix-scanner-ts.yaml**

dsh 自身就是一个 TypeScript 项目，可以直接作为测试目标。scanner.ts 的 `detectTechStack` 函数在检测 TypeScript 项目时要求 `package.json` 存在且包含 `typescript` 依赖。但如果项目使用 `pnpm workspace`（如 dsh 自身），`typescript` 可能在根 `package.json` 的 `devDependencies` 中，而子包 `package.json` 中没有直接声明。

```yaml
id: dsh-bugfix-scanner-ts
description: "改进 scanner 对 pnpm workspace TypeScript 项目的检测"
category: bugfix
taskPrompt: |
  packages/repo/src/scanner.ts 的 detectTechStack 函数在检测 TypeScript 项目时的当前逻辑：
  1. 检查根目录的 package.json，看 devDependencies 或 dependencies 是否包含 "typescript"
  2. 如果没有找到，返回 { language: "unknown" }

  问题：对于 pnpm workspace 项目（如 dsh 自身），根 package.json 通常只包含 workspace 脚本配置，
  而 typescript 依赖在 tsconfig.base.json 中有引用但在根 package.json 中可能不存在。

  请改进 detectTechStack：
  1. 如果根 package.json 没有 typescript 依赖，继续检查是否存在 tsconfig.json 或 tsconfig.base.json
  2. 如果存在 tsconfig*.json 或任何 .ts/.tsx 文件在 src/ 目录中，也识别为 TypeScript 项目
  3. 添加对应的单元测试

  相关文件：packages/repo/src/scanner.ts, packages/repo/src/scanner.test.ts
expectedFiles:
  - packages/repo/src/scanner.ts
  - packages/repo/src/scanner.test.ts
expectPass: true
verificationCommands:
  - "pnpm --filter @dsh/repo test"
architectureRules:
  - 不改变 detectTechStack 的函数签名和返回值类型
  - 保持对现有项目类型（Python/Go）的检测逻辑不变
  - 新增检测方法放在现有逻辑之后，作为 fallback
maxRepairRounds: 2
```

- [ ] **Step 2: 创建 dsh-refactor-config.yaml**

```yaml
id: dsh-refactor-config
description: "将 CLI 中的 readConfig 工具函数移到 repo 包中"
category: refactor
taskPrompt: |
  当前 packages/cli/src/utils/config.ts 中有一个 readConfig 函数，它读取 .dsh/config.yml 并解析为 Record<string, unknown>。
  同时 packages/core/src/pipeline.ts 中有一个功能几乎相同的 readLocalConfig / readLocalConfigStrict 函数。

  请：
  1. 将 readConfig 的逻辑统一移到 packages/repo/src/rule-loader.ts（或新建 packages/repo/src/config-loader.ts）
  2. 导出为 loadDshConfig(cwd: string): Record<string, unknown>
  3. 更新 cli/src/utils/config.ts 改为 re-export
  4. 更新 pipeline.ts 中的 readLocalConfig/readLocalConfigStrict 改为使用新函数

  相关文件：
  - packages/repo/src/config-loader.ts (新建)
  - packages/cli/src/utils/config.ts
  - packages/core/src/pipeline.ts
expectedFiles:
  - packages/repo/src/config-loader.ts
  - packages/cli/src/utils/config.ts
  - packages/core/src/pipeline.ts
expectPass: true
verificationCommands:
  - "pnpm -r run typecheck"
  - "pnpm -r run test"
architectureRules:
  - 不改变 config.yml 的结构和解析方式
  - 保持向后兼容，现有测试必须通过
  - config-loader.ts 只放 config 读取逻辑，不混入 rule 加载
maxRepairRounds: 2
```

- [ ] **Step 3: 创建 dsh-test-scanner.yaml**

```yaml
id: dsh-test-scanner
description: "为 repo/scanner.ts 的 detectVerifyCommands 补充测试"
category: test
taskPrompt: |
  packages/repo/src/scanner.test.ts 已有对 detectTechStack 的测试覆盖，但 detectVerifyCommands 的测试不够充分。

  detectVerifyCommands 根据检测到的 TechStack 推断验证命令：
  - TypeScript/Jest 项目：test: "npx jest --no-coverage", lint: "npx eslint src/", typecheck: "npx tsc --noEmit"
  - Python/pytest 项目：test: "python3 -m pytest"
  - Go 项目：test: "go test ./..."
  - 未知项目：返回 undefined

  请为以下场景补充测试：
  1. detectVerifyCommands 对 TypeScript 项目返回三个命令
  2. detectVerifyCommands 对 Python 项目返回 pytest 命令
  3. detectVerifyCommands 对 Go 项目返回 go test 命令
  4. detectVerifyCommands 对未知语言项目返回 undefined

  保持与现有测试一致的风格（node:test + assert）。

  相关文件：packages/repo/src/scanner.test.ts
expectedFiles:
  - packages/repo/src/scanner.test.ts
expectPass: true
verificationCommands:
  - "pnpm --filter @dsh/repo test"
architectureRules:
  - 使用 node:test 和 node:assert（与现有测试一致）
  - 不修改 scanner.ts 的源代码
  - 测试命名：test detectVerifyCommands - TypeScript/Python/Go/Unknown
maxRepairRounds: 2
```

- [ ] **Step 4: 验证新 fixture 格式正确**

```bash
cd /Users/loong/workspace/code/github/ai/dsh && \
  node -e "
    import('./packages/eval/dist/task-fixtures.js').then(m => {
      const fix = m.loadAllFixtures('./packages/eval/src/fixtures');
      const dshFix = fix.filter(f => f.id.startsWith('dsh-'));
      console.log('dsh- fixtures loaded:', dshFix.map(f => f.id).join(', '));
      for (const f of dshFix) {
        console.log('  -', f.id, ':', f.category, ':', f.expectedFiles.length, 'files,', f.verificationCommands.length, 'cmds');
      }
    }).catch(e => console.error(e));
  "
```

期望：3 个 dsh-* fixture 正确加载。

- [ ] **Step 5: Commit**

```bash
git add packages/eval/src/fixtures/dsh-*.yaml
git commit -m "feat(eval): add 3 dsh self-hosted TypeScript fixtures"
```

---

### Task 5: 支持 Benchmark Runner 多 Repo 执行

**Files:**
- Modify: `packages/eval/src/benchmark-runner.ts`
- Modify: `run-benchmark.ts`

当前 `runAll` 假设所有 fixture 针对同一个 repo。需要支持每个 fixture 指定自己的 repo。

- [ ] **Step 1: 在 TaskFixture 中添加可选的 repoPath 字段**

```typescript
// packages/eval/src/task-fixtures.ts
export interface TaskFixture {
  id: string;
  description: string;
  category: "bugfix" | "feature" | "refactor" | "test" | "docs" | "failure_mode";
  taskPrompt: string;
  expectedFiles: string[];
  expectPass: boolean;
  verificationCommands: string[];
  architectureRules: string[];
  maxRepairRounds?: number;
  repoPath?: string;  // NEW: 覆盖默认 repo 路径
}
```

- [ ] **Step 2: 更新 run-benchmark.ts 支持多 repo**

```typescript
// run-benchmark.ts
import { DeepSeekClient } from "./packages/provider/dist/client.js";
import { loadAllFixtures } from "./packages/eval/dist/task-fixtures.js";
import { runTask, formatEvaluationReport } from "./packages/eval/dist/benchmark-runner.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "packages/eval/src/fixtures");
const defaultRepo = "/tmp/pi-proof-forge";
const dshRepo = __dirname; // dsh 自身作为测试目标

const allFixtures = loadAllFixtures(fixturesDir);
const benchFixtures = allFixtures
  .filter((f) => f.id.startsWith("pi-") || f.id.startsWith("dsh-"))
  .sort((a, b) => a.id.localeCompare(b.id));

console.log(`Loaded ${benchFixtures.length} fixtures:`);
benchFixtures.forEach((f) => console.log(`  - ${f.id}: ${f.category}`));
console.log();

const client = DeepSeekClient.fromEnv();
const startTime = Date.now();

const results = [];
for (const fixture of benchFixtures) {
  const repoPath = fixture.repoPath ?? (fixture.id.startsWith("dsh-") ? dshRepo : defaultRepo);
  console.log(`\n=== Running ${fixture.id} on ${path.basename(repoPath)} ===\n`);
  const result = await runTask(fixture, repoPath, client);
  results.push(result);
  console.log(`  → ${result.testsPassed ? "PASS" : "FAIL"} (${(result.durationMs / 1000).toFixed(1)}s)`);
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
const report = formatEvaluationReport(results);
console.log("\n" + report);
console.log(`\nTotal time: ${elapsed}s`);
```

- [ ] **Step 3: 在 benchmark runner 中支持 fixture.repoPath**

在 `runTask` 函数中，使用 `fixture.repoPath ?? repoPath` 作为实际路径。

- [ ] **Step 4: 验证多 repo 支持**

```bash
cd /Users/loong/workspace/code/github/ai/dsh && \
  npx tsx run-benchmark.ts 2>&1 | head -50
```

期望：能正确区分 pi-* 用 pi-proof-forge，dsh-* 用 dsh 自身 repo。

- [ ] **Step 5: Commit**

```bash
git add packages/eval/src/task-fixtures.ts packages/eval/src/benchmark-runner.ts run-benchmark.ts
git commit -m "feat(eval): support multi-repo benchmark execution"
```

---

## Phase 3: Search/Replace 回退策略（v0.3 协议）✅ 已完成

### Task 6: 在 patch-parser 中实现 Search/Replace 块解析

**Files:**
- Modify: `packages/core/src/patch-parser.ts`
- Modify: `packages/core/src/patch-parser.test.ts`

参考 spec §7.3.4，实现 `<PATCH type="search">` 块解析。Search/Replace 格式：

```xml
<PATCH type="search">
<<<<<<< SEARCH
原始代码块（精确匹配）
=======
替换后的代码块
>>>>>>> REPLACE
</PATCH>
```

- [ ] **Step 1: 在 patch-parser.ts 中新增 extractSearchReplaceBlocks 函数**

```typescript
// packages/core/src/patch-parser.ts 追加

export interface SearchReplaceBlock {
  filePath: string;
  search: string;
  replace: string;
}

/**
 * 从响应中提取 SEARCH/REPLACE 块。
 * 格式：<PATCH type="search" file="path/to/file">
 * <<<<<<< SEARCH
 * original code
 * =======
 * replacement code
 * >>>>>>> REPLACE
 * </PATCH>
 */
export function extractSearchReplaceBlocks(response: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  // 匹配 <PATCH type="search" file="path">
  const blockRegex = /<PATCH\s+type="search"\s+file="([^"]+)"\s*>([\s\S]*?)<\/PATCH>/g;
  let match: RegExpExecArray | null;
  
  while ((match = blockRegex.exec(response)) !== null) {
    const filePath = match[1]?.trim();
    const body = match[2] ?? "";
    
    if (!filePath) continue;
    
    const srMatch = body.match(/<<<<<<< SEARCH\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> REPLACE/);
    if (!srMatch) continue;
    
    const search = srMatch[1] ?? "";
    const replace = srMatch[2] ?? "";
    
    blocks.push({ filePath, search, replace });
  }
  
  return blocks;
}
```

- [ ] **Step 2: 实现 applySearchReplace 函数**

```typescript
export function applySearchReplace(
  cwd: string,
  blocks: SearchReplaceBlock[],
  dryRun: boolean = false,
): { success: boolean; files: string[]; error?: string } {
  const changedFiles: string[] = [];
  
  for (const block of blocks) {
    const absPath = path.join(cwd, block.filePath);
    
    // Path safety check
    if (path.isAbsolute(block.filePath) || block.filePath.includes("..")) {
      return { 
        success: false, 
        files: changedFiles, 
        error: `Unsafe path rejected: ${block.filePath}` 
      };
    }
    
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch {
      return { 
        success: false, 
        files: changedFiles, 
        error: `Cannot read ${block.filePath}` 
      };
    }
    
    // Exact match
    if (!content.includes(block.search)) {
      return { 
        success: false, 
        files: changedFiles, 
        error: `Search block not found in ${block.filePath}` 
      };
    }
    
    // Replace only the FIRST occurrence (safe, predictable)
    const newContent = content.replace(block.search, block.replace);
    
    if (!dryRun) {
      fs.writeFileSync(absPath, newContent, "utf-8");
    }
    
    changedFiles.push(block.filePath);
  }
  
  return { success: true, files: changedFiles };
}
```

- [ ] **Step 3: 更新 ParsedChanges 和 parseChanges 支持 Search/Replace**

```typescript
// 更新 ParsedChanges interface，添加：
export interface ParsedChanges {
  creates: CreateBlock[];
  renames: RenameBlock[];
  patchText: string | null;
  patchFiles: string[];
  hunks: HunkInfo[];
  deletePaths: string[];
  searchReplaceBlocks: SearchReplaceBlock[];  // NEW
}

// parseChanges 中添加：
export function parseChanges(response: string): ParsedChanges {
  const creates = extractCreateBlocks(response);
  const renames = extractRenameBlocks(response);
  const patchText = extractPatchBlock(response);
  const deletePaths = extractDeleteBlocks(response);
  const searchReplaceBlocks = extractSearchReplaceBlocks(response);  // NEW

  // ... existing validations ...
  
  // Validate: at least one operation
  if (creates.length === 0 && renames.length === 0 && !patchText && deletePaths.length === 0 && searchReplaceBlocks.length === 0) {
    throw new PatchParseError(
      "No <CREATE>, <RENAME>, <PATCH>, <DELETE>, or <PATCH type=\"search\"> blocks found in response",
    );
  }
  
  return {
    creates,
    renames,
    patchText,
    patchFiles: patchText ? parsePatchFiles(patchText) : [],
    hunks: patchText ? parseHunks(patchText) : [],
    deletePaths,
    searchReplaceBlocks,  // NEW
  };
}
```

- [ ] **Step 4: 更新 applyChanges 执行 Search/Replace**

```typescript
// 在 applyChanges 中添加 Search/Replace 处理（在 diff patch 之前执行）
export function applyChanges(
  cwd: string,
  changes: ParsedChanges,
  dryRun: boolean = false,
): ApplyChangesResult {
  // ... existing CREATE / RENAME / DELETE ...

  // Apply Search/Replace (before PATCH)
  if (changes.searchReplaceBlocks.length > 0) {
    const result = applySearchReplace(cwd, changes.searchReplaceBlocks, dryRun);
    if (!result.success) {
      return { success: false, createdFiles, renamedFiles, patchedFiles, deletedFiles, error: result.error };
    }
    // Track files changed by search/replace
    patchedFiles.push(...result.files);
  }

  // Apply PATCH block (existing)
  // ...
}
```

- [ ] **Step 5: 编写单元测试**

在 `patch-parser.test.ts` 中添加：

```typescript
import { extractSearchReplaceBlocks, applySearchReplace } from "./patch-parser.js";

const SEARCH_REPLACE_RESPONSE = `
<PLAN>Fix the validate function</PLAN>
<FILES>- src/utils.ts</FILES>
<PATCH type="search" file="src/utils.ts">
<<<<<<< SEARCH
function validate(input: string) {
  if (!input) {
    return false;
  }
  return true;
}
=======
function validate(input: string): boolean {
  if (!input || input.trim().length === 0) {
    return false;
  }
  return true;
}
>>>>>>> REPLACE
</PATCH>
<VERIFY>npx jest</VERIFY>
<RISKS>- None</RISKS>
`;

describe("extractSearchReplaceBlocks", () => {
  it("extracts SEARCH/REPLACE blocks from response", () => {
    const blocks = extractSearchReplaceBlocks(SEARCH_REPLACE_RESPONSE);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].filePath, "src/utils.ts");
    assert.ok(blocks[0].search.includes("function validate"));
    assert.ok(blocks[0].replace.includes(": boolean"));
  });

  it("returns empty array when no SEARCH/REPLACE blocks", () => {
    const blocks = extractSearchReplaceBlocks("no search replace here");
    assert.equal(blocks.length, 0);
  });
});

describe("applySearchReplace", () => {
  it("applies search/replace to a file", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-sr-test-"));
    try {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "src", "utils.ts"),
        "function validate(input: string) {\n  if (!input) {\n    return false;\n  }\n  return true;\n}\n",
        "utf-8",
      );

      const blocks = extractSearchReplaceBlocks(SEARCH_REPLACE_RESPONSE);
      const result = applySearchReplace(tmp, blocks, false);
      
      assert.ok(result.success);
      const modified = fs.readFileSync(path.join(tmp, "src", "utils.ts"), "utf-8");
      assert.ok(modified.includes(": boolean"));
      assert.ok(modified.includes("trim().length === 0"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns error when search not found in file", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-sr-test-"));
    try {
      fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "src", "utils.ts"),
        "completely different content\n",
        "utf-8",
      );

      const blocks = extractSearchReplaceBlocks(SEARCH_REPLACE_RESPONSE);
      const result = applySearchReplace(tmp, blocks, false);
      
      assert.ok(!result.success);
      assert.ok(result.error?.includes("Search block not found"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 6: 运行测试**

```bash
pnpm --filter @dsh/core test
```

期望：新增 Search/Replace 相关测试通过（约 3-4 个新测试）。

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/patch-parser.ts packages/core/src/patch-parser.test.ts
git commit -m "feat(core): add SEARCH/REPLACE block extraction and application"
```

---

### Task 7: 在 prompt-builder 中告知模型 Search/Replace 回退格式

**Files:**
- Modify: `packages/core/src/prompt-builder.ts`

- [ ] **Step 1: 更新 system prompt 中的协议说明**

在 `buildSystemPrompt` 中，将文件操作协议部分更新为包含 Search/Replace：

```typescript
const PROTOCOL_SECTION = `
## Protocol v0.3
Your response MUST contain these blocks in order:
<PLAN>...</PLAN>
<FILES>...</FILES>

For NEW files:
<CREATE path="relative/path">complete file content</CREATE>

For EXISTING files (preferred: unified diff):
<PATCH>
--- a/file
+++ b/file
@@ -l,s +l,s @@
 context line
+added line
-removed line
</PATCH>

For EXISTING files (fallback: search/replace — use when diff is too complex):
<PATCH type="search" file="path/to/file">
<<<<<<< SEARCH
exact code to find in the file
=======
replacement code
>>>>>>> REPLACE
</PATCH>

For DELETING files:
<DELETE path="relative/path" />

<VERIFY>commands to run</VERIFY>
<RISKS>- risks</RISKS>
`;
```

- [ ] **Step 2: 验证 typecheck**

```bash
pnpm --filter @dsh/core typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/prompt-builder.ts
git commit -m "feat(core): add SEARCH/REPLACE format to system prompt protocol"
```

---

### Task 8: 在 failure-detector 中新增 search-replace 故障检测

**Files:**
- Modify: `packages/core/src/failure-detector.ts`
- Modify: `packages/core/src/failure-detector.test.ts`

- [ ] **Step 1: 添加 search-replace-mismatch 故障模式**

在 `FAILURE_PATTERNS` 中添加：

```typescript
{
  id: "search-replace-mismatch",
  description: "SEARCH block does not match actual file content",
  detect: (params: DetectParams): boolean => {
    return params.patchApplyError?.includes("Search block not found") ?? false;
  },
  repairHint: [
    "SEARCH block did not match the actual file content. Read the file again to get current content, then write a correct SEARCH block.",
    "Make sure the SEARCH block has EXACT whitespace — tabs/spaces, trailing spaces, and blank lines must match perfectly.",
    "Try copying the relevant section from the actual file directly.",
  ].join("\n"),
}
```

- [ ] **Step 2: 编写测试**

```typescript
it("detects search-replace mismatch", () => {
  const detections = detectFailures({
    response: "",
    planFiles: [],
    actualChangedFiles: [],
    verifyOutput: null,
    patchApplyError: "Search block not found in src/utils.ts",
  });
  const hasSearchMismatch = detections.some((d) => d.id === "search-replace-mismatch");
  assert.ok(hasSearchMismatch);
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter @dsh/core test
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/failure-detector.ts packages/core/src/failure-detector.test.ts
git commit -m "feat(core): add search-replace-mismatch failure detection pattern"
```

---

### Task 9: 更新 repair-loop 支持 Search/Replace 回退

**Files:**
- Modify: `packages/core/src/repair-loop.ts`

当 diff patch 失败后，repair-loop 应该提示模型尝试 Search/Replace 而非仅重试 diff。

- [ ] **Step 1: 在 repair-loop 的 repairConstraints 中追加 Search/Replace 提示**

在第 74 行附近，将现有的修复约束增加第 8 条：

```typescript
const repairConstraints = [
  "CRITICAL REPAIR RULES:",
  "1. Make the SMALLEST possible change to fix the failure — change as few lines as possible.",
  "2. NEVER delete or modify existing imports unless they are directly causing the test failure.",
  "3. NEVER add new functions, classes, or variables that were not part of the original task.",
  "4. NEVER restructure or reformat code that is unrelated to the failure.",
  "5. ONLY fix the specific error in the verify output. Do not make additional improvements.",
  "6. If the original patch was wrong, revert to the original code and try a different minimal approach.",
  "7. Preserve ALL existing code that is not related to the error. Every deleted line must be justified by the verify failure output.",
  "8. If unified diff failed to apply, use <PATCH type=\"search\" file=\"path\"> with SEARCH/REPLACE blocks instead. This gives you exact string matching and avoids line-number errors.",
].join("\n");
```

- [ ] **Step 2: 在 repair-loop 中添加 apply 回退逻辑**

在 `runRepairLoop` 的 apply 部分（第 108-122 行附近），实现如果 diff 失败则自动尝试 search/replace：

```typescript
try {
  const changes = parseChanges(content);
  
  // ... existing apply logic ...
  
  // NEW: If composite apply fails, try individual operations
  if (!applyResult.success && changes.searchReplaceBlocks.length === 0) {
    // No SEARCH/REPLACE blocks — suggest in next round
    applyError = applyResult.error ?? "unknown apply error";
  }
} catch (e) {
  applyError = e instanceof Error ? e.message : String(e);
}
```

- [ ] **Step 3: 运行现有测试确保不破坏已有功能**

```bash
pnpm --filter @dsh/core test
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/repair-loop.ts
git commit -m "feat(core): add SEARCH/REPLACE fallback guidance in repair loop"
```

---

## Phase 4: 全量回归验证

### Task 10: 全量 typecheck + test + benchmark

- [ ] **Step 1: 运行全量 typecheck**

```bash
pnpm -r run typecheck
```

期望：5 个 package 全部通过。

- [ ] **Step 2: 运行全量测试**

```bash
pnpm -r run test
```

期望：所有测试通过（provider 21 + repo 22 + core ~40 + eval 12 + cli 23 ≈ 118 tests）。

- [ ] **Step 3: 运行 benchmark 收集最终数据**

```bash
cd /Users/loong/workspace/code/github/ai/dsh && \
  npx tsx run-benchmark.ts 2>&1 | tee /tmp/dsh-benchmark-final.txt
```

- [ ] **Step 4: 对比两次 benchmark 结果**

对比 Phase 1（v0.2 协议）和 Phase 4（v0.3 协议 + 新 fixture）的结果差异，记录 Search/Replace 回退是否提升了完成率。

- [ ] **Step 5: 最终 commit**

```bash
git add -A
git commit -m "chore: final regression verification for v0.3 protocol upgrade"
```

---

## 成功标准

- [ ] 5 个 pi-* fixture 在真实 DeepSeek API 上至少 3 个首次通过（完成率 >= 60%）
- [ ] 至少 1 个 fixture 成功触发 repair loop 并修复
- [ ] 产出第一份 DSH Evaluation Report（markdown）
- [ ] 新增 3+ 个针对 dsh 自身的 TypeScript fixture
- [ ] Search/Replace 解析 + 应用 + 故障检测完整实现
- [ ] `pnpm -r run typecheck` 全部通过
- [ ] `pnpm -r run test` 全部通过（预计 118+ tests）
- [ ] Search/Replace 回退在至少 1 个 repair 场景中被有效使用
