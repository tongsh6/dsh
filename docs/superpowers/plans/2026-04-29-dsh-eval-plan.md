# DSH Phase 5-6 Eval System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建可复用的 pipeline API + 自动化 benchmark runner + 5 个 pi-proof-forge fixture + 评测报告

**Architecture:** 从 CLI 命令中抽取 pipeline.ts 纯函数层 (Plan → Patch → Verify → Repair → Handoff)，CLI 改为薄封装。benchmark runner 通过 git branch 隔离每个 fixture 执行完整闭环，收集 10 维评分并生成 markdown 报告。

**Tech Stack:** TypeScript ESM, Node.js >= 18, pnpm workspace, cac CLI, zod schema, diff library, child_process execSync

---

## 文件映射

| 文件 | 职责 |
|------|------|
| `packages/core/src/pipeline.ts` | 新增。runPlan/runPatch/runVerify/runRepair/runHandoff/runFullPipeline |
| `packages/core/src/pipeline.test.ts` | 新增。mock DeepSeekClient 验证每个函数 |
| `packages/core/src/index.ts` | 修改。新增 pipeline 导出 |
| `packages/cli/src/commands/plan.ts` | 重构。改为 pipeline.runPlan 薄封装 |
| `packages/cli/src/commands/patch.ts` | 重构。改为 pipeline.runPatch 薄封装 |
| `packages/cli/src/commands/verify.ts` | 重构。改为 pipeline.runVerify 薄封装 |
| `packages/cli/src/commands/repair.ts` | 重构。改为 pipeline.runRepair 薄封装 |
| `packages/cli/src/commands/handoff.ts` | 重构。改为 pipeline.runHandoff 薄封装 |
| `packages/eval/src/benchmark-runner.ts` | 重写。保留评分函数，新增 runTask/runAll/formatEvaluationReport |
| `packages/eval/src/benchmark-runner.test.ts` | 重写。测试 runTask/runAll/formatEvaluationReport |
| `packages/eval/src/fixtures/pi-*.yaml` | 5 个新 fixture |

---

### Task 1: pipeline.ts — 类型定义与框架

**Files:**
- Create: `packages/core/src/pipeline.ts`

- [ ] **Step 1: 创建 pipeline.ts，定义类型和函数签名**

```typescript
import type { DeepSeekClient } from "@dsh/provider";
import { classify } from "@dsh/provider";
import type { ContextLayers } from "./context-builder.js";
import { assembleContext, buildDynamicContext } from "./context-builder.js";
import { buildMessages } from "./prompt-builder.js";
import {
  extractPlanBlock,
  extractFilesBlock,
  extractRisksBlock,
  parsePatch,
  applyPatch,
} from "./patch-parser.js";
import { runVerify, isAllPassed, formatResults } from "./verifier.js";
import { runRepairLoop } from "./repair-loop.js";
import type { RepairRoundResult } from "./repair-loop.js";
import {
  createTaskState,
  readTaskState,
  writeTaskState,
  transition,
} from "./task-state.js";
import type { TaskState } from "./task-state.js";
import { writeHandoff } from "./handoff-writer.js";
import { readConfig } from "../../cli/src/utils/config.js";
import {
  loadRuleContents,
  detectTechStack,
  generateRepoContext,
  rankFiles,
  loadTopFiles,
  scanProjectFiles,
} from "@dsh/repo";

// ---- Types ----

export interface PipelineBase {
  cwd: string;
  client: DeepSeekClient;
}

export interface PlanParams extends PipelineBase {
  description: string;
  taskType: "bugfix" | "feature" | "refactor" | "test" | "docs";
}

export interface PatchParams extends PipelineBase {
  auto?: boolean;
  dryRun?: boolean;
}

export interface VerifyParams extends PipelineBase {
  test?: boolean;
  lint?: boolean;
  typecheck?: boolean;
}

export interface RepairParams extends PipelineBase {
  maxRounds?: number;
  onRound?: (round: number, result: RepairRoundResult) => void;
}

export interface HandoffParams extends PipelineBase {
  format?: "markdown" | "json";
  outputDir?: string;
}

export interface FullPipelineParams extends PipelineBase {
  description: string;
  taskType: "bugfix" | "feature" | "refactor" | "test" | "docs";
  auto?: boolean;
  maxRepairRounds?: number;
}

// ---- Internal helpers ----

async function buildLayers(cwd: string, description: string): Promise<ContextLayers> {
  const config = readConfig(cwd);
  const rules = loadRuleContents(cwd);
  const stack = detectTechStack(cwd);
  const repoContext = generateRepoContext(cwd, stack);

  const state = createTaskState(description, "feature");
  const allFiles = await scanProjectFiles(cwd);
  const ranked = rankFiles(description, allFiles);
  const taskFiles = loadTopFiles(cwd, ranked, 10);

  return assembleContext({ config, rules, repoContext, taskState: state, taskFiles });
}

// ---- Exported functions (stubs for now) ----

export async function runPlan(params: PlanParams): Promise<TaskState> {
  throw new Error("not implemented");
}

export async function runPatch(params: PatchParams): Promise<TaskState> {
  throw new Error("not implemented");
}

export async function runVerify(params: VerifyParams): Promise<TaskState> {
  throw new Error("not implemented");
}

export async function runRepair(params: RepairParams): Promise<TaskState> {
  throw new Error("not implemented");
}

export async function runHandoff(params: HandoffParams): Promise<string> {
  throw new Error("not implemented");
}

export async function runFullPipeline(params: FullPipelineParams): Promise<TaskState> {
  throw new Error("not implemented");
}
```

- [ ] **Step 2: 验证 typecheck**

```bash
pnpm -r run typecheck
```

