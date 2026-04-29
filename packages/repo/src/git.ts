import { execSync } from "node:child_process";

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

export function getGitInfo(cwd: string): GitInfo {
  return {
    branch: getCurrentBranch(cwd),
    recentCommits: getRecentCommits(cwd),
    changedFiles: getChangedFiles(cwd),
    lastCommitHash: getLastCommitHash(cwd),
  };
}
