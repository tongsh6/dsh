import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadDurationEstimates, scheduleLpt } from "./benchmark-pie-replicated.js";

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
