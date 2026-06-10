import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  shouldEnterCoverageFinalization,
  decidePatchStatus,
  parseApplyPatchToolCall,
  runPatchPipeline,
  type PatchLoopState,
} from "./patch-pipeline.js";
import { canTransition, createTaskState } from "./task-state.js";
import type { TaskState } from "./task-state.js";
import type { ContextLayers } from "./context-builder.js";
import type { DeepSeekClient, DeepSeekMessage, DeepSeekResponse, DeepSeekToolCall } from "@dsh/provider";

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
          invalidStreak: 0,
          roundsSinceCoverageProgress: 99,
          consecutiveToolsOnly: 99,
        }),
      ),
      false,
    );
  });

  it("enters finalization on a terminal invalid streak even before patching starts", () => {
    assert.equal(
      shouldEnterCoverageFinalization(
        loopState({
          hasStartedPatching: false,
          invalidStreak: 3,
        }),
      ),
      true,
    );
  });

  it("enters finalization at max rounds even when no patch started", () => {
    assert.equal(
      shouldEnterCoverageFinalization(
        loopState({
          round: 30,
          maxRounds: 30,
          hasStartedPatching: false,
        }),
      ),
      true,
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
type ScriptedAssistantMessage = DeepSeekResponse["choices"][number]["message"];

function scriptedClient(responses: Array<string | ScriptedAssistantMessage>): {
  client: DeepSeekClient;
  toolsSeen: boolean[];
  requests: Array<{ tools?: unknown[]; messages?: DeepSeekMessage[] }>;
} {
  let index = 0;
  const toolsSeen: boolean[] = [];
  const requests: Array<{ tools?: unknown[]; messages?: DeepSeekMessage[] }> = [];
  const client = {
    chat: async (request: { tools?: unknown[]; messages?: DeepSeekMessage[] }) => {
      requests.push(request);
      toolsSeen.push(Array.isArray(request.tools) && request.tools.length > 0);
      const next = responses[Math.min(index, responses.length - 1)] ?? "<DONE/>";
      const message: ScriptedAssistantMessage = typeof next === "string"
        ? { role: "assistant" as const, content: next }
        : next;
      index++;
      return {
        id: "test",
        object: "chat.completion",
        created: 0,
        model: "deepseek-v4-pro",
        choices: [
          {
            index: 0,
            message,
            finish_reason: message.tool_calls && message.tool_calls.length > 0 ? "tool_calls" : "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    },
    chatStream: async function* () {
      yield undefined as never;
    },
  } as unknown as DeepSeekClient;
  return { client, toolsSeen, requests };
}

function plannedState(files: string[], description = "create the modules"): TaskState {
  const state = createTaskState(description, "feature");
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

function applyPatchToolCall(args: Record<string, unknown>, id = "apply_1"): DeepSeekToolCall {
  return {
    id,
    type: "function",
    function: {
      name: "apply_patch",
      arguments: JSON.stringify(args),
    },
  };
}

function readFileToolCall(filePath: string, id = "read_1"): DeepSeekToolCall {
  return {
    id,
    type: "function",
    function: {
      name: "read_file",
      arguments: JSON.stringify({ path: filePath }),
    },
  };
}

function writePatchConfig(dir: string, body: string): void {
  fs.writeFileSync(path.join(dir, ".dsh", "config.yml"), `patch:\n${body}`, "utf-8");
}

async function withPatchEditsEnv<T>(
  value: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = process.env["PATCH_EDITS_AS_NATIVE_TOOL"];
  if (value === undefined) {
    delete process.env["PATCH_EDITS_AS_NATIVE_TOOL"];
  } else {
    process.env["PATCH_EDITS_AS_NATIVE_TOOL"] = value;
  }
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env["PATCH_EDITS_AS_NATIVE_TOOL"];
    } else {
      process.env["PATCH_EDITS_AS_NATIVE_TOOL"] = previous;
    }
  }
}

describe("apply_patch tool-call conversion", () => {
  it("converts all supported protocol ops to existing change blocks", () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["CREATE", { protocol_op: "CREATE", path: "a.ts", content: "export const a = 1;" }, "a.ts"],
      ["DELETE", { protocol_op: "DELETE", path: "old.ts" }, "old.ts"],
      ["RENAME", { protocol_op: "RENAME", from: "old.ts", to: "new.ts" }, "old.ts -> new.ts"],
      [
        "SEARCH_REPLACE",
        { protocol_op: "SEARCH_REPLACE", path: "a.ts", search: "old", replace: "new" },
        "a.ts",
      ],
      [
        "INSERT",
        { protocol_op: "INSERT", path: "a.ts", anchor: "export", position: "after", content: "export const b = 2;" },
        "a.ts",
      ],
      [
        "PATCH",
        {
          protocol_op: "PATCH",
          patch: [
            "--- a/a.ts",
            "+++ b/a.ts",
            "@@ -1 +1 @@",
            "-old",
            "+new",
          ].join("\n"),
        },
        "a.ts",
      ],
    ];

    for (const [op, args, file] of cases) {
      const action = parseApplyPatchToolCall(applyPatchToolCall(args));
      assert.equal(action.kind, "change", op);
      if (action.kind === "change") {
        assert.equal(action.source, "tool_call");
        assert.equal(action.change.op, op);
        assert.equal(action.change.file, file);
      }
    }
  });

  it("rejects malformed apply_patch arguments before any write path", () => {
    const action = parseApplyPatchToolCall(applyPatchToolCall({ protocol_op: "CREATE", content: "x" }));
    assert.equal(action.kind, "invalid");
    if (action.kind === "invalid") {
      assert.match(action.reason, /path is required/);
    }
  });

  it("accepts common operation aliases and infers unambiguous protocol ops", () => {
    const aliasAction = parseApplyPatchToolCall(applyPatchToolCall({
      op: "search-replace",
      path: "a.ts",
      search: "old",
      replace: "new",
    }));
    assert.equal(aliasAction.kind, "change");
    if (aliasAction.kind === "change") {
      assert.equal(aliasAction.change.op, "SEARCH_REPLACE");
      assert.equal(aliasAction.change.file, "a.ts");
    }

    const inferredAction = parseApplyPatchToolCall(applyPatchToolCall({
      from: "old.ts",
      to: "new.ts",
    }));
    assert.equal(inferredAction.kind, "change");
    if (inferredAction.kind === "change") {
      assert.equal(inferredAction.change.op, "RENAME");
      assert.equal(inferredAction.change.file, "old.ts -> new.ts");
    }
  });

  it("builds INSERT changes directly so structured anchors may contain quotes or newlines", () => {
    const action = parseApplyPatchToolCall(applyPatchToolCall({
      protocol_op: "INSERT",
      path: "a.ts",
      anchor: "if (name === \"apply_patch\") {\n  return true;",
      position: "after",
      content: "\nreturn false;",
    }));

    assert.equal(action.kind, "change");
    if (action.kind === "change") {
      assert.equal(action.change.op, "INSERT");
      assert.equal(action.change.insert?.anchor, "if (name === \"apply_patch\") {\n  return true;");
    }
  });
});

describe("runPatchPipeline apply_patch tool channel", () => {
  it("does not expose apply_patch when the flag is off", async () => {
    await withPatchEditsEnv("false", async () => {
      await withTempDir(async (dir) => {
        const { client, requests } = scriptedClient([
          createBlock("a.ts", "export const a = 1;"),
          "<DONE/>",
        ]);
        await runPatchPipeline({
          state: plannedState(["a.ts"]),
          cwd: dir,
          client,
          dryRun: false,
          messages: [],
          target: { model: "deepseek-v4-pro", thinking: false },
          contextLayers: EMPTY_LAYERS,
        });

        const names = ((requests[0]?.tools ?? []) as Array<{ function: { name: string } }>)
          .map((tool) => tool.function.name)
          .sort();
        assert.deepEqual(names, ["grep_files", "read_file"]);
      });
    });
  });

  it("exposes apply_patch with the flag on and applies it through patch telemetry", async () => {
    await withPatchEditsEnv(undefined, async () => {
      await withTempDir(async (dir) => {
        writePatchConfig(dir, "  edits_as_native_tool: true\n");
        const { client, requests } = scriptedClient([
          {
            role: "assistant",
            content: "",
            tool_calls: [
              applyPatchToolCall({
                protocol_op: "CREATE",
                path: "a.ts",
                content: "export const a = 1;",
              }, "apply_create"),
            ],
          },
          "<DONE/>",
        ]);

        const state = await runPatchPipeline({
          state: plannedState(["a.ts"]),
          cwd: dir,
          client,
          dryRun: false,
          messages: [],
          target: { model: "deepseek-v4-pro", thinking: false },
          contextLayers: EMPTY_LAYERS,
        });

        const names = ((requests[0]?.tools ?? []) as Array<{ function: { name: string } }>)
          .map((tool) => tool.function.name)
          .sort();
        assert.deepEqual(names, ["apply_patch", "grep_files", "read_file"]);
        assert.equal(state.status, "patched");
        assert.equal(fs.readFileSync(path.join(dir, "a.ts"), "utf-8"), "export const a = 1;");
        assert.equal(state.patch_rounds[0]?.change?.source, "tool_call");
        assert.equal(state.patch_rounds[0]?.tool_calls?.[0]?.name, "apply_patch");
        assert.match(state.patches.at(-1)?.patch ?? "", /<CREATE path="a\.ts">/);

        const secondTurnMessages = requests[1]?.messages ?? [];
        const toolResult = secondTurnMessages.find((message) => message.role === "tool");
        assert.equal(toolResult?.tool_call_id, "apply_create");
        assert.match(toolResult?.content ?? "", /"apply_status":"ok"/);
      });
    });
  });

  it("rejects mixed edit and read tool calls without writing files", async () => {
    await withPatchEditsEnv(undefined, async () => {
      await withTempDir(async (dir) => {
        writePatchConfig(dir, "  edits_as_native_tool: true\n  coverage_finalization: false\n");
        const mixedMessage: ScriptedAssistantMessage = {
          role: "assistant",
          content: "",
          tool_calls: [
            applyPatchToolCall({
              protocol_op: "CREATE",
              path: "a.ts",
              content: "export const a = 1;",
            }),
            {
              id: "read_1",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"a.ts"}' },
            },
          ],
        };
        const { client } = scriptedClient([mixedMessage, mixedMessage, mixedMessage]);

        const state = await runPatchPipeline({
          state: plannedState(["a.ts"]),
          cwd: dir,
          client,
          dryRun: false,
          messages: [],
          target: { model: "deepseek-v4-pro", thinking: false },
          contextLayers: EMPTY_LAYERS,
        });

        assert.equal(state.status, "patch_failed");
        assert.equal(fs.existsSync(path.join(dir, "a.ts")), false);
        assert.equal(state.patch_rounds[0]?.action, "invalid");
        assert.match(state.patch_rounds[0]?.invalid_reason ?? "", /cannot be combined/);
      });
    });
  });

  it("rejects apply_patch plus a content change block without writing files", async () => {
    await withPatchEditsEnv(undefined, async () => {
      await withTempDir(async (dir) => {
        writePatchConfig(dir, "  edits_as_native_tool: true\n  coverage_finalization: false\n");
        const conflictingMessage: ScriptedAssistantMessage = {
          role: "assistant",
          content: createBlock("a.ts", "export const fromContent = true;"),
          tool_calls: [
            applyPatchToolCall({
              protocol_op: "CREATE",
              path: "a.ts",
              content: "export const fromTool = true;",
            }),
          ],
        };
        const { client } = scriptedClient([conflictingMessage, conflictingMessage, conflictingMessage]);

        const state = await runPatchPipeline({
          state: plannedState(["a.ts"]),
          cwd: dir,
          client,
          dryRun: false,
          messages: [],
          target: { model: "deepseek-v4-pro", thinking: false },
          contextLayers: EMPTY_LAYERS,
        });

        assert.equal(state.status, "patch_failed");
        assert.equal(fs.existsSync(path.join(dir, "a.ts")), false);
        assert.equal(state.patch_rounds[0]?.action, "invalid");
        assert.match(state.patch_rounds[0]?.invalid_reason ?? "", /content change block/);
        assert.equal(state.patch_rounds[0]?.tool_calls?.[0]?.name, "apply_patch");
        assert.deepEqual(state.patch_rounds[0]?.tool_calls?.[0]?.arguments, {
          protocol_op: "CREATE",
          path: "a.ts",
          content_length: "export const fromTool = true;".length,
        });
      });
    });
  });

  it("records redacted apply_patch arguments for invalid native edit rounds", async () => {
    await withPatchEditsEnv(undefined, async () => {
      await withTempDir(async (dir) => {
        writePatchConfig(dir, "  edits_as_native_tool: true\n  coverage_finalization: false\n");
        const invalidNativeEdit: ScriptedAssistantMessage = {
          role: "assistant",
          content: "",
          tool_calls: [
            applyPatchToolCall({
              filename: "a.ts",
              body: "export const a = 1;",
            }),
          ],
        };
        const { client } = scriptedClient([invalidNativeEdit, invalidNativeEdit, invalidNativeEdit]);

        const state = await runPatchPipeline({
          state: plannedState(["a.ts"]),
          cwd: dir,
          client,
          dryRun: false,
          messages: [],
          target: { model: "deepseek-v4-pro", thinking: false },
          contextLayers: EMPTY_LAYERS,
        });

        assert.equal(state.status, "patch_failed");
        assert.equal(state.patch_rounds[0]?.action, "invalid");
        assert.match(state.patch_rounds[0]?.invalid_reason ?? "", /protocol_op/);
        assert.equal(state.patch_rounds[0]?.tool_calls?.[0]?.name, "apply_patch");
        assert.equal(state.patch_rounds[0]?.tool_calls?.[0]?.status, "error");
        assert.deepEqual(state.patch_rounds[0]?.tool_calls?.[0]?.arguments, {
          filename: "a.ts",
          body_length: "export const a = 1;".length,
        });
      });
    });
  });

  it("keeps apply_patch available when exploration tools are paused in native edit mode", async () => {
    await withPatchEditsEnv(undefined, async () => {
      await withTempDir(async (dir) => {
        writePatchConfig(dir, "  edits_as_native_tool: true\n");
        fs.writeFileSync(path.join(dir, "context.txt"), "read me", "utf-8");
        const readTurns = Array.from({ length: 10 }, (_, i): ScriptedAssistantMessage => ({
          role: "assistant",
          content: "",
          tool_calls: [readFileToolCall("context.txt", `read_${i + 1}`)],
        }));
        const { client, requests } = scriptedClient([
          ...readTurns,
          {
            role: "assistant",
            content: "",
            tool_calls: [
              applyPatchToolCall({
                protocol_op: "CREATE",
                path: "a.ts",
                content: "export const a = 1;",
              }, "apply_after_pause"),
            ],
          },
          "<DONE/>",
        ]);

        const state = await runPatchPipeline({
          state: plannedState(["a.ts"]),
          cwd: dir,
          client,
          dryRun: false,
          messages: [],
          target: { model: "deepseek-v4-pro", thinking: false },
          contextLayers: EMPTY_LAYERS,
        });

        const pausedToolNames = ((requests[10]?.tools ?? []) as Array<{ function: { name: string } }>)
          .map((tool) => tool.function.name);
        assert.deepEqual(pausedToolNames, ["apply_patch"]);
        assert.equal(state.status, "patched");
        assert.equal(fs.readFileSync(path.join(dir, "a.ts"), "utf-8"), "export const a = 1;");
        assert.equal(state.patch_rounds[10]?.change?.source, "tool_call");
      });
    });
  });
});

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
      assert.match(patch?.patch ?? "", /<CREATE path="b\.ts">/);
      assert.ok(fs.existsSync(path.join(dir, "b.ts")));
    });
  });

  it("runs no-tools finalization after repeated invalid responses before any patch", async () => {
    await withTempDir(async (dir) => {
      const { client, toolsSeen, requests } = scriptedClient([
        "I will inspect the files first.",
        "Still thinking.",
        "No patch yet.",
        createBlock("a.ts", "export const a = 1;"),
      ]);
      const state = await runPatchPipeline({
        state: plannedState(["a.ts"], "Move old.ts -> a.ts and update imports"),
        cwd: dir,
        client,
        dryRun: false,
        messages: [],
        target: { model: "deepseek-v4-pro", thinking: false },
        contextLayers: EMPTY_LAYERS,
      });

      assert.equal(state.status, "patched");
      assert.equal(state.patches.at(-1)?.coverage_finalization_attempted, true);
      assert.deepEqual(state.patches.at(-1)?.files_changed, ["a.ts"]);
      assert.match(state.patches.at(-1)?.patch ?? "", /<CREATE path="a\.ts">/);
      assert.equal(toolsSeen.at(-1), false);
      const finalizationPrompt = requests.at(-1)?.messages?.at(-1)?.content ?? "";
      assert.match(finalizationPrompt, /RENAME \/ MOVE INTENT DETECTED FROM ORIGINAL TASK/);
      assert.match(finalizationPrompt, /<RENAME from="old\.ts" to="a\.ts" \/>/);
      assert.match(finalizationPrompt, /Do not use <CREATE> to copy/);
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