期望：`packages/core` typecheck 通过（函数 stub 编译正确）。

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/pipeline.ts
git commit -m "feat(pipeline): add type definitions and skeleton for pipeline API"
```

---

### Task 2: pipeline.ts — runPlan 实现

**Files:**
- Modify: `packages/core/src/pipeline.ts`

- [ ] **Step 1: 实现 runPlan**

替换 Task 1 中的 stub：

```typescript
export async function runPlan(params: PlanParams): Promise<TaskState> {
  const { cwd, client, description, taskType } = params;

  // 读取或创建 task state
  let state = readTaskState(cwd);
  if (!state || state.task.description !== description) {
    state = createTaskState(description, taskType);
    writeTaskState(cwd, state);
  }

  // 构建上下文
  const layers = await buildLayers(cwd, description);

  // 路由
  const target = classify({ command: "plan" });

  // 调用 DeepSeek
  const messages = buildMessages({ context: layers, taskDescription: description });
  const response = await client.chat({
    model: target.model,
    messages,
    thinking: target.thinking,
  });

  const content = response.choices[0]?.message.content ?? "";

  // 解析响应
  const planRaw = extractPlanBlock(content);
  const files = extractFilesBlock(content);
  const risks = extractRisksBlock(content);

  if (!planRaw) {
    throw new Error("DeepSeek 未返回有效的 PLAN 块");
  }

  // 更新 state
  state.plan = {
    summary: planRaw.split("\n")[0]?.replace(/^#+\s*/, "") ?? description,
    files,
    risks,
    raw_xml: planRaw,
  };
  state = transition(state, "planned");
  writeTaskState(cwd, state);

  return state;
}
```

- [ ] **Step 2: 编写 runPlan 单元测试**

创建 `packages/core/src/pipeline.test.ts`：

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runPlan } from "./pipeline.js";
import type { DeepSeekClient } from "@dsh/provider";

// Mock DeepSeekClient
function mockClient(responseContent: string): DeepSeekClient {
  return {
    chat: async () => ({
      id: "test-id",
      object: "chat.completion",
      created: Date.now(),
      model: "deepseek-v4-pro",
      choices: [{
        index: 0,
        message: { role: "assistant" as const, content: responseContent },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }),
    chatStream: async function* () { yield undefined as any; },
  } as unknown as DeepSeekClient;
}

const VALID_PLAN_RESPONSE = `
<PLAN>
## Goal
Fix the count_definitions function

## Files Involved
- tools/check_v2_constraints.py

## Strategy
Replace str.count with re.findall
</PLAN>

<FILES>
- tools/check_v2_constraints.py
</FILES>

<RISKS>
- Regex might be slightly slower
- Edge case: multi-line def signatures
</RISKS>
`;

describe("runPlan", () => {
  it("generates a plan and transitions state to planned", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      // Setup minimal .dsh config
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      const yaml = await import("js-yaml");
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({ project: { name: "test", language: "python" }, verify: {}, rules: { files: [] }, deepseek: {} }),
        "utf-8",
      );

      // Create a dummy Python file so scanner detects something
      fs.writeFileSync(path.join(tmp, "dummy.py"), "# test", "utf-8");

      const client = mockClient(VALID_PLAN_RESPONSE);
      const state = await runPlan({
        cwd: tmp,
        client,
        description: "Fix count_definitions bug",
        taskType: "bugfix",
      });

      assert.equal(state.status, "planned");
      assert.ok(state.plan);
      assert.equal(state.plan.files.length, 1);
      assert.equal(state.task.type, "bugfix");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when response has no PLAN block", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      const yaml = await import("js-yaml");
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({ project: { name: "test", language: "python" }, verify: {}, rules: { files: [] }, deepseek: {} }),
        "utf-8",
      );
      fs.writeFileSync(path.join(tmp, "dummy.py"), "# test", "utf-8");

      const client = mockClient("No plan here");
      await assert.rejects(
        () => runPlan({ cwd: tmp, client, description: "test", taskType: "bugfix" }),
        /未返回有效的 PLAN 块/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter @dsh/core test
```

期望：2 个 runPlan 测试通过。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pipeline.ts packages/core/src/pipeline.test.ts
git commit -m "feat(pipeline): implement runPlan with tests"
```

---

### Task 3: pipeline.ts — runPatch 实现

**Files:**
- Modify: `packages/core/src/pipeline.ts`
- Modify: `packages/core/src/pipeline.test.ts`

- [ ] **Step 1: 实现 runPatch**

```typescript
export async function runPatch(params: PatchParams): Promise<TaskState> {
  const { cwd, client, auto, dryRun } = params;

  const state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");
  if (state.status !== "planned" && state.status !== "repairing") {
    throw new Error(`当前状态为 ${state.status}，需要 planned 或 repairing`);
  }

  // 构建上下文
  const layers = await buildLayers(cwd, state.task.description);

  // 动态上下文
  const dynamic = buildDynamicContext(state.patches, state.verify_results, 2);
  const fullLayers = { ...layers, dynamic };

  // 路由
  const fileCount = state.plan?.files?.length ?? 0;
  const target = classify({ command: "patch", fileCount });

  // 调用 DeepSeek
  const messages = buildMessages({ context: fullLayers, taskDescription: state.task.description });
  const response = await client.chat({
    model: target.model,
    messages,
    thinking: target.thinking,
  });

  const content = response.choices[0]?.message.content ?? "";
  const parsed = parsePatch(content);

  // dry-run 和 apply
  if (!dryRun) {
    const result = applyPatch(cwd, parsed.patchText, false);
    if (!result.success) {
      throw new Error(`patch 应用失败 — ${result.error}`);
    }

    state.patches.push({
      round: (state.repair_rounds ?? 0) + 1,
      patch: parsed.patchText,
      apply_status: "ok",
      files_changed: result.files,
    });
    state = transition(state, "patched");
    writeTaskState(cwd, state);
  }

  return state;
}
```

- [ ] **Step 2: 编写 runPatch 测试**

在 `pipeline.test.ts` 中添加：

```typescript
const VALID_PATCH_RESPONSE = `
<PLAN>
## Goal
Fix bug
## Files Involved
- dummy.py
## Strategy
Fix it
</PLAN>

<FILES>
- dummy.py
</FILES>

<PATCH>
--- a/dummy.py
+++ b/dummy.py
@@ -1 +1,2 @@
 # test
+# fixed
</PATCH>

<VERIFY>
echo ok
</VERIFY>

<RISKS>
- Minor risk
</RISKS>
`;

describe("runPatch", () => {
  it("applies patch and transitions to patched", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      const yaml = await import("js-yaml");
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({ project: { name: "test", language: "python" }, verify: {}, rules: { files: [] }, deepseek: {} }),
        "utf-8",
      );
      // 写入 planned state
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "planned",
          task: { description: "Fix bug", type: "bugfix", created_at: new Date().toISOString() },
          plan: { summary: "Fix bug", files: ["dummy.py"], risks: [], raw_xml: "<PLAN>Fix bug</PLAN>" },
          patches: [],
          verify_results: [],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );
      fs.writeFileSync(path.join(tmp, "dummy.py"), "# test", "utf-8");

      const client = mockClient(VALID_PATCH_RESPONSE);
      const state = await runPatch({ cwd: tmp, client, auto: true });

      assert.equal(state.status, "patched");
      assert.equal(state.patches.length, 1);
      assert.equal(state.patches[0].apply_status, "ok");
      assert.ok(state.patches[0].files_changed.includes("dummy.py"));

      // 验证文件确实被修改了
      const modified = fs.readFileSync(path.join(tmp, "dummy.py"), "utf-8");
      assert.ok(modified.includes("# fixed"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when status is not planned", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "init",
          task: { description: "Fix bug", type: "bugfix", created_at: new Date().toISOString() },
          patches: [],
          verify_results: [],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );

      const client = mockClient(VALID_PATCH_RESPONSE);
      await assert.rejects(
        () => runPatch({ cwd: tmp, client }),
        /需要 planned 或 repairing/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter @dsh/core test
```

期望：runPlan 2 个 + runPatch 2 个 = 4 个新测试通过。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pipeline.ts packages/core/src/pipeline.test.ts
git commit -m "feat(pipeline): implement runPatch with tests"
```

---

### Task 4: pipeline.ts — runVerify 实现

**Files:**
- Modify: `packages/core/src/pipeline.ts`
- Modify: `packages/core/src/pipeline.test.ts`

- [ ] **Step 1: 实现 runVerify**

```typescript
export async function runVerify(params: VerifyParams): Promise<TaskState> {
  const { cwd, test, lint, typecheck } = params;

  let state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");
  if (state.status !== "patched" && state.status !== "repairing") {
    throw new Error(`当前状态为 ${state.status}，需要 patched`);
  }

  const config = readConfig(cwd);
  const verifyConfig = config.verify as Record<string, string> | undefined;
  const commands: string[] = [];

  if (test) commands.push(verifyConfig?.test ?? "");
  if (lint) commands.push(verifyConfig?.lint ?? "");
  if (typecheck) commands.push(verifyConfig?.typecheck ?? "");

  // 如果没指定 filter，默认跑全部
  if (!test && !lint && !typecheck) {
    if (verifyConfig?.test) commands.push(verifyConfig.test);
    if (verifyConfig?.lint) commands.push(verifyConfig.lint);
    if (verifyConfig?.typecheck) commands.push(verifyConfig.typecheck);
  }

  const validCommands = commands.filter((c) => c && c.trim());
  if (validCommands.length === 0) {
    throw new Error("没有配置验证命令。请检查 .dsh/config.yml");
  }

  const results = runVerify(validCommands, cwd);
  const round = (state.verify_results?.length ?? 0) + 1;
  state.verify_results.push({ round, results });

  state = transition(state, isAllPassed(results) ? "verified" : "verification_failed");
  writeTaskState(cwd, state);

  return state;
}
```

- [ ] **Step 2: 编写 runVerify 测试**

在 `pipeline.test.ts` 中添加：

```typescript
describe("runVerify", () => {
  it("transitions to verified when all checks pass", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      const yaml = await import("js-yaml");
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "python" },
          verify: { test: "echo ok" },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "patched",
          task: { description: "test", type: "bugfix", created_at: new Date().toISOString() },
          patches: [{ round: 1, patch: "", apply_status: "ok", files_changed: ["dummy.py"] }],
          verify_results: [],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );

      const client = undefined as any; // verify doesn't use client
      const state = await runVerify({ cwd: tmp, client });

      assert.equal(state.status, "verified");
      assert.equal(state.verify_results.length, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("transitions to verification_failed on failure", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      const yaml = await import("js-yaml");
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "python" },
          verify: { test: "exit 1" },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "patched",
          task: { description: "test", type: "bugfix", created_at: new Date().toISOString() },
          patches: [{ round: 1, patch: "", apply_status: "ok", files_changed: ["dummy.py"] }],
          verify_results: [],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );

      const client = undefined as any;
      const state = await runVerify({ cwd: tmp, client });

      assert.equal(state.status, "verification_failed");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter @dsh/core test
```

期望：runPlan 2 + runPatch 2 + runVerify 2 = 6 个新测试通过。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pipeline.ts packages/core/src/pipeline.test.ts
git commit -m "feat(pipeline): implement runVerify with tests"
```

---

### Task 5: pipeline.ts — runRepair 实现

**Files:**
- Modify: `packages/core/src/pipeline.ts`
- Modify: `packages/core/src/pipeline.test.ts`

- [ ] **Step 1: 实现 runRepair**

```typescript
export async function runRepair(params: RepairParams): Promise<TaskState> {
  const { cwd, client, maxRounds = 3, onRound } = params;

  let state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");
  if (state.status !== "verification_failed") {
    throw new Error(`当前状态为 ${state.status}，需要 verification_failed`);
  }

  // 构建稳定上下文层
  const layers = await buildLayers(cwd, state.task.description);

  // 补充 verify_commands 到 plan
  const config = readConfig(cwd);
  const verifyConfig = config.verify as Record<string, string> | undefined;
  if (verifyConfig && state.plan) {
    const commands = [verifyConfig.test, verifyConfig.lint, verifyConfig.typecheck]
      .filter((c): c is string => typeof c === "string" && c.length > 0);
    state.plan = { ...state.plan, verify_commands: commands };
  }

  const finalState = await runRepairLoop(state, {
    client,
    cwd,
    maxRounds,
    contextLayers: layers,
    onRound,
  });

  return finalState;
}
```

- [ ] **Step 2: 编写 runRepair 测试**

在 `pipeline.test.ts` 中添加：

```typescript
describe("runRepair", () => {
  it("rejects when status is not verification_failed", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "planned",
          task: { description: "test", type: "bugfix", created_at: new Date().toISOString() },
          patches: [],
          verify_results: [],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );

      const client = undefined as any;
      await assert.rejects(
        () => runRepair({ cwd: tmp, client }),
        /需要 verification_failed/,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("runs repair loop and returns verified state on success", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      const yaml = await import("js-yaml");
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "python" },
          verify: { test: "echo ok" },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "verification_failed",
          task: { description: "test", type: "bugfix", created_at: new Date().toISOString() },
          plan: { summary: "test", files: ["dummy.py"], risks: [], raw_xml: "<PLAN>test</PLAN>" },
          patches: [{ round: 1, patch: "", apply_status: "ok", files_changed: ["dummy.py"] }],
          verify_results: [{ round: 1, results: [{ command: "exit 1", status: "failed", exit_code: 1, output: "fail", duration_ms: 10 }] }],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );
      fs.writeFileSync(path.join(tmp, "dummy.py"), "# test", "utf-8");

      const client = mockClient(VALID_PATCH_RESPONSE);
      const state = await runRepair({ cwd: tmp, client, maxRounds: 1 });

      assert.equal(state.status, "verified");
      assert.ok(state.repair_rounds >= 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm --filter @dsh/core test
```

期望：runPlan 2 + runPatch 2 + runVerify 2 + runRepair 2 = 8 个新测试通过。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pipeline.ts packages/core/src/pipeline.test.ts
git commit -m "feat(pipeline): implement runRepair with tests"
```

---

### Task 6: pipeline.ts — runHandoff 与 runFullPipeline 实现

**Files:**
- Modify: `packages/core/src/pipeline.ts`
- Modify: `packages/core/src/pipeline.test.ts`

- [ ] **Step 1: 实现 runHandoff**

```typescript
export async function runHandoff(params: HandoffParams): Promise<string> {
  const { cwd, format = "markdown", outputDir } = params;

  const state = readTaskState(cwd);
  if (!state) throw new Error("尚未初始化。请先运行 dsh init");

  const filePath = writeHandoff(state, cwd, format, outputDir);
  return filePath;
}
```

- [ ] **Step 2: 实现 runFullPipeline**

```typescript
export async function runFullPipeline(params: FullPipelineParams): Promise<TaskState> {
  const { cwd, client, description, taskType, auto = true, maxRepairRounds = 3 } = params;

  // 1. Plan
  let state = await runPlan({ cwd, client, description, taskType });

  // 2. Patch
  state = await runPatch({ cwd, client, auto });

  // 3. Verify
  try {
    state = await runVerify({ cwd, client });
  } catch (e) {
    // 如果 verify 命令未配置，跳过 verify
    if (e instanceof Error && e.message.includes("没有配置验证命令")) {
      return state;
    }
    throw e;
  }

  // 4. Repair (if needed)
  if (state.status === "verification_failed") {
    state = await runRepair({ cwd, client, maxRounds: maxRepairRounds });
  }

  // 5. Handoff
  await runHandoff({ cwd });

  return state;
}
```

- [ ] **Step 3: 编写 runHandoff 和 runFullPipeline 测试**

在 `pipeline.test.ts` 中添加：

```typescript
describe("runHandoff", () => {
  it("generates handoff file and returns path", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".dsh", "task-state.json"),
        JSON.stringify({
          version: "0.1",
          status: "verified",
          task: { description: "test", type: "bugfix", created_at: new Date().toISOString() },
          patches: [{ round: 1, patch: "", apply_status: "ok", files_changed: ["dummy.py"] }],
          verify_results: [{ round: 1, results: [{ command: "echo ok", status: "passed", exit_code: 0, output: "ok", duration_ms: 10 }] }],
          repair_rounds: 0,
        }, null, 2),
        "utf-8",
      );

      const client = undefined as any;
      const filePath = await runHandoff({ cwd: tmp, client });

      assert.ok(filePath.includes("handoff"));
      assert.ok(fs.existsSync(filePath));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("runFullPipeline", () => {
  it("runs plan, patch, verify, handoff in sequence", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pipeline-test-"));
    try {
      fs.mkdirSync(path.join(tmp, ".dsh"), { recursive: true });
      const yaml = await import("js-yaml");
      fs.writeFileSync(
        path.join(tmp, ".dsh", "config.yml"),
        yaml.dump({
          project: { name: "test", language: "python" },
          verify: { test: "echo ok" },
          rules: { files: [] },
          deepseek: {},
        }),
        "utf-8",
      );
      fs.writeFileSync(path.join(tmp, "dummy.py"), "# test", "utf-8");

      const client = mockClient(VALID_PATCH_RESPONSE);
      const state = await runFullPipeline({
        cwd: tmp,
        client,
        description: "Fix bug",
        taskType: "bugfix",
      });

      assert.equal(state.status, "verified");
      // Verify handoff was written
      const handoffDir = path.join(tmp, ".dsh", "handoff");
      assert.ok(fs.existsSync(handoffDir));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
pnpm --filter @dsh/core test
```

期望：runPlan 2 + runPatch 2 + runVerify 2 + runRepair 2 + runHandoff 1 + runFullPipeline 1 = 10 个新测试通过。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline.ts packages/core/src/pipeline.test.ts
git commit -m "feat(pipeline): implement runHandoff and runFullPipeline with tests"
```

---

### Task 7: core/index.ts — 导出 pipeline

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 添加 pipeline 导出**

在现有 export 块末尾追加：

```typescript
export {
  runPlan,
  runPatch,
  runVerify,
  runRepair,
  runHandoff,
  runFullPipeline,
} from "./pipeline.js";
export type {
  PlanParams,
  PatchParams,
  VerifyParams,
  RepairParams,
  HandoffParams,
  FullPipelineParams,
  PipelineBase,
} from "./pipeline.js";
```

- [ ] **Step 2: 验证 typecheck + test**

```bash
pnpm -r run typecheck && pnpm --filter @dsh/core test
```

期望：全部通过。

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export pipeline functions and types from index"
```

---

### Task 8: CLI refactoring — plan.ts

**Files:**
- Modify: `packages/cli/src/commands/plan.ts`

- [ ] **Step 1: 重构 planCommand 为 pipeline 薄封装**

用以下内容替换现有 `planCommand` 函数体：

```typescript
import { DeepSeekClient } from "@dsh/provider";
import { runPlan } from "@dsh/core";

interface PlanOptions {
  type?: string;
}

export async function planCommand(description: string, opts: PlanOptions): Promise<void> {
  const cwd = process.cwd();
  const taskType = (opts.type ?? "feature") as "bugfix" | "feature" | "refactor" | "test" | "docs";

  let client: DeepSeekClient;
  try {
    client = DeepSeekClient.fromEnv();
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  console.log("正在分析任务和项目上下文...");

  let state;
  try {
    state = await runPlan({ cwd, client, description, taskType });
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  console.log("");
  console.log("## 计划");
  console.log(state.plan?.raw_xml ?? "");
  console.log("");
  if (state.plan?.files && state.plan.files.length > 0) {
    console.log("### 涉及文件");
    for (const f of state.plan.files) console.log(`- ${f}`);
    console.log("");
  }
  if (state.plan?.risks && state.plan.risks.length > 0) {
    console.log("### 风险");
    for (const r of state.plan.risks) console.log(`- ${r}`);
    console.log("");
  }
  console.log("→ 下一步: dsh patch");
}
```

- [ ] **Step 2: 运行现有测试确认兼容**

```bash
pnpm --filter @dsh/cli test
```

期望：`planCommand` 相关测试通过（2 tests: generates a plan, rejects when no PLAN block）。

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/plan.ts
git commit -m "refactor(cli): delegate planCommand to pipeline.runPlan"
```

---

### Task 9: CLI refactoring — patch.ts

**Files:**
- Modify: `packages/cli/src/commands/patch.ts`

- [ ] **Step 1: 重构 patchCommand 为 pipeline 薄封装**

```typescript
import { DeepSeekClient } from "@dsh/provider";
import { runPatch } from "@dsh/core";

interface PatchOptions {
  auto?: boolean;
  dryRun?: boolean;
}

export async function patchCommand(opts: PatchOptions): Promise<void> {
  const cwd = process.cwd();

  let client: DeepSeekClient;
  try {
    client = DeepSeekClient.fromEnv();
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  let state;
  try {
    state = await runPatch({ cwd, client, auto: opts.auto, dryRun: opts.dryRun });
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  if (opts.dryRun) {
    // --dry-run: patch 内容已由 runPatch 跳过 apply，这里给用户看最近一个 patch
    const lastPatch = state.patches.at(-1);
    console.log("");
    console.log(lastPatch?.patch ?? "(no patch)");
    console.log(`→ 将修改 ${lastPatch?.files_changed.length ?? 0} 个文件 (dry-run)`);
    return;
  }

  console.log(`✓ 已修改 ${state.patches.at(-1)?.files_changed.length ?? 0} 个文件`);
  console.log("→ 下一步: dsh verify");
}
```

去掉原有的 `import * as readline`、`askUser` 函数（交互确认移到 CLI 层，但当前简化）。

- [ ] **Step 2: 运行现有测试**

```bash
pnpm --filter @dsh/cli test
```

期望：`patchCommand` 相关测试通过。

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/patch.ts
git commit -m "refactor(cli): delegate patchCommand to pipeline.runPatch"
```

---

### Task 10: CLI refactoring — verify.ts

**Files:**
- Modify: `packages/cli/src/commands/verify.ts`

- [ ] **Step 1: 重构 verifyCommand**

```typescript
import { runVerify, formatResults, summarizeResults } from "@dsh/core";

interface VerifyOptions {
  test?: boolean;
  lint?: boolean;
  typecheck?: boolean;
  all?: boolean;
}

export async function verifyCommand(opts: VerifyOptions): Promise<void> {
  const cwd = process.cwd();

  // 对于 --all flag，传递所有 filter 为 true
  const test = opts.test || opts.all || false;
  const lint = opts.lint || opts.all || false;
  const typecheck = opts.typecheck || opts.all || false;

  // 如果没有任何 flag，传空让 runVerify 跑全部
  const hasFilters = opts.test || opts.lint || opts.typecheck || opts.all;

  console.log("正在执行验证...");
  console.log("");

  let state;
  try {
    state = await runVerify({
      cwd,
      client: undefined as any, // verify doesn't need client
      ...(hasFilters ? { test, lint, typecheck } : {}),
    });
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const lastRound = state.verify_results.at(-1);
  if (lastRound) {
    console.log(formatResults(lastRound.results));
    console.log("");
    console.log(summarizeResults(lastRound.results));
  }

  if (state.status === "verified") {
    console.log("");
    console.log("→ 全部通过。下一步: dsh handoff");
  } else {
    console.log("");
    console.log("→ 验证失败。下一步: dsh repair");
  }
}
```

- [ ] **Step 2: 运行现有测试**

```bash
pnpm --filter @dsh/cli test
```

期望：`verifyCommand` 相关测试通过。

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/verify.ts
git commit -m "refactor(cli): delegate verifyCommand to pipeline.runVerify"
```

---

### Task 11: CLI refactoring — repair.ts

**Files:**
- Modify: `packages/cli/src/commands/repair.ts`

- [ ] **Step 1: 重构 repairCommand**

```typescript
import { DeepSeekClient } from "@dsh/provider";
import { runRepair } from "@dsh/core";
import type { RepairRoundResult } from "@dsh/core";

interface RepairOptions {
  rounds: number;
}

export async function repairCommand(opts: RepairOptions): Promise<void> {
  const cwd = process.cwd();
  const maxRounds = opts.rounds ?? 3;

  let client: DeepSeekClient;
  try {
    client = DeepSeekClient.fromEnv();
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const onRound = (round: number, result: RepairRoundResult) => {
    console.log(`⟳ Repair Round ${round}/${maxRounds}:`);
    if (result.error) console.log(`  ✗ ${result.error}`);
    if (result.patched) console.log("  ✓ patch 应用成功");
    if (result.verifyOutput) console.log(result.verifyOutput);
  };

  let state;
  try {
    state = await runRepair({ cwd, client, maxRounds, onRound });
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  if (state.status === "verified") {
    console.log("");
    console.log(`→ 修复成功 (${state.repair_rounds} 轮)。下一步: dsh handoff`);
  } else {
    console.log("");
    console.log(`→ ${maxRounds} 轮修复未能解决。请手动介入。`);
    console.log("  失败日志: .dsh/task-state.json → verify_results");
  }
}
```

- [ ] **Step 2: 运行现有测试**

```bash
pnpm --filter @dsh/cli test
```

期望：`repairCommand` 相关测试通过。

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/repair.ts
git commit -m "refactor(cli): delegate repairCommand to pipeline.runRepair"
```

---

### Task 12: CLI refactoring — handoff.ts

**Files:**
- Modify: `packages/cli/src/commands/handoff.ts`

- [ ] **Step 1: 重构 handoffCommand**

```typescript
import { runHandoff, readTaskState } from "@dsh/core";

interface HandoffOptions {
  format?: "markdown" | "json";
  output?: string;
}

export async function handoffCommand(opts: HandoffOptions): Promise<void> {
  const cwd = process.cwd();

  const state = readTaskState(cwd);
  if (!state) {
    console.log("错误: 尚未初始化。请先运行 dsh init");
    process.exit(1);
  }

  if (state.status !== "verified" && state.status !== "repair_exhausted" && state.status !== "done") {
    console.log(`警告: 当前状态为 ${state.status}，建议先完成验证`);
  }

  const format = opts.format ?? "markdown";
  const filePath = await runHandoff({ cwd, client: undefined as any, format, outputDir: opts.output });

  console.log(`✓ 交接文件已生成: ${filePath}`);
  console.log("");
  console.log("## 摘要");
  console.log(`任务: ${state.task.description}`);
  console.log(`类型: ${state.task.type}`);
  console.log(`状态: ${state.status}`);
  console.log(`修复轮数: ${state.repair_rounds}`);
  console.log(`补丁数: ${state.patches.length}`);
  console.log(`验证轮数: ${state.verify_results.length}`);
}
```

- [ ] **Step 2: 运行现有测试**

```bash
pnpm --filter @dsh/cli test
```

期望：`handoffCommand` 相关测试通过。

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/handoff.ts
git commit -m "refactor(cli): delegate handoffCommand to pipeline.runHandoff"
```

---

### Task 13: 全量回归验证

- [ ] **Step 1: 运行全部 typecheck + 全部测试**

```bash
pnpm -r run typecheck && pnpm -r run test
```

期望：5 个 package typecheck 通过，所有测试通过（约 79 + 10 = 89 tests）。

- [ ] **Step 2: Commit（如 CLI 测试有微调）**

如有修订：

```bash
git add -u
git commit -m "chore: fix CLI test compatibility after pipeline refactoring"
```

---

### Task 14: Benchmark Runner — 增强实现

**Files:**
- Modify: `packages/eval/src/benchmark-runner.ts`
- Modify: `packages/eval/src/benchmark-runner.test.ts`

保留 `createEmptyResult`, `scoreResult`, `compareResults`, `formatComparisonReport`。追加 `runTask`, `runAll`, `formatEvaluationReport`。

- [ ] **Step 1: 在 benchmark-runner.ts 末尾追加新函数**

```typescript
import { execSync } from "node:child_process";
import * as path from "node:path";
import type { DeepSeekClient } from "@dsh/provider";
import type { LoadedFixture } from "./task-fixtures.js";

// ---- Git helpers ----

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitQuiet(cwd: string, args: string): void {
  execSync(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "ignore"] });
}

function prepareBranch(cwd: string, taskId: string): string {
  const branchName = `dsh-bench-${taskId}`;
  // 确保在 main 上
  try { gitQuiet(cwd, "checkout main"); } catch { /* ignore */ }
  // 删除旧分支
  try { gitQuiet(cwd, `branch -D ${branchName}`); } catch { /* ignore */ }
  // 创建新分支
  gitQuiet(cwd, `checkout -b ${branchName}`);
  return branchName;
}

function resetToMain(cwd: string): void {
  try {
    gitQuiet(cwd, "reset --hard");
    gitQuiet(cwd, "checkout main");
  } catch {
    // best effort
  }
}

// ---- Benchmark execution ----

export async function runTask(
  fixture: LoadedFixture,
  repoPath: string,
  client: DeepSeekClient,
): Promise<TaskResult> {
  const startTime = Date.now();

  const result = createEmptyResult(fixture);
  let repairRounds = 0;
  let repairSuccess = false;
  let handoffQuality = 0;

  try {
    // 1. Git prepare
    prepareBranch(repoPath, fixture.id);

    // 2. dsh init
    const { runPlan, runPatch, runVerify, runRepair, runHandoff } = await import("@dsh/core");
    const initYaml = await import("js-yaml");
    const initFs = await import("node:fs");

    const dshDir = path.join(repoPath, ".dsh");
    initFs.mkdirSync(dshDir, { recursive: true });

    const config = {
      project: { name: path.basename(repoPath), language: "python", package_manager: "pip" },
      verify: {
        test: fixture.verificationCommands[0] ?? "",
        lint: "",
        typecheck: "",
      },
      rules: { files: [] },
      deepseek: { default_model: "deepseek-v4-pro", flash_model: "deepseek-v4-flash", max_repair_rounds: fixture.maxRepairRounds ?? 3, thinking_default: true, api_key: "" },
    };
    initFs.writeFileSync(path.join(dshDir, "config.yml"), initYaml.dump(config, { lineWidth: -1, noRefs: true }), "utf-8");

    // 3. Plan
    let state = await runPlan({
      cwd: repoPath,
      client,
      description: fixture.taskPrompt,
      taskType: fixture.category as "bugfix" | "feature" | "refactor" | "test" | "docs",
    });

    // 4. Patch
    state = await runPatch({ cwd: repoPath, client, auto: true });

    // Record files changed
    result.filesChanged = state.patches.at(-1)?.files_changed ?? [];

    // 5. Verify
    if (fixture.verificationCommands.length > 0) {
      try {
        state = await runVerify({ cwd: repoPath, client });

        if (state.status === "verification_failed") {
          // 6. Repair
          state = await runRepair({
            cwd: repoPath,
            client,
            maxRounds: fixture.maxRepairRounds ?? 3,
          });
          repairRounds = state.repair_rounds;
          repairSuccess = state.status === "verified";
        }
      } catch {
        // verify commands might not exist in generic config — skip
      }
    }

    // 7. Handoff
    try {
      await runHandoff({ cwd: repoPath, client });
      handoffQuality = 2; // basic handoff generated successfully
    } catch {
      // handoff failed
    }

    // 8. Assess completion
    result.completed = true;
    result.testsPassed = state.status === "verified";

    // Scope check
    const extraFiles = result.filesChanged.filter(
      (f: string) => !fixture.expectedFiles.some((ef: string) => f.endsWith(ef)),
    );
    result.extraFiles = extraFiles;
    result.scopeViolation = extraFiles.length > 0;

  } catch (e) {
    result.completed = false;
  } finally {
    resetToMain(repoPath);
  }

  result.repairRounds = repairRounds;
  result.repairSuccess = repairSuccess;
  result.handoffQuality = handoffQuality;
  result.durationMs = Date.now() - startTime;

  return result;
}

export async function runAll(
  fixtures: LoadedFixture[],
  repoPath: string,
  client: DeepSeekClient,
): Promise<TaskResult[]> {
  const results: TaskResult[] = [];
  for (const fixture of fixtures) {
    const result = await runTask(fixture, repoPath, client);
    results.push(result);
  }
  return results;
}

// ---- Report ----

export function formatEvaluationReport(results: TaskResult[]): string {
  const lines: string[] = [];

  lines.push("# DSH Evaluation Report");
  lines.push("");

  // Overview
  const completed = results.filter((r) => r.completed).length;
  const total = results.length;
  const avgScore = results.length > 0 ? results.reduce((s, r) => s + scoreResult(r), 0) / results.length : 0;
  const repairAttempted = results.filter((r) => r.repairRounds > 0).length;
  const repairSucceeded = results.filter((r) => r.repairSuccess).length;
  const avgRepairRounds = results.filter((r) => r.repairRounds > 0).reduce((s, r) => s + r.repairRounds, 0) /
    (repairAttempted || 1);
  const avgInterventions = results.reduce((s, r) => s + r.manualInterventions, 0) / results.length;

  lines.push("## Overview");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Task completion rate | ${completed}/${total} (${((completed / total) * 100).toFixed(0)}%) |`);
  lines.push(`| Average score | ${avgScore.toFixed(1)} |`);
  lines.push(`| Repair success rate | ${repairSucceeded}/${repairAttempted || 1} |`);
  lines.push(`| Avg repair rounds | ${avgRepairRounds.toFixed(1)} |`);
  lines.push(`| Avg manual interventions | ${avgInterventions.toFixed(1)} |`);
  lines.push("");

  // Per-Task Detail
  lines.push("## Per-Task Detail");
  lines.push("");

  for (const r of results) {
    const score = scoreResult(r);
    lines.push(`### ${r.fixtureId} (${r.category}) — Score: ${score}/100`);
    lines.push("");
    lines.push("| Dimension | Result |");
    lines.push("|-----------|--------|");
    lines.push(`| Completed | ${r.completed ? "✓" : "✗"} |`);
    lines.push(`| Files modified | ${r.filesChanged.join(", ") || "(none)"} |`);
    lines.push(`| Expected files | ${r.filesExpected.join(", ")} |`);
    lines.push(`| Scope violation | ${r.scopeViolation ? "✗ (extra: " + r.extraFiles.join(", ") + ")" : "✓"} |`);
    lines.push(`| Tests passed | ${r.testsPassed ? "✓" : "✗"} |`);
    lines.push(`| Repair rounds | ${r.repairRounds} |`);
    lines.push(`| Repair success | ${r.repairSuccess ? "✓" : "✗"} |`);
    lines.push(`| Rule violations | ${r.ruleViolations.length > 0 ? r.ruleViolations.join(", ") : "0"} |`);
    lines.push(`| Handoff quality | ${r.handoffQuality}/3 |`);
    lines.push(`| Duration | ${(r.durationMs / 1000).toFixed(1)}s |`);
    lines.push("");
  }

  // Failure Analysis
  const failures = results.filter((r) => !r.completed || !r.testsPassed);
  if (failures.length > 0) {
    lines.push("## Failure Analysis");
    lines.push("");
    for (const f of failures) {
      const reasons: string[] = [];
      if (!f.completed) reasons.push("task incomplete");
      if (f.scopeViolation) reasons.push("scope creep");
      if (!f.testsPassed && !f.repairSuccess) reasons.push("repair exhausted");
      if (f.ruleViolations.length > 0) reasons.push("rule violations: " + f.ruleViolations.join(", "));
      lines.push(`- **${f.fixtureId}**: ${reasons.join("; ") || "unknown"}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: 编写 benchmark runner 单元测试**

修改 `benchmark-runner.test.ts`，追加：

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { formatEvaluationReport } from "./benchmark-runner.js";
import type { TaskResult } from "./benchmark-runner.js";

describe("formatEvaluationReport", () => {
  it("generates markdown report from results", () => {
    const results: TaskResult[] = [
      {
        fixtureId: "pi-001",
        category: "bugfix",
        completed: true,
        filesChanged: ["tools/check.py"],
        filesExpected: ["tools/check.py"],
        extraFiles: [],
        scopeViolation: false,
        testsPassed: true,
        repairRounds: 0,
        repairSuccess: false,
        ruleViolations: [],
        manualInterventions: 0,
        handoffQuality: 3,
        durationMs: 45000,
      },
      {
        fixtureId: "pi-002",
        category: "test",
        completed: true,
        filesChanged: ["tests/test_handler.py", "src/unrelated.py"],
        filesExpected: ["tests/test_handler.py"],
        extraFiles: ["src/unrelated.py"],
        scopeViolation: true,
        testsPassed: false,
        repairRounds: 2,
        repairSuccess: false,
        ruleViolations: ["modified unrelated file"],
        manualInterventions: 1,
        handoffQuality: 1,
        durationMs: 120000,
      },
    ];

    const report = formatEvaluationReport(results);

    assert.ok(report.includes("# DSH Evaluation Report"));
    assert.ok(report.includes("## Overview"));
    assert.ok(report.includes("50%"));
    assert.ok(report.includes("pi-001"));
    assert.ok(report.includes("pi-002"));
    assert.ok(report.includes("## Failure Analysis"));
    assert.ok(report.includes("scope creep"));
  });

  it("handles empty results", () => {
    const report = formatEvaluationReport([]);
    assert.ok(report.includes("## Overview"));
    assert.ok(report.includes("0/0"));
  });
});
```

- [ ] **Step 3: 验证明有 benchmark-runner 测试**

```bash
pnpm --filter @dsh/eval test
```

期望：现有评分测试 + 新增报告测试全部通过。

- [ ] **Step 4: Commit**

```bash
git add packages/eval/src/benchmark-runner.ts packages/eval/src/benchmark-runner.test.ts
git commit -m "feat(eval): add runTask, runAll, formatEvaluationReport to benchmark runner"
```

---

### Task 15: eval/index.ts — 更新导出

**Files:**
- Modify: `packages/eval/src/index.ts`

- [ ] **Step 1: 添加新导出**

```typescript
export {
  createEmptyResult,
  scoreResult,
  compareResults,
  formatComparisonReport,
  runTask,
  runAll,
  formatEvaluationReport,
} from "./benchmark-runner.js";
export type { TaskResult, ComparisonReport } from "./benchmark-runner.js";
```

- [ ] **Step 2: 验证 typecheck**

```bash
pnpm --filter @dsh/eval typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/eval/src/index.ts
git commit -m "feat(eval): export runTask, runAll, formatEvaluationReport"
```

---

### Task 16: Fixture 文件 — 5 个 pi-proof-forge YAML

**Files:**
- Create: `packages/eval/src/fixtures/pi-bugfix-count-defs.yaml`
- Create: `packages/eval/src/fixtures/pi-test-error-handler.yaml`
- Create: `packages/eval/src/fixtures/pi-refactor-read-text.yaml`
- Create: `packages/eval/src/fixtures/pi-test-aief-l3.yaml`
- Create: `packages/eval/src/fixtures/pi-docs-check-tools.yaml`

- [ ] **Step 1: 创建 pi-bugfix-count-defs.yaml**

```yaml
id: pi-bugfix-count-defs
description: 修复 check_v2_constraints.py 中 count_definitions 的朴素子串匹配
category: bugfix
taskPrompt: |
  在 tools/check_v2_constraints.py 中，count_definitions() 函数使用 text.count(signature) 做朴素子串匹配，
  这会将注释、docstring、字符串字面量中的 def xxx( 也统计进去，产生假阳性或假阴性。

  请将 count_definitions() 改为使用正则表达式 re.findall(r'^def ' + re.escape(signature), text, re.MULTILINE)，
  只匹配行首的 def 声明。find_pattern() 函数不需要修改。

  在文件顶部添加 `import re`。

  相关文件：tools/check_v2_constraints.py
expectedFiles:
  - tools/check_v2_constraints.py
expectPass: true
verificationCommands:
  - python3 -m pytest tests/unit/domain/test_check_v2_constraints.py -v
architectureRules:
  - 不修改 check_v2_constraints.py 的 main() 函数和退出码约定
  - 不用 AST 解析，保持实现简单
  - count_definitions 的调用方式和返回值类型不变
maxRepairRounds: 2
```

- [ ] **Step 2: 创建 pi-test-error-handler.yaml**

```yaml
id: pi-test-error-handler
description: 补充 test_error_handler.py 缺失的 PolicyError 和 FabricationGuardError 测试
category: test
taskPrompt: |
  在 tests/unit/domain/test_error_handler.py 中，ErrorHandlerTests 类目前只有 2 个测试方法：
  - test_route_error_for_unrecoverable_exception（只测了 EvidenceValidationError）
  - test_route_error_for_unknown_exception（只测了 RuntimeError）

  缺少以下测试覆盖：
  1. PolicyError → 应返回 "terminate_run"（PolicyError 在 tools/config/validator.py 中被 20+ 处使用，
     继承自 PiProofError，tools/errors/handler.py 的 route_error 函数应将其路由为 terminate_run）
  2. FabricationGuardError → 应返回 "terminate_run"

  请补充这两个测试方法。保持与现有测试一致的风格（unittest.TestCase, assertEqual）。

  相关文件：tests/unit/domain/test_error_handler.py
expectedFiles:
  - tests/unit/domain/test_error_handler.py
expectPass: true
verificationCommands:
  - python3 -m pytest tests/unit/domain/test_error_handler.py -v
architectureRules:
  - 使用 unittest.TestCase 保持和现有测试风格一致
  - 不要引入 pytest 特有装饰器
  - import PolicyError 和 FabricationGuardError 从 tools.errors.exceptions
maxRepairRounds: 2
```

- [ ] **Step 3: 创建 pi-refactor-read-text.yaml**

```yaml
id: pi-refactor-read-text
description: 提取 extract_evidence.py 和 extract_evidence_llm.py 中重复的 read_text 函数
category: refactor
taskPrompt: |
  tools/extract_evidence.py 的 read_text() 函数（35-39 行）和 tools/extract_evidence_llm.py 的 read_text() 函数（18-21 行）
  实现完全相同：检查 path == "-"，是则读 stdin，否则读文件。

  请将 read_text() 提取到 tools/infra/file_io.py（新建文件），然后在两个源文件中删除本地实现，改为：
  from tools.infra.file_io import read_text

  确保 tools/infra/__init__.py 存在（如果不存在则创建空文件）。

  相关文件：tools/extract_evidence.py, tools/extract_evidence_llm.py, tools/infra/file_io.py(new)
expectedFiles:
  - tools/extract_evidence.py
  - tools/extract_evidence_llm.py
  - tools/infra/file_io.py
expectPass: true
verificationCommands:
  - python3 -m pytest tests/unit/domain/test_evidence_engines.py -v
  - python3 -m pytest tests/unit/domain/test_legacy_entrypoint_redirect.py -v
architectureRules:
  - read_text 的函数签名和目标行为完全不变
  - 不引入新的第三方依赖
  - file_io.py 只放 read_text，保持最小化
maxRepairRounds: 2
```

- [ ] **Step 4: 创建 pi-test-aief-l3.yaml**

```yaml
id: pi-test-aief-l3
description: 为 check_aief_l3.py 创建单元测试
category: test
taskPrompt: |
  tools/check_aief_l3.py 目前完全没有任何单元测试。请为它的三个核心函数创建测试文件
  tests/unit/domain/test_check_aief_l3.py：

  1. check_exists(root, rel_path) → (bool, str)
     测试：文件存在返回 (True, "OK  ...")，不存在返回 (False, "MISS ...")

  2. check_contains(root, rel_path, needle, label) → (bool, str)
     测试：包含 needle 返回 (True, "OK  ...")，不包含返回 (False, "MISS ...")，文件不存在返回 (False, "MISS ...")

  3. check_min_files(root, rel_dir, pattern, min_count, label) → (bool, str)
     测试：目录不存在返回 (False, "MISS ...")，文件数 >= min_count 返回 (True, "OK  ...")，不足返回 (False, "MISS ...")

  使用 Python 标准库 unittest.TestCase 和 tempfile.TemporaryDirectory 创建临时目录和文件来模拟各种场景。
  测试风格参考 tests/unit/domain/test_error_handler.py。

  相关文件：tools/check_aief_l3.py, tests/unit/domain/test_check_aief_l3.py(new)
expectedFiles:
  - tests/unit/domain/test_check_aief_l3.py
expectPass: true
verificationCommands:
  - python3 -m pytest tests/unit/domain/test_check_aief_l3.py -v
architectureRules:
  - 使用 unittest.TestCase 和 tempfile.TemporaryDirectory
  - 不引入 pytest 特有装饰器
  - 测试函数命名：test_check_exists_* / test_check_contains_* / test_check_min_files_*
maxRepairRounds: 3
```

- [ ] **Step 5: 创建 pi-docs-check-tools.yaml**

```yaml
id: pi-docs-check-tools
description: 补充 tools/README.md 中缺失的 check 工具说明
category: docs
taskPrompt: |
  tools/README.md 当前缺少以下两个工具的说明文档：

  1. tools/check_v2_constraints.py — v2 架构静态约束检查
     检查项包括：infra 层函数定义唯一性、业务层 subprocess 使用限制、engines 层 use_llm 分支检查
     用法：python3 tools/check_v2_constraints.py --root .
     退出码：0 = PASS，1 = FAIL

  2. tools/check_submission_readiness.py — 投递就绪门禁检查
     检查项：submission_log.json 存在性、status 匹配、mode 为 submit、screenshots >= min
     用法：python3 tools/check_submission_readiness.py --root outputs/submissions --platform liepin --require-status success --min-screenshots 1
     退出码：0 = PASS，1 = FAIL

  请在 tools/README.md 的 "CI 校验" 章节之前（约 210 行附近）添加 "# 架构检查与门禁" 章节，
  按与现有 README 一致的风格补充以上两个工具的文档。

  相关文件：tools/README.md
expectedFiles:
  - tools/README.md
expectPass: true
verificationCommands:
  - python3 tools/check_v2_constraints.py --root .
architectureRules:
  - 保持 tools/README.md 现有 Markdown 风格一致
  - 新增章节放在 "CI 校验" 之前
  - 不修改其他工具的文档
maxRepairRounds: 2
```

- [ ] **Step 6: 验证 fixture 格式正确**

```bash
pnpm --filter @dsh/eval test
```

期望：`loadFixture`/`loadAllFixtures` 测试通过（新 fixture 可被正确解析）。

- [ ] **Step 7: Commit**

```bash
git add packages/eval/src/fixtures/pi-*.yaml
git commit -m "feat(eval): add 5 pi-proof-forge benchmark fixtures"
```

---

### Task 17: 全量回归 + 最终提交

- [ ] **Step 1: 运行全部 typecheck**

```bash
pnpm -r run typecheck
```

期望：5 个 package 全部通过。

- [ ] **Step 2: 运行全部测试**

```bash
pnpm -r run test
```

期望：所有测试通过（约 89+ tests）。

- [ ] **Step 3: 最终验证 — 确认 pipeline.ts 导出正确**

```bash
node -e "import('@dsh/core').then(m => console.log(Object.keys(m).filter(k => k.includes('run')).join(', ')))"
```

期望输出包含：`runPlan, runPatch, runVerify, runRepair, runHandoff, runFullPipeline`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: final typecheck and test verification for phase 5-6 eval system"
```

---

### Task 18: 集成验证 — 真实 DeepSeek API + pi-proof-forge

- [ ] **Step 1: 确保 pi-proof-forge 已克隆**

```bash
cd /tmp && git clone https://github.com/tongsh6/pi-proof-forge.git 2>/dev/null || echo "already exists"
```

- [ ] **Step 2: 确保 DEEPSEEK_API_KEY 已设置**

```bash
echo ${DEEPSEEK_API_KEY:+"API key is set"} || echo "WARNING: DEEPSEEK_API_KEY not set"
```

- [ ] **Step 3: 对 pi-proof-forge 初始化 dsh**

```bash
cd /tmp/pi-proof-forge && npx tsx /Users/loong/workspace/code/github/ai/dsh/packages/cli/src/main.ts init --force
```

- [ ] **Step 4: 运行第一个 fixture（手动单步验证）**

```bash
cd /tmp/pi-proof-forge && \
  git checkout main && \
  git branch -D dsh-bench-pi-bugfix-count-defs 2>/dev/null; \
  git checkout -b dsh-bench-pi-bugfix-count-defs && \
  npx tsx /Users/loong/workspace/code/github/ai/dsh/packages/cli/src/main.ts plan "tools/check_v2_constraints.py 的 count_definitions() 使用 str.count() 朴素子串匹配，请改为 re.findall 正则匹配行首 def 声明" --type bugfix
```

- [ ] **Step 5: 观察 plan 输出，确认计划合理后执行 patch**

```bash
cd /tmp/pi-proof-forge && \
  npx tsx /Users/loong/workspace/code/github/ai/dsh/packages/cli/src/main.ts patch --auto && \
  npx tsx /Users/loong/workspace/code/github/ai/dsh/packages/cli/src/main.ts verify --test
```

- [ ] **Step 6: 如验证失败，执行 repair**

```bash
cd /tmp/pi-proof-forge && \
  npx tsx /Users/loong/workspace/code/github/ai/dsh/packages/cli/src/main.ts repair --rounds 2
```

- [ ] **Step 7: 生成 handoff**

```bash
cd /tmp/pi-proof-forge && \
  npx tsx /Users/loong/workspace/code/github/ai/dsh/packages/cli/src/main.ts handoff
```

- [ ] **Step 8: 重置环境**

```bash
cd /tmp/pi-proof-forge && git reset --hard && git checkout main
```

- [ ] **Step 9: 对 5 个 fixture 逐一执行上述流程**

观察每个 fixture 的结果，记录 TaskResult 数据。

- [ ] **Step 10: 生成评测报告**

```bash
cd /Users/loong/workspace/code/github/ai/dsh && node -e "
const { loadAllFixtures } = require('@dsh/eval');
const fixtures = loadAllFixtures('packages/eval/src/fixtures');
// Filter pi-* fixtures
const piFixtures = fixtures.filter(f => f.id.startsWith('pi-'));
console.log('Fixtures loaded:', piFixtures.map(f => f.id).join(', '));
"
```

---

## 成功标准

- [ ] `pnpm -r run typecheck` 全部通过
- [ ] `pnpm -r run test` 全部通过（预期 89+ tests）
- [ ] 5 个 pi-proof-forge fixture 至少 3 个首次通过（完成率 >= 60%）
- [ ] 至少 1 个 fixture 触发 repair loop 并修复成功
- [ ] 产出第一份 DSH Evaluation Report（markdown）
