import { execFileSync, execSync } from "node:child_process";

export interface GitInfo {
  branch: string | null;
  recentCommits: string[];
  changedFiles: string[];
  lastCommitHash: string | null;
}

export function getRecentLog(cwd: string, count: number = 20): string | null {
  try {
    return execSync(`git log --oneline -${count}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim() || null;
  } catch {
    return null;
  }
}

export function getRecentCommits(cwd: string, count: number = 10): string[] {
  try {
    const output = execSync(
      `git log --oneline --format="%h %s" -${count}`,
      { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    ).trim();
    return output ? output.split("\n") : [];
  } catch {
    return [];
  }
}

export function getChangedFiles(cwd: string, staged: boolean = false): string[] {
  try {
    const args = staged
      ? ["diff", "--cached", "--name-only"]
      : ["diff", "--name-only"];
    const output = execSync(`git ${args.join(" ")}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    return output ? output.split("\n") : [];
  } catch {
    return [];
  }
}

export function getCurrentBranch(cwd: string): string | null {
  try {
    return execSync("git branch --show-current", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim() || null;
  } catch {
    return null;
  }
}

export function getLastCommitHash(cwd: string): string | null {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim() || null;
  } catch {
    return null;
  }
}

/** Detect the default branch name — main or master. Returns "main" if neither exists. */
export function getBaseBranch(cwd: string): string {
  for (const candidate of ["main", "master"]) {
    try {
      execSync(`git rev-parse --verify ${candidate}`, {
        cwd, stdio: "ignore", timeout: 5000,
      });
      return candidate;
    } catch { /* try next */ }
  }
  return "main";
}

export function getGitInfo(cwd: string): GitInfo {
  return {
    branch: getCurrentBranch(cwd),
    recentCommits: getRecentCommits(cwd),
    changedFiles: getChangedFiles(cwd),
    lastCommitHash: getLastCommitHash(cwd),
  };
}

export function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd,
      stdio: "ignore",
      timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a checkpoint of the current working directory using git stash.
 */
export function createCheckpoint(cwd: string, message: string): boolean {
  try {
    // Check if there are any changes to stash (including untracked)
    const status = execSync("git status --short", { cwd, encoding: "utf-8" }).trim();
    if (!status) return true; // Nothing to stash, consider it a success

    execFileSync("git", ["stash", "push", "-m", message, "--include-untracked"], {
      cwd,
      stdio: "ignore",
      timeout: 10000,
    });
    const checkpointRef = findLatestCheckpointRef(cwd);
    if (checkpointRef) {
      execFileSync("git", ["stash", "apply", checkpointRef], {
        cwd,
        stdio: "ignore",
        timeout: 10000,
      });
    }
    return true;
  } catch {
    return false;
  }
}

function findLatestCheckpointRef(cwd: string): string | null {
  const list = execSync("git stash list", { cwd, encoding: "utf-8" });
  const match = list.match(/(stash@\{\d+\}):.*dsh-checkpoint-/);
  return match?.[1] ?? null;
}

/**
 * Rolls back to the latest DSH checkpoint. If no checkpoint exists, this still
 * clears changes created after a clean checkpoint.
 */
export function applyRollback(cwd: string): boolean {
  try {
    const checkpointRef = findLatestCheckpointRef(cwd);
    execFileSync("git", ["reset", "--hard", "HEAD"], { cwd, stdio: "ignore", timeout: 10000 });
    execFileSync("git", ["clean", "-fd"], { cwd, stdio: "ignore", timeout: 10000 });
    if (checkpointRef) {
      execFileSync("git", ["stash", "apply", checkpointRef], {
        cwd,
        stdio: "ignore",
        timeout: 10000,
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes all dsh-checkpoint stashes.
 */
export function cleanupCheckpoints(cwd: string): void {
  try {
    // We drop them one by one. Since dropping changes indices, we re-list or drop by pattern if possible.
    // Git doesn't support dropping by message pattern directly easily in one command.
    // We can use a while loop that drops the first one it finds until none are left.
    while (true) {
      const currentList = execSync("git stash list", { cwd, encoding: "utf-8" });
      const match = currentList.match(/stash@{(\d+)}:.*dsh-checkpoint-/);
      if (!match) break;
      const index = match[1];
      execFileSync("git", ["stash", "drop", `stash@{${index}}`], { cwd, stdio: "ignore", timeout: 5000 });
    }
  } catch {
    // Ignore errors during cleanup
  }
}
