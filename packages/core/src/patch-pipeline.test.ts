import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  shouldEnterCoverageFinalization,
  decidePatchStatus,
  runPatchPipeline,
  type PatchLoopState,
} from "./patch-pipeline.js";
import { canTransition, createTaskState } from "./task-state.js";
import type { TaskState } from "./task-state.js";
import type { ContextLayers } from "./context-builder.js";
import type { DeepSeekClient } from "@dsh/provider";

function loopState(over: Partial<PatchLoopState> = {}): PatchLoopState {
  return {
    round: 5,
    maxRounds: 30,
    hasStartedPatching: true,
    coveredRequiredFiles: new Set<string>(),
    missingRequiredFiles: new Set<string>(["c.ts"]),
    invalidStreak: 0,
    consecutiveToolsOnly: 0,
    roundsSinceCoverageProgress: 0,
    validChangesWithoutCoverageProgress: 0,
    modelSaidDoneWithMissing: false,
    ...over,
  };
}

describe("shouldEnterCoverageFinalization", () => {
  it("is false when there are no missing required files", () => {
    assert.equal(
      shouldEnterCoverageFinalization(loopState({ missingRequiredFiles: new Set() })),
      false,
    );
  });

  it("is true when the model said DONE with missing required files", () => {
    assert.equal(
      shouldEnterCoverageFinalization(loopState({ modelSaidDoneWithMissing: true })),
      true,
    );
  });

  it("is true when too many rounds passed without coverage progress", () => {
    assert.equal(
      shouldEnterCoverageFinalization(loopState({ roundsSinceCoverageProgress: 5 })),
      true,
    );
  });

  it("is true when valid changes keep landing without covering a required file", () => {
    assert.equal(
      shouldEnterCoverageFinalization(loopState({ validChangesWithoutCoverageProgress: 2 })),
      true,
    );
  });

  it("is true on a long tools-only stall after patching started", () => {
    assert.equal(
      shouldEnterCoverageFinalization(loopState({ consecutiveToolsOnly: 8 })),
      true,
    );
  });

  it("is true when few rounds remain", () => {
    assert.equal(shouldEnterCoverageFinalization(loopState({ round: 28 })), true);
  });

  it("is true on an invalid streak after patching started", () => {
    assert.equal(shouldEnterCoverageFinalization(loopState({ invalidStreak: 3 })), true);
  });

  it("ignores stall counters before patching has started", () => {
    assert.equal(
      shouldEnterCoverageFinalization(
        loopState({
          hasStartedPatching: false,
          roundsSinceCoverageProgress: 99,
          consecutiveToolsOnly: 99,
          invalidStreak: 99,
        }),
      ),
      false,
    );
  });
});

describe("decidePatchStatus", () => {
  it("fails when no change was applied", () => {
    const d = decidePatchStatus({
      hasOkChanges: false,
      fullRequiredCoverage: false,
      missingRequiredFiles: ["a.ts"],
      strictFailureEligible: false,
      strictGateEnabled: false,
      coverageFinalizationAttempted: false,
    });
    assert.equal(d.status, "patch_failed");
  });

  it("patches when required coverage is full", () => {
    const d = decidePatchStatus({
      hasOkChanges: true,
      fullRequiredCoverage: true,
      missingRequiredFiles: [],
      strictFailureEligible: false,
      strictGateEnabled: false,
      coverageFinalizationAttempted: false,
    });
    assert.equal(d.status, "patched");
    assert.equal(d.coverage, "full");
  });

  it("returns patch_partial when required files are still missing", () => {
    const d = decidePatchStatus({
      hasOkChanges: true,
      fullRequiredCoverage: false,
      missingRequiredFiles: ["c.ts"],
      strictFailureEligible: false,
      strictGateEnabled: false,
      coverageFinalizationAttempted: true,
    });
    assert.equal(d.status, "patch_partial");
    assert.equal(d.coverage, "partial");
  });

  it("does not hard-fail a legacy contract even when the strict gate is enabled", () => {
    const d = decidePatchStatus({
      hasOkChanges: true,
      fullRequiredCoverage: false,
      missingRequiredFiles: ["c.ts"],
      strictFailureEligible: false,
      strictGateEnabled: true,
      coverageFinalizationAttempted: true,
    });
    assert.equal(d.status, "patch_partial");
  });

  it("hard-fails an explicit_v2 high-confidence contract when the strict gate is enabled and finalization was attempted", () => {
    const d = decidePatchStatus({
      hasOkChanges: true,
      fullRequiredCoverage: false,
      missingRequiredFiles: ["c.ts"],
      strictFailureEligible: true,
      strictGateEnabled: true,
      coverageFinalizationAttempted: true,
    });
    assert.equal(d.status, "patch_failed");
  });

  it("does not hard-fail before finalization has been attempted", () => {
    const d = decidePatchStatus({
      hasOkChanges: true,
      fullRequiredCoverage: false,
      missingRequiredFiles: ["c.ts"],
      strictFailureEligible: true,
      strictGateEnabled: true,
      coverageFinalizationAttempted: false,
    });
    assert.equal(d.status, "patch_partial");
  });
});

