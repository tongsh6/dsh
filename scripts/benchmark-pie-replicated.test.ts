import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  formatReplicatedBenchmarkReport,
  loadDurationEstimates,
  scheduleLpt,
} from "./benchmark-pie-replicated.js";

function trial(id: string): { fixture: { id: string } } {
  return { fixture: { id } };
}

describe("loadDurationEstimates", () => {
  it("averages elapsedMs by fixture id and ignores malformed rows", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pie-estimates-"));
    try {
      const file = path.join(tmp, "results.json");
      fs.writeFileSync(file, JSON.stringify([
        { fixtureId: "slow", elapsedMs: 1000 },
        { fixtureId: "slow", elapsedMs: 3000 },
        { fixtureId: "fast", durationMs: 500 },
        { fixtureId: "bad", elapsedMs: 0 },
        { fixtureId: 123, elapsedMs: 1000 },
      ]), "utf-8");

      const estimates = loadDurationEstimates(file);

      assert.equal(estimates.get("slow"), 2000);
      assert.equal(estimates.get("fast"), 500);
      assert.equal(estimates.has("bad"), false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns an empty map for missing or malformed files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pie-estimates-"));
    try {
      assert.equal(loadDurationEstimates(path.join(tmp, "missing.json")).size, 0);
      const malformed = path.join(tmp, "malformed.json");
      fs.writeFileSync(malformed, "{", "utf-8");
      assert.equal(loadDurationEstimates(malformed).size, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("scheduleLpt", () => {
  it("assigns longest trials first to the currently lightest lane", () => {
    const estimates = new Map([
      ["a", 10],
      ["b", 9],
      ["c", 8],
      ["d", 1],
    ]);

    const lanes = scheduleLpt(
      [trial("a"), trial("b"), trial("c"), trial("d")],
      2,
      estimates,
    );

    assert.deepEqual(
      lanes.map((lane) => lane.trials.map((t) => t.fixture.id)),
      [["a", "d"], ["b", "c"]],
    );
    assert.deepEqual(lanes.map((lane) => lane.estimatedMs), [11, 17]);
  });

  it("keeps input order as the tie-breaker for equal estimates", () => {
    const lanes = scheduleLpt(
      [trial("a"), trial("b"), trial("c")],
      2,
      new Map([["a", 5], ["b", 5], ["c", 5]]),
    );

    assert.deepEqual(
      lanes.map((lane) => lane.trials.map((t) => t.fixture.id)),
      [["a", "c"], ["b"]],
    );
  });

  it("falls back to one lane when laneCount is invalid", () => {
    const lanes = scheduleLpt([trial("a"), trial("b")], 0, new Map(), 7);

    assert.equal(lanes.length, 1);
    assert.equal(lanes[0]!.estimatedMs, 14);
  });
});

describe("formatReplicatedBenchmarkReport", () => {
  it("renders governance labels from metadata failureMatrixFixtures", () => {
    const md = formatReplicatedBenchmarkReport(
      {
        runId: "260517000000",
        seed: 123,
        reps: 3,
        configs: ["card_on", "card_off"] as const,
        fixtureCount: 1,
        totalTrials: 2,
        patchFlags: {
          editsAsNativeTool: true,
          editsAsNativeToolEnv: "true",
        },
        failureMatrixFixtures: [
          {
            fixture: "rh-test-dashboard-version",
            repo: "release-hub",
            failureType: "wrong_verification_command",
            status: "regressed",
            requiresReplicatedConfirmation: true,
            evidencePolicy: "label_required",
            comparabilityRisk: true,
            lastEvidence: "docs/reports/runlogs/example/results.json",
            notes: "replicated regression",
            governanceNotes: "label separately until repaired",
          },
        ],
        summary: {
          card_on_pass: 0,
          card_on_total: 1,
          card_off_pass: 1,
          card_off_total: 1,
          failureClasses: {
            card_on: { model_protocol_plan_invalid: 1 },
            card_off: {},
          },
          patchObservability: {
            card_on: {
              totalPatchRecords: 2,
              emptyPatchRecords: 1,
              literalEmptyPatchRecords: 1,
              failedEmptyPatchRecords: 1,
              failedNonEmptyPatchRecords: 0,
              dsmlSalvageAppliedRecords: 0,
              dsmlSalvageAppliedRounds: 1,
              partialCoverageRecords: 1,
              repairEmptyPatchStalls: 1,
              repairNoCoverageProgressStalls: 0,
            },
            card_off: {
              totalPatchRecords: 0,
              emptyPatchRecords: 0,
              literalEmptyPatchRecords: 0,
              failedEmptyPatchRecords: 0,
              failedNonEmptyPatchRecords: 0,
              dsmlSalvageAppliedRecords: 0,
              dsmlSalvageAppliedRounds: 0,
              partialCoverageRecords: 0,
              repairEmptyPatchStalls: 0,
              repairNoCoverageProgressStalls: 0,
            },
          },
        },
      },
      [
        {
          fixtureId: "rh-test-dashboard-version",
          config: "card_on",
          rep: 0,
          trialIndex: 1,
          startedAt: "2026-05-17T00:00:00.000Z",
          completedAt: "2026-05-17T00:01:00.000Z",
          elapsedMs: 60_000,
          testsPassed: false,
          error: "DeepSeek 未返回有效的 FILES 块",
          failureClass: "model_protocol_plan_invalid",
          toolCalls: [{ name: "apply_patch", status: "success" }],
          patchRoundActions: [{
            round: 1,
            action: "change",
            toolCalls: [{ name: "apply_patch", status: "success" }],
            change: {
              op: "CREATE",
              file: "src/a.ts",
              source: "tool_call",
              applyStatus: "ok",
            },
          }],
        },
      ],
    );

    assert.match(md, /metadata\.failureMatrixFixtures/);
    assert.match(md, /\| rh-test-dashboard-version \| label_required \| yes \| regressed \| label separately until repaired \|/);
    assert.match(md, /Card ON: 0\/1/);
    assert.match(md, /Card OFF: 1\/1/);
    assert.match(md, /patch\.edits_as_native_tool: true/);
    assert.match(md, /Failure Classification/);
    assert.match(md, /\| model_protocol_plan_invalid \| 1 \| 0 \|/);
    assert.match(md, /Patch Observability/);
    assert.match(md, /\| failedEmptyPatchRecords \| 1 \| 0 \|/);
    assert.match(md, /\| dsmlSalvageAppliedRounds \| 1 \| 0 \|/);
    assert.match(md, /\| repairEmptyPatchStalls \| 1 \| 0 \|/);
    assert.match(md, /Native Edit Tool Observability/);
    assert.match(md, /\| applyPatchToolCalls \| 1 \| 0 \|/);
    assert.match(md, /\| applyPatchSuccessRecords \| 1 \| 0 \|/);
    assert.match(md, /\| toolCallChangeRecords \| 1 \| 0 \|/);
  });
});
