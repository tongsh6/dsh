# Execution Contract

DSH treats model output as a proposal until the harness applies changes and verifies them. The canonical state is `.dsh/task-state.json`; derived evidence files are written beside it.

| Stage | Entry Conditions | Exit Conditions | Failure Conditions |
|---|---|---|---|
| Plan | New task or matching existing task state. | Plan has goal, files to modify, risks, and verification strategy/commands. | Missing `<PLAN>` or `<FILES>` after retry. |
| Preflight | Planned or repairing state. | Environment checks pass or are explicitly skipped/recorded. | Preflight assertions fail. |
| Patch | Planned, preflighted, preflight_failed, or repairing state. | At least one change applies and model emits `<DONE/>`, or max patch rounds reached with applied changes. | No applied changes, repeated invalid output, or tool-only stall. |
| Verify | Patched state. | Real configured assertions or shell commands pass. | Any assertion/command fails or no verify config exists. |
| Repair | Verification failed or patch failed. | Repair patch applies and verification passes. | Apply failure, repeated failure, regression rollback, or max repair rounds exhausted. |
| Handoff | Any initialized task state. | Markdown or JSON report written with status, evidence, risks, and next steps. | State file missing or unwritable output path. |
| Done | Verified state. | Task may be marked complete only after verification evidence exists. | Unverified model claims are ignored. |

## Rules

1. The model may not declare completion by text alone.
2. `<DONE/>` before any applied change is rejected.
3. Verification must be a real configured command or structured assertion.
4. Repair must be grounded in the latest patch and verify evidence.
5. Repair rounds are bounded; exhaustion produces handoff rather than infinite loops.
6. Shell access is staged: plan/patch read-only, repair/preflight diagnostic, verify/handoff no model tools.
7. Tool argument failures are returned as tool errors and recorded; missing arguments are not silently replaced with `{}`.
