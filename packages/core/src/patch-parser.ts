import * as fs from "node:fs";
import * as path from "node:path";
import { applyPatch as diffApplyPatch } from "diff";

export interface ParsedPatch {
  files: string[];
  patchText: string;
  hunks: HunkInfo[];
}

export interface HunkInfo {
  file: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export class PatchParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchParseError";
  }
}

// ---- Extraction ----

export function extractPatchBlock(response: string): string | null {
  const match = response.match(/<PATCH>([\s\S]*?)<\/PATCH>/);
  if (!match || !match[1]) return null;
  return match[1].trim();
}

export function extractFilesBlock(response: string): string[] {
  const match = response.match(/<FILES>([\s\S]*?)<\/FILES>/);
  if (!match || !match[1]) return [];
  return match[1]
    .trim()
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter((f) => f.length > 0);
}

export function extractVerifyBlock(response: string): string[] {
  const match = response.match(/<VERIFY>([\s\S]*?)<\/VERIFY>/);
  if (!match || !match[1]) return [];
  return match[1]
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

export function extractPlanBlock(response: string): string | null {
  const match = response.match(/<PLAN>([\s\S]*?)<\/PLAN>/);
  if (!match || !match[1]) return null;
  return match[1].trim();
}

export function extractRisksBlock(response: string): string[] {
  const match = response.match(/<RISKS>([\s\S]*?)<\/RISKS>/);
  if (!match || !match[1]) return [];
  return match[1]
    .trim()
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter((l) => l.length > 0);
}

// ---- Validation ----

export function validateDiff(patchText: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!patchText || patchText.trim().length === 0) {
    errors.push("Patch is empty");
    return { valid: false, errors };
  }

  const fileHeaders = patchText.match(/^---\s+(a\/|\/dev\/null)/gm);
  if (!fileHeaders || fileHeaders.length === 0) {
    errors.push("No unified diff headers found (--- a/... or --- /dev/null)");
  }

  const hunkHeaders = patchText.match(/^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/gm);
  if (!hunkHeaders || hunkHeaders.length === 0) {
    errors.push("No hunk headers found (@@ -l,s +l,s @@)");
  }

  return { valid: errors.length === 0, errors };
}

export function parseHunks(patchText: string): HunkInfo[] {
  const hunks: HunkInfo[] = [];
  const hunkRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/gm;
  const fileRegex = /^---\s+a\/(.+)$/gm;

  // Find file before each hunk
  let currentFile = "";
  const lines = patchText.split("\n");

  for (const line of lines) {
    const fileMatch = line.match(/^---\s+a\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1] ?? "";
      continue;
    }
    const hunkMatch = line.match(
      /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/,
    );
    if (hunkMatch) {
      hunks.push({
        file: currentFile,
        oldStart: parseInt(hunkMatch[1] ?? "0", 10),
        oldCount: parseInt(hunkMatch[2] ?? "1", 10),
        newStart: parseInt(hunkMatch[3] ?? "0", 10),
        newCount: parseInt(hunkMatch[4] ?? "1", 10),
      });
    }
  }

  return hunks;
}

export function parsePatch(response: string): ParsedPatch {
  const patchText = extractPatchBlock(response);
  if (!patchText) {
    throw new PatchParseError("No <PATCH> block found in response");
  }

  const validation = validateDiff(patchText);
  if (!validation.valid) {
    throw new PatchParseError(
      `Patch validation failed: ${validation.errors.join("; ")}`,
    );
  }

  const files = extractFilesBlock(response);
  const hunks = parseHunks(patchText);

  return { files, patchText, hunks };
}

// ---- Apply ----

export function applyPatch(
  cwd: string,
  patchText: string,
  dryRun: boolean = false,
): { success: boolean; files: string[]; error?: string } {
  const filePatches = splitPatchByFile(patchText);
  const changedFiles: string[] = [];

  for (const { filePath, filePatch } of filePatches) {
    const absPath = path.join(cwd, filePath);

    let source: string;
    // Check if this is a new file
    // 1. Explicit /dev/null source header
    // 2. File doesn't exist and hunk starts at -0,0 (model used --- a/newfile)
    const hasDevNull = /^---\s+\/dev\/null$/m.test(filePatch);
    const hasNewFileHunk = /^@@\s+-0,0\s+\+/.test(filePatch);
    const fileExists = fs.existsSync(absPath);

    if (!fileExists && (hasDevNull || hasNewFileHunk)) {
      source = "";
    } else {
      try {
        source = fs.readFileSync(absPath, "utf-8");
      } catch {
        return {
          success: false,
          files: changedFiles,
          error: `Cannot read ${filePath}`,
        };
      }
    }

    const isNewFile = !fileExists && (hasDevNull || hasNewFileHunk);

    // Ensure parent directory exists for new files
    if (isNewFile && !dryRun) {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
    }

    // For new files with empty source, build from added lines directly
    let result: string | false;
    if (isNewFile && source === "") {
      const addedLines: string[] = [];
      for (const line of filePatch.split("\n")) {
        if (line.startsWith("+")) addedLines.push(line.slice(1));
      }
      result = addedLines.join("\n");
    } else {
      // Try the diff library first (strict), fall back to lenient manual apply
      try {
        result = diffApplyPatch(source, filePatch);
      } catch {
        result = false;
      }
    }

    if (result === false) {
      // Fallback: lenient manual application
      const fallbackResult = applyPatchLenient(source, filePatch);
      if (fallbackResult === null) {
        return {
          success: false,
          files: changedFiles,
          error: `Failed to apply patch to ${filePath}`,
        };
      }
      result = fallbackResult;
    }

    if (!dryRun) {
      fs.writeFileSync(absPath, result, "utf-8");
    }
    changedFiles.push(filePath);
  }

  return { success: true, files: changedFiles };
}

