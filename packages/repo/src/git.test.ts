import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import {
  getRecentLog,
  getRecentCommits,
  getChangedFiles,
  getCurrentBranch,
  getGitInfo,
  createCheckpoint,
  applyRollback,
  cleanupCheckpoints,
} from "./git.js";

describe("git helpers", () => {
  // These tests run against the dsh project itself (which may or may not be a git repo)
  // They gracefully handle non-git situations

  it("getRecentLog returns string or null", () => {
    const result = getRecentLog(process.cwd());
    assert.ok(typeof result === "string" || result === null);
  });

  it("getRecentCommits returns array", () => {
    const result = getRecentCommits(process.cwd());
    assert.ok(Array.isArray(result));
  });

  it("getChangedFiles returns array", () => {
    const result = getChangedFiles(process.cwd());
    assert.ok(Array.isArray(result));
  });

  it("getCurrentBranch returns string or null", () => {
    const result = getCurrentBranch(process.cwd());
    assert.ok(typeof result === "string" || result === null);
  });

  it("getGitInfo returns GitInfo object", () => {
    const info = getGitInfo(process.cwd());
    assert.ok("branch" in info);
    assert.ok("recentCommits" in info);
    assert.ok("changedFiles" in info);
    assert.ok("lastCommitHash" in info);
  });
});

function setupTempGitRepo(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-git-test-"));
  execSync("git init", { cwd: tmp, stdio: "ignore" });
  execSync('git config user.email "test@example.com"', { cwd: tmp });
  execSync('git config user.name "Test User"', { cwd: tmp });
  fs.writeFileSync(path.join(tmp, "tracked.txt"), "base\n", "utf-8");
  execSync("git add tracked.txt", { cwd: tmp });
  execSync('git commit -m "initial"', { cwd: tmp, stdio: "ignore" });
  return tmp;
}

describe("git checkpoints", () => {
  it("keeps existing dirty changes in the worktree when creating a checkpoint", () => {
    const tmp = setupTempGitRepo();
    try {
      fs.writeFileSync(path.join(tmp, "tracked.txt"), "base\nround1\n", "utf-8");

      assert.equal(createCheckpoint(tmp, "dsh-checkpoint-test-round-2"), true);
      assert.equal(fs.readFileSync(path.join(tmp, "tracked.txt"), "utf-8"), "base\nround1\n");

      fs.writeFileSync(path.join(tmp, "tracked.txt"), "base\nround1\nbad\n", "utf-8");

      assert.equal(applyRollback(tmp), true);
      assert.equal(fs.readFileSync(path.join(tmp, "tracked.txt"), "utf-8"), "base\nround1\n");
    } finally {
      cleanupCheckpoints(tmp);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resets failed changes even when checkpoint was created from a clean worktree", () => {
    const tmp = setupTempGitRepo();
    try {
      assert.equal(createCheckpoint(tmp, "dsh-checkpoint-test-round-1"), true);
      fs.writeFileSync(path.join(tmp, "tracked.txt"), "base\nbad\n", "utf-8");
      fs.writeFileSync(path.join(tmp, "new.txt"), "bad\n", "utf-8");

      assert.equal(applyRollback(tmp), true);
      assert.equal(fs.readFileSync(path.join(tmp, "tracked.txt"), "utf-8"), "base\n");
      assert.equal(fs.existsSync(path.join(tmp, "new.txt")), false);
    } finally {
      cleanupCheckpoints(tmp);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
