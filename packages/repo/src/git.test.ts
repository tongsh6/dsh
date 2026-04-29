import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getRecentLog, getRecentCommits, getChangedFiles, getCurrentBranch, getGitInfo } from "./git.js";

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