// Lenient patch applyer that ignores hunk line count mismatches.
// Works by finding hunk positions in source and splicing in additions.
function applyPatchLenient(source: string, patchText: string): string | null {
  const sourceLines = source.split("\n");
  const patchLines = patchText.split("\n");

  // Parse hunks: find @@ headers and collect line groups
  interface Hunk {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: string[];
  }

  const hunks: Hunk[] = [];
  let i = 0;
  // Skip file headers
  while (i < patchLines.length && !patchLines[i]!.startsWith("@@")) i++;

  while (i < patchLines.length) {
    const hunkMatch = patchLines[i]!.match(
      /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/,
    );
    if (!hunkMatch) { i++; continue; }

    const hunk: Hunk = {
      oldStart: parseInt(hunkMatch[1]!, 10),
      oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
      newStart: parseInt(hunkMatch[3]!, 10),
      newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
      lines: [],
    };
    i++;

    // Collect lines until next hunk or end
    while (i < patchLines.length && !patchLines[i]!.startsWith("@@") && !patchLines[i]!.startsWith("--- ")) {
      hunk.lines.push(patchLines[i]!);
      i++;
    }
    hunks.push(hunk);
  }

  // Apply hunks in reverse order to preserve line numbers
  for (let h = hunks.length - 1; h >= 0; h--) {
    const hunk = hunks[h]!;
    const oldStartIdx = hunk.oldStart - 1; // convert to 0-based

    // Find matching context in source
    // Search around the expected position
    let bestMatch = oldStartIdx;
    let bestScore = 0;

    for (let searchOff = -5; searchOff <= 5; searchOff++) {
      const candidate = oldStartIdx + searchOff;
      if (candidate < 0 || candidate >= sourceLines.length) continue;
      let score = 0;
      for (let li = 0; li < hunk.lines.length; li++) {
        const hl = hunk.lines[li]!;
        if (hl.startsWith("+")) continue; // additions don't need to match
        const expectedLine = hl.startsWith("-") ? hl.slice(1) : hl.slice(1);
        const actual = sourceLines[candidate + li];
        if (actual === undefined) break;
        if (actual === expectedLine || (hl.startsWith(" ") && actual === expectedLine)) {
          score++;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }

    if (bestScore === 0) return null;

    // Remove old lines, insert new lines
    const toRemove = hunk.lines.filter((l) => l.startsWith("-") || l.startsWith(" ")).length;
    const newLines = hunk.lines
      .filter((l) => l.startsWith("+") || l.startsWith(" "))
      .map((l) => l.slice(1)); // Strip the +/space prefix

    sourceLines.splice(bestMatch, toRemove, ...newLines);
  }

  return sourceLines.join("\n");
}

function splitPatchByFile(patchText: string): { filePath: string; filePatch: string }[] {
  const result: { filePath: string; filePatch: string }[] = [];
  // Match both --- a/file and --- /dev/null
  const fileHeader = /^---\s+(a\/.+|\/dev\/null)$/gm;

  // Find all file header start positions
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = fileHeader.exec(patchText)) !== null) {
    positions.push(m.index);
  }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]!;
    const end = i + 1 < positions.length ? positions[i + 1]! : patchText.length;
    const filePatch = patchText.slice(start, end).trim();
    // Extract file path from --- a/file or +++ b/file (for new files)
    const srcMatch = /^---\s+a\/(.+)$/m.exec(filePatch);
    const newFileMatch = /^---\s+\/dev\/null$/m.exec(filePatch);
    const destMatch = /^\+\+\+\s+b\/(.+)$/m.exec(filePatch);
    if (srcMatch && srcMatch[1]) {
      result.push({ filePath: srcMatch[1], filePatch });
    } else if (newFileMatch && destMatch && destMatch[1]) {
      result.push({ filePath: destMatch[1], filePatch });
    }
  }

  return result;
}
