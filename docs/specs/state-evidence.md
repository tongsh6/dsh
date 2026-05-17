# State And Evidence

`.dsh/task-state.json` is the canonical task state. Every write also emits sidecar files for auditability and handoff:

| File | Purpose |
|---|---|
| `.dsh/current-goal.md` | Current task, status, type, creation time, and verification goal. |
| `.dsh/plan.json` | Structured plan block with files, risks, verify commands, and raw plan text. |
| `.dsh/changed-files.json` | Deduplicated files changed by applied patch and repair rounds. |
| `.dsh/tool-calls.jsonl` | Tool calls from preflight, patch, and repair loops with arguments, status, and summary. |
| `.dsh/verify-result.json` | Latest and historical verify results. |
| `.dsh/failure-evidence.md` | Failed verify output and failed or partial patch evidence. |
| `.dsh/repair-history.jsonl` | Per-round patch status, files, rollback, and verify outcome. |
| `.dsh/handoff.md` | Compact handoff summary with completed work, unfinished state, risks, evidence, and next steps. |

## Semantics

- New tasks read existing state first; if the task description matches, the plan phase continues with existing evidence.
- The model is not trusted as the state store. The harness writes state after plan, patch rounds, tool rounds, verify, repair, static scan, and handoff.
- Verify results must be persisted before repair.
- Repair prompts are built from persisted patch, verification, static scan, and failure evidence.
- Handoff must explicitly show completed work, unfinished work, risks, evidence, and next steps.

## Current Limits

- Sidecar files are derived views; editing them does not update `task-state.json`.
- Evidence file format is intentionally simple and not yet versioned separately from task state.
- Very large failure logs are excerpted in `failure-evidence.md`; the full output remains in `task-state.json`.
