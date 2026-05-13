import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Strategy B: File-based snapshot mode for non-Git repositories.
 */

export function createFileCheckpoint(cwd: string, checkpointId: string, files: string[]): boolean {
  try {
    const snapshotDir = path.join(cwd, ".dsh", "snapshots", checkpointId);
    fs.mkdirSync(snapshotDir, { recursive: true });

    for (const file of files) {
      const srcPath = path.join(cwd, file);
      if (!fs.existsSync(srcPath)) continue;

      const destPath = path.join(snapshotDir, file);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
    return true;
  } catch {
    return false;
  }
}

export function applyFileRollback(cwd: string, checkpointId: string): boolean {
  try {
    const snapshotDir = path.join(cwd, ".dsh", "snapshots", checkpointId);
    if (!fs.existsSync(snapshotDir)) return false;

    // Restore files from snapshot
    function restoreDir(currentDir: string) {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          restoreDir(fullPath);
        } else {
          const relPath = path.relative(snapshotDir, fullPath);
          const destPath = path.join(cwd, relPath);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(fullPath, destPath);
        }
      }
    }

    restoreDir(snapshotDir);
    return true;
  } catch {
    return false;
  }
}

export function cleanupFileCheckpoints(cwd: string): void {
  try {
    const snapshotsDir = path.join(cwd, ".dsh", "snapshots");
    if (fs.existsSync(snapshotsDir)) {
      fs.rmSync(snapshotsDir, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
}
