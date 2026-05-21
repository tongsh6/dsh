import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFinalRepairRequest,
  buildRepairStallHint,
} from "./repair-loop.js";
import { detectRenameIntent } from "./rename-intent.js";
import type { PatchRecord } from "./task-state.js";

describe("repair-loop prompt helpers", () => {
  it("detects rename and move intent from task text", () => {
    assert.equal(detectRenameIntent("Rename state.ts to distill-state.ts"), true);
    assert.equal(detectRenameIntent("Move src/a.ts -> src/b.ts and update imports"), true);
    assert.equal(detectRenameIntent("Fix the failing unit test"), false);
  });

  it("adds rename guidance to final repair request", () => {
    const prevPatch: PatchRecord = {
      round: 1,
      phase: "repair",
      patch: "<empty>",
      apply_status: "failed",
      files_changed: [],
      missing_required_files: ["src/distill-state.ts"],
      repair_progress: "empty_patch",
      repair_stall_reason: "empty_patch",
    };

    const prompt = buildFinalRepairRequest(
      prevPatch,
      "Rename src/state.ts to src/distill-state.ts and update references",
    );

    assert.match(prompt, /REPAIR TOOL ACCESS PAUSED/);
    assert.match(prompt, /src\/distill-state\.ts/);
    assert.match(prompt, /RENAME \/ MOVE INTENT DETECTED/);
    assert.match(prompt, /<RENAME from=/);
    assert.match(prompt, /<SEARCH_REPLACE>/);
    assert.match(prompt, /Do not call tools/);
  });

  it("adds rename guidance to empty-patch stall hints", () => {
    const prevPatch: PatchRecord = {
      round: 1,
      phase: "repair",
      patch: "<empty>",
      apply_status: "failed",
      files_changed: [],
      missing_required_files: ["src/distill-state.ts"],
      repair_progress: "empty_patch",
      repair_stall_reason: "empty_patch",
    };

    const prompt = buildRepairStallHint(prevPatch, "Move src/state.ts -> src/distill-state.ts");

    assert.match(prompt ?? "", /REPAIR STALL DETECTED/);
    assert.match(prompt ?? "", /previous repair round emitted no usable change block/);
    assert.match(prompt ?? "", /<RENAME from=/);
    assert.match(prompt ?? "", /exec_shell is read-only/);
  });
});