describe("patch_partial state transitions", () => {
  it("can be reached from planned", () => {
    assert.equal(canTransition("planned", "patch_partial"), true);
  });

  it("routes to repair", () => {
    assert.equal(canTransition("patch_partial", "repairing"), true);
    assert.equal(canTransition("patch_partial", "verification_failed"), true);
  });

  it("never transitions straight to patched", () => {
    assert.equal(canTransition("patch_partial", "patched"), false);
  });
});

// ---- Integration: runPatchPipeline with a scripted client ----

const EMPTY_LAYERS: ContextLayers = {
  base: "",
  repo: "",
  task: "",
  dynamic: null,
  estimatedTokens: 0,
};

// Returns the client plus a `toolsSeen` log: one boolean per chat call,
// recording whether that call was given a non-empty tools list. Lets a test
// assert that coverage_finalization runs with tools disabled.
function scriptedClient(responses: string[]): { client: DeepSeekClient; toolsSeen: boolean[] } {
  let index = 0;
  const toolsSeen: boolean[] = [];
  const client = {
    chat: async (request: { tools?: unknown[] }) => {
      toolsSeen.push(Array.isArray(request.tools) && request.tools.length > 0);
      const content = responses[Math.min(index, responses.length - 1)] ?? "<DONE/>";
      index++;
      return {
        id: "test",
        object: "chat.completion",
        created: 0,
        model: "deepseek-v4-pro",
        choices: [
          {
            index: 0,
            message: { role: "assistant" as const, content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    },
    chatStream: async function* () {
      yield undefined as never;
    },
  } as unknown as DeepSeekClient;
  return { client, toolsSeen };
}

function plannedState(files: string[]): TaskState {
  const state = createTaskState("create the modules", "feature");
  state.status = "planned";
  state.plan = { summary: "", files, risks: [], raw_xml: "" };
  return state;
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-patch-pipeline-"));
  fs.mkdirSync(path.join(dir, ".dsh"), { recursive: true });
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createBlock(file: string, body: string): string {
  return `<CREATE path="${file}">\n${body}\n</CREATE>`;
}

describe("runPatchPipeline coverage_finalization", () => {
  it("calls the model with tools disabled during coverage_finalization", async () => {
    await withTempDir(async (dir) => {
      const { client, toolsSeen } = scriptedClient([
        createBlock("a.ts", "export const a = 1;"), // explore round 1
        "<DONE/>", // explore round 2: b.ts still missing
        createBlock("b.ts", "export const b = 2;"), // finalization
      ]);
      await runPatchPipeline({
        state: plannedState(["a.ts", "b.ts"]),
        cwd: dir,
        client,
        dryRun: false,
        messages: [],
        target: { model: "deepseek-v4-pro", thinking: false },
        contextLayers: EMPTY_LAYERS,
      });
      // 3 model calls: patch_explore ×2 then coverage_finalization ×1.
      assert.equal(toolsSeen.length, 3);
      assert.equal(toolsSeen[0], true, "patch_explore turns carry tools");
      assert.equal(
        toolsSeen[2],
        false,
        "coverage_finalization must run with tools disabled",
      );
    });
  });

  it("rescues a missing required file via finalization → patched", async () => {
    await withTempDir(async (dir) => {
      const { client } = scriptedClient([
        createBlock("a.ts", "export const a = 1;"), // explore: covers a.ts
        "<DONE/>", // explore: DONE while b.ts still missing
        createBlock("b.ts", "export const b = 2;"), // finalization: covers b.ts
      ]);
      const state = await runPatchPipeline({
        state: plannedState(["a.ts", "b.ts"]),
        cwd: dir,
        client,
        dryRun: false,
        messages: [],
        target: { model: "deepseek-v4-pro", thinking: false },
        contextLayers: EMPTY_LAYERS,
      });
      assert.equal(state.status, "patched");
      const patch = state.patches.at(-1);
      assert.equal(patch?.coverage, "full");
      assert.equal(patch?.coverage_finalization_attempted, true);
      assert.ok(fs.existsSync(path.join(dir, "b.ts")));
    });
  });

  it("keeps the patch partial when finalization declines to change → patch_partial", async () => {
    await withTempDir(async (dir) => {
      const { client } = scriptedClient([
        createBlock("a.ts", "export const a = 1;"),
        "<DONE/>", // explore DONE, b.ts missing
        "<DONE/>", // finalization declines
      ]);
      const state = await runPatchPipeline({
        state: plannedState(["a.ts", "b.ts"]),
        cwd: dir,
        client,
        dryRun: false,
        messages: [],
        target: { model: "deepseek-v4-pro", thinking: false },
        contextLayers: EMPTY_LAYERS,
      });
      assert.equal(state.status, "patch_partial");
      const patch = state.patches.at(-1);
      assert.equal(patch?.coverage, "partial");
      assert.equal(patch?.coverage_finalization_attempted, true);
      assert.deepEqual(patch?.missing_required_files, ["b.ts"]);
    });
  });

  it("does not run finalization when explore already covered every required file", async () => {
    await withTempDir(async (dir) => {
      const { client } = scriptedClient([
        createBlock("a.ts", "export const a = 1;"),
        createBlock("b.ts", "export const b = 2;"),
        "<DONE/>",
      ]);
      const state = await runPatchPipeline({
        state: plannedState(["a.ts", "b.ts"]),
        cwd: dir,
        client,
        dryRun: false,
        messages: [],
        target: { model: "deepseek-v4-pro", thinking: false },
        contextLayers: EMPTY_LAYERS,
      });
      assert.equal(state.status, "patched");
      const patch = state.patches.at(-1);
      assert.equal(patch?.coverage, "full");
      assert.equal(patch?.coverage_finalization_attempted, false);
    });
  });
});

// ---- card_off regression (spec §6.1 #13 / §14) ----
// The card_off blocker: the model covers two required files, then drips
// off-plan changes (the "挤牙膏" pattern), never covers the third required
// file, and never says <DONE/>. The legacy loop ran all 30 rounds and still
// reported "patched". The v2 state machine must catch the coverage-aware
// stall early and either finalize the missing file or report patch_partial.

describe("runPatchPipeline card_off regression", () => {
  it("off-plan changes do not reset coverage progress; finalization rescues the missing file without exhausting maxRounds", async () => {
    await withTempDir(async (dir) => {
      const { client } = scriptedClient([
        createBlock("shared.ts", "export const shared = 1;"), // covers shared.ts
        createBlock("openai-compatible.ts", "export const oc = 1;"), // covers openai-compatible.ts
        createBlock("off-plan-1.ts", "export const x = 1;"), // off-plan: no coverage progress
        createBlock("off-plan-2.ts", "export const y = 1;"), // off-plan: 2nd → coverage stall
        createBlock("anthropic.ts", "export const anthropic = 1;"), // finalization rescues
      ]);
      const state = await runPatchPipeline({
        state: plannedState(["shared.ts", "openai-compatible.ts", "anthropic.ts"]),
        cwd: dir,
        client,
        dryRun: false,
        messages: [],
        target: { model: "deepseek-v4-pro", thinking: false },
        contextLayers: EMPTY_LAYERS,
      });
      assert.equal(state.status, "patched");
      assert.equal(state.patches.at(-1)?.coverage, "full");
      // Far below MAX_PATCH_ROUNDS (30): the coverage-aware stall stopped
      // explore early instead of running the budget out.
      assert.ok(
        state.patch_rounds.length < 10,
        `expected an early stall, got ${state.patch_rounds.length} rounds`,
      );
    });
  });

  it("reports patch_partial (not a maxRounds-exhausted patched) when the required file is never covered", async () => {
    await withTempDir(async (dir) => {
      const { client } = scriptedClient([
        createBlock("shared.ts", "export const shared = 1;"),
        createBlock("openai-compatible.ts", "export const oc = 1;"),
        createBlock("off-plan-1.ts", "export const x = 1;"),
        createBlock("off-plan-2.ts", "export const y = 1;"),
        "<DONE/>", // finalization declines
      ]);
      const state = await runPatchPipeline({
        state: plannedState(["shared.ts", "openai-compatible.ts", "anthropic.ts"]),
        cwd: dir,
        client,
        dryRun: false,
        messages: [],
        target: { model: "deepseek-v4-pro", thinking: false },
        contextLayers: EMPTY_LAYERS,
      });
      assert.equal(state.status, "patch_partial");
      assert.deepEqual(state.patches.at(-1)?.missing_required_files, ["anthropic.ts"]);
      assert.ok(state.patch_rounds.length < 10);
    });
  });
});
