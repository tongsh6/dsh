# DeepSeek Coding Harness Eval

The goal is to compare harness behavior, not just raw model quality. Each run should record model, thinking mode, reasoning effort, latency, prompt/completion/reasoning/cache tokens, cache hit ratio, patch result, verify result, repair count, and final status.

## Minimal Regression Set

| Eval Type | Fixture Source | Pass Signal |
|---|---|---|
| Patch Accuracy | Existing feature/bugfix/refactor fixtures plus `patch-drift.yaml`. | Correct files modified, patch applies, verification passes. |
| Tool Call Reliability | Fixtures that require `read_file`, `grep_files`, and repair `exec_shell`. | Tool arguments validate; invalid args are repaired; no silent `{}` fallback. |
| Verify/Repair | Existing `overconfidence.yaml`, `hallucinated-api.yaml`, and verification failure fixtures. | No fake done; repair quotes failure evidence; max rounds produce handoff if unresolved. |

## Extended Set

| Eval Type | Target Behavior |
|---|---|
| Search/Replace Eval | SEARCH text is copied from current file content and fallback diff is used only when appropriate. |
| Long Context Eval | Large repo context does not distract the model from plan files and verification goal. |
| No-Fake-Done Eval | Model cannot reach done without applied changes and verify evidence. |
| Existing-State Recall Eval | A resumed task reads `.dsh/task-state.json` and sidecar evidence before continuing. |
| Cost/Latency Eval | Compare cache hit ratio, reasoning tokens, and duration across repeated runs. |

## Model Matrix

Run the same fixtures across:

| Variant | Model | Thinking | Reasoning Effort |
|---|---|---:|---|
| pro-high | `deepseek-v4-pro` | yes | high |
| pro-max | `deepseek-v4-pro` | yes | max |
| flash-high | `deepseek-v4-flash` | yes | high |
| flash-max | `deepseek-v4-flash` | yes | max |

## Report Schema

Each eval result should include:

```json
{
  "fixture": "patch-drift",
  "variant": "pro-high",
  "status": "pass",
  "patchApplied": true,
  "verifyPassed": true,
  "repairRounds": 0,
  "toolArgumentErrors": 0,
  "fakeDoneRejected": 0,
  "usage": {
    "prompt": 0,
    "completion": 0,
    "reasoning": 0,
    "total": 0,
    "cacheHit": 0,
    "cacheMiss": 0,
    "cacheHitRatio": 0,
    "durationMs": 0
  }
}
```

## Current Status

DSH already has a benchmark runner and many fixtures under `packages/eval/src/fixtures`. The missing part is a first-class matrix runner that forces the four DeepSeek variants above and emits a comparable cost/latency table.
