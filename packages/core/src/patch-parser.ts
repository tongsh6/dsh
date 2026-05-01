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

export interface CreateBlock {
  path: string;
  content: string;
}

export interface SearchReplaceBlock {
  filePath: string;
  search: string;
  replace: string;
}

export interface RenameBlock {
  from: string;
  to: string;
}

export interface ParsedChanges {
  creates: CreateBlock[];
  renames: RenameBlock[];
  patchText: string | null;
  patchFiles: string[];
  hunks: HunkInfo[];
  deletePaths: string[];
  searchReplaceBlocks: SearchReplaceBlock[];
}

export interface ApplyChangesResult {
  success: boolean;
  createdFiles: string[];
  renamedFiles: string[];
  patchedFiles: string[];
  deletedFiles: string[];
  error?: string;
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

export function extractCreateBlocks(response: string): CreateBlock[] {
  const blocks: CreateBlock[] = [];
  const regex = /<CREATE\s+path="([^"]+)"\s*>([\s\S]*?)<\/CREATE>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(response)) !== null) {
    const filePath = match[1]?.trim();
    const content = match[2] ?? "";
    if (filePath) {
      blocks.push({ path: filePath, content });
    }
  }
  return blocks;
}

export function extractDeleteBlocks(response: string): string[] {
  const paths: string[] = [];
  const regex = /<DELETE\s+path="([^"]+)"\s*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(response)) !== null) {
    const filePath = match[1]?.trim();
    if (filePath) paths.push(filePath);
  }
  return paths;
}

export function extractRenameBlocks(response: string): RenameBlock[] {
  const blocks: RenameBlock[] = [];
  const regex = /<RENAME\s+from="([^"]+)"\s+to="([^"]+)"\s*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(response)) !== null) {
    const from = match[1]?.trim();
    const to = match[2]?.trim();
    if (from && to) {
      blocks.push({ from, to });
    }
  }
  return blocks;
}

/**
 * Extract SEARCH/REPLACE blocks from response.
 * Uses XML sub-tags matching DeepSeek's native XML block output style:
 * <SEARCH>exact code</SEARCH>
 * <REPLACE>replacement code</REPLACE>
 */
export function extractSearchReplaceBlocks(response: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  const blockRegex = /<PATCH\s+type="search"\s+file="([^"]+)"\s*>([\s\S]*?)<\/PATCH>/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(response)) !== null) {
    const filePath = match[1]?.trim();
    const body = match[2] ?? "";

    if (!filePath) continue;

    const searchMatch = body.match(/<SEARCH>([\s\S]*?)<\/SEARCH>/);
    const replaceMatch = body.match(/<REPLACE>([\s\S]*?)<\/REPLACE>/);
    if (!searchMatch || !replaceMatch) continue;

    const search = searchMatch[1] ?? "";
    const replace = replaceMatch[1] ?? "";

    blocks.push({ filePath, search, replace });
  }

  return blocks;
}

// ---- Path validation ----

export function validateCreatePaths(blocks: CreateBlock[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const block of blocks) {
    if (!block.path || block.path.trim().length === 0) {
      errors.push("CREATE block has empty path");
      continue;
    }

    if (path.isAbsolute(block.path)) {
      errors.push(`CREATE path is absolute (must be relative): ${block.path}`);
    }

    if (block.path.includes("..")) {
      errors.push(`CREATE path contains '..' (path traversal not allowed): ${block.path}`);
    }

    if (!block.content || block.content.trim().length === 0) {
      errors.push(`CREATE block for ${block.path} is empty`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function detectCreatePatchConflicts(
  creates: CreateBlock[],
  patchFiles: string[],
): string[] {
  const createPaths = new Set(creates.map((c) => c.path));
  return patchFiles.filter((f) => createPaths.has(f));
}

// ---- Apply ----

export function applyCreates(
  cwd: string,
  blocks: CreateBlock[],
  dryRun: boolean = false,
): { success: boolean; files: string[]; error?: string } {
  const createdFiles: string[] = [];

  for (const block of blocks) {
    const absPath = path.join(cwd, block.path);

    // Double-check path safety
    if (path.isAbsolute(block.path) || block.path.includes("..")) {
      return {
        success: false,
        files: createdFiles,
        error: `Unsafe path rejected: ${block.path}`,
      };
    }

    // CREATE is for NEW files only — reject if file already exists
    if (fs.existsSync(absPath)) {
      return {
        success: false,
        files: createdFiles,
        error: `CREATE rejected: ${block.path} already exists. Use <PATCH> or <PATCH type="search"> to modify existing files.`,
      };
    }

    if (!dryRun) {
      try {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, block.content, "utf-8");
      } catch (e) {
        return {
          success: false,
          files: createdFiles,
          error: `Failed to create ${block.path}: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    createdFiles.push(block.path);
  }

  return { success: true, files: createdFiles };
}

export function applyDeletes(
  cwd: string,
  paths: string[],
  dryRun: boolean = false,
): { success: boolean; files: string[]; error?: string } {
  const deletedFiles: string[] = [];

  for (const filePath of paths) {
    if (path.isAbsolute(filePath) || filePath.includes("..")) {
      return {
        success: false,
        files: deletedFiles,
        error: `Unsafe path rejected: ${filePath}`,
      };
    }

    const absPath = path.join(cwd, filePath);

    if (!dryRun) {
      try {
        if (fs.existsSync(absPath)) {
          fs.unlinkSync(absPath);
        }
      } catch (e) {
        return {
          success: false,
          files: deletedFiles,
          error: `Failed to delete ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    deletedFiles.push(filePath);
  }

  return { success: true, files: deletedFiles };
}

export function validateRenamePaths(blocks: RenameBlock[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const block of blocks) {
    if (!block.from || block.from.trim().length === 0) {
      errors.push("RENAME has empty 'from' path");
    }
    if (!block.to || block.to.trim().length === 0) {
      errors.push("RENAME has empty 'to' path");
    }
    if (path.isAbsolute(block.from) || block.from.includes("..")) {
      errors.push(`RENAME 'from' path is unsafe: ${block.from}`);
    }
    if (path.isAbsolute(block.to) || block.to.includes("..")) {
      errors.push(`RENAME 'to' path is unsafe: ${block.to}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function applyRenames(
  cwd: string,
  blocks: RenameBlock[],
  dryRun: boolean = false,
): { success: boolean; files: string[]; error?: string } {
  const renamedFiles: string[] = [];

  for (const block of blocks) {
    const fromAbs = path.join(cwd, block.from);
    const toAbs = path.join(cwd, block.to);

    if (path.isAbsolute(block.from) || block.from.includes("..") ||
        path.isAbsolute(block.to) || block.to.includes("..")) {
      return {
        success: false,
        files: renamedFiles,
        error: `Unsafe RENAME path: ${block.from} -> ${block.to}`,
      };
    }

    if (!dryRun) {
      try {
        if (!fs.existsSync(fromAbs)) {
          return {
            success: false,
            files: renamedFiles,
            error: `Cannot rename — source does not exist: ${block.from}`,
          };
        }
        fs.mkdirSync(path.dirname(toAbs), { recursive: true });
        fs.renameSync(fromAbs, toAbs);
      } catch (e) {
        return {
          success: false,
          files: renamedFiles,
          error: `Failed to rename ${block.from} -> ${block.to}: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    renamedFiles.push(`${block.from} -> ${block.to}`);
  }

  return { success: true, files: renamedFiles };
}

export function applySearchReplace(
  cwd: string,
  blocks: SearchReplaceBlock[],
  dryRun: boolean = false,
): { success: boolean; files: string[]; error?: string } {
  const changedFiles: string[] = [];

  for (const block of blocks) {
    const absPath = path.join(cwd, block.filePath);

    // Path safety check
    if (path.isAbsolute(block.filePath) || block.filePath.includes("..")) {
      return {
        success: false,
        files: changedFiles,
        error: `Unsafe path rejected: ${block.filePath}`,
      };
    }

    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch {
      return {
        success: false,
        files: changedFiles,
        error: `Cannot read ${block.filePath}`,
      };
    }

    // Try exact match first, then lenient matching
    let newContent: string | null = null;

    // Level 1: exact match
    if (content.includes(block.search)) {
      newContent = content.replace(block.search, block.replace);
    }

    // Level 2: trim-agnostic (ignore leading/trailing whitespace per line)
    if (newContent === null) {
      const searchLines = block.search.split("\n");
      const contentLines = content.split("\n");
      // Find the best matching position by comparing trimmed lines
      let bestPos = -1;
      let bestScore = 0;
      for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
        let score = 0;
        for (let j = 0; j < searchLines.length; j++) {
          if ((contentLines[i + j] ?? "").trim() === (searchLines[j] ?? "").trim()) {
            score++;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestPos = i;
        }
      }
      // Require at least 80% of lines to match
      if (bestScore >= searchLines.length * 0.8) {
        const replaceLines = block.replace.split("\n");
        const resultLines = [
          ...contentLines.slice(0, bestPos),
          ...replaceLines,
          ...contentLines.slice(bestPos + searchLines.length),
        ];
        newContent = resultLines.join("\n");
      }
    }

    // Level 3: substring of SEARCH (try the first and last non-empty lines as anchors)
    if (newContent === null) {
      const searchTrimmed = block.search.trim();
      // Try to find a substring that exists in content
      const searchLines = searchTrimmed.split("\n");
      if (searchLines.length >= 3) {
        // Use first and last meaningful lines as anchors
        const firstLine = searchLines[0]?.trim() ?? "";
        const lastLine = searchLines[searchLines.length - 1]?.trim() ?? "";
        const firstIdx = content.split("\n").findIndex((l) => l.trim() === firstLine);
        const lastIdx = content.split("\n").findIndex((l) => l.trim() === lastLine);
        if (firstIdx >= 0 && lastIdx > firstIdx) {
          const contentLines = content.split("\n");
          const replaceLines = block.replace.split("\n");
          const resultLines = [
            ...contentLines.slice(0, firstIdx),
            ...replaceLines,
            ...contentLines.slice(lastIdx + 1),
          ];
          newContent = resultLines.join("\n");
        }
      }
    }

    if (newContent === null) {
      return {
        success: false,
        files: changedFiles,
        error: `Search block not found in ${block.filePath}`,
      };
    }

    if (!dryRun) {
      fs.writeFileSync(absPath, newContent, "utf-8");
    }

    changedFiles.push(block.filePath);
  }

  return { success: true, files: changedFiles };
}

// ---- Combined parsing and application ----

export function parseChanges(response: string): ParsedChanges {
  const creates = extractCreateBlocks(response);
  const renames = extractRenameBlocks(response);
  const patchText = extractPatchBlock(response);
  const deletePaths = extractDeleteBlocks(response);
  const searchReplaceBlocks = extractSearchReplaceBlocks(response);

  // Validate CREATE paths
  const pathValidation = validateCreatePaths(creates);
  if (!pathValidation.valid) {
    throw new PatchParseError(
      `CREATE validation failed: ${pathValidation.errors.join("; ")}`,
    );
  }

  // Validate RENAME paths
  const renameValidation = validateRenamePaths(renames);
  if (!renameValidation.valid) {
    throw new PatchParseError(
      `RENAME validation failed: ${renameValidation.errors.join("; ")}`,
    );
  }

  // Parse hunks from PATCH block if present
  let hunks: HunkInfo[] = [];
  if (patchText) {
    const validation = validateDiff(patchText);
    if (!validation.valid) {
      throw new PatchParseError(
        `Patch validation failed: ${validation.errors.join("; ")}`,
      );
    }
    hunks = parseHunks(patchText);
  }

  // Detect conflicts
  const patchFiles = patchText ? parsePatchFiles(patchText) : [];
  const conflicts = detectCreatePatchConflicts(creates, patchFiles);
  if (conflicts.length > 0) {
    throw new PatchParseError(
      `CREATE and PATCH target same file(s): ${conflicts.join(", ")}. Use only one operation per file.`,
    );
  }

  // Detect RENAME conflicts: RENAME from/to should not overlap with other operations
  const createPaths = new Set(creates.map((c) => c.path));
  const deletePathSet = new Set(deletePaths);

  for (const r of renames) {
    if (createPaths.has(r.to)) {
      throw new PatchParseError(
        `RENAME destination conflicts with CREATE: ${r.to}`,
      );
    }
    if (deletePathSet.has(r.from)) {
      throw new PatchParseError(
        `RENAME source conflicts with DELETE: ${r.from}`,
      );
    }
    if (patchFiles.includes(r.from)) {
      throw new PatchParseError(
        `RENAME source conflicts with PATCH: ${r.from}`,
      );
    }
    if (patchFiles.includes(r.to)) {
      throw new PatchParseError(
        `RENAME destination conflicts with PATCH: ${r.to}`,
      );
    }
  }

  // Detect CREATE+DELETE same file conflicts
  for (const c of creates) {
    if (deletePathSet.has(c.path)) {
      throw new PatchParseError(
        `CREATE and DELETE target same file: ${c.path}. Use only one operation per file.`,
      );
    }
  }

  // Detect Search/Replace conflicts with CREATE and DELETE
  const srPaths = new Set(searchReplaceBlocks.map((s) => s.filePath));
  for (const c of creates) {
    if (srPaths.has(c.path)) {
      throw new PatchParseError(
        `CREATE and SEARCH/REPLACE target same file: ${c.path}. Use only one operation per file.`,
      );
    }
  }
  for (const dp of deletePaths) {
    if (srPaths.has(dp)) {
      throw new PatchParseError(
        `DELETE and SEARCH/REPLACE target same file: ${dp}. Use only one operation per file.`,
      );
    }
  }

  // Validate DELETE paths
  for (const dp of deletePaths) {
    if (path.isAbsolute(dp) || dp.includes("..")) {
      throw new PatchParseError(
        `DELETE path is unsafe (must be relative, no ..): ${dp}`,
      );
    }
  }

  // Validate that at least one operation block is present
  if (creates.length === 0 && renames.length === 0 && !patchText && deletePaths.length === 0 && searchReplaceBlocks.length === 0) {
    throw new PatchParseError(
      "No <CREATE>, <RENAME>, <PATCH>, <DELETE>, or <PATCH type=\"search\"> blocks found in response",
    );
  }

  // Warn about /dev/null usage — recommend CREATE instead
  if (patchText && /^---\s+\/dev\/null$/m.test(patchText)) {
    throw new PatchParseError(
      "PATCH block uses /dev/null for new files. Use <CREATE path=\"...\"> block instead.",
    );
  }

  return {
    creates,
    renames,
    patchText,
    patchFiles,
    hunks,
    deletePaths,
    searchReplaceBlocks,
  };
}

export function applyChanges(
  cwd: string,
  changes: ParsedChanges,
  dryRun: boolean = false,
): ApplyChangesResult {
  const createdFiles: string[] = [];
  const renamedFiles: string[] = [];
  const patchedFiles: string[] = [];
  const deletedFiles: string[] = [];

  // Apply CREATE blocks first
  if (changes.creates.length > 0) {
    const result = applyCreates(cwd, changes.creates, dryRun);
    if (!result.success) {
      return { success: false, createdFiles, renamedFiles, patchedFiles, deletedFiles, error: result.error };
    }
    createdFiles.push(...result.files);
  }

  // Apply RENAME blocks second
  if (changes.renames.length > 0) {
    const result = applyRenames(cwd, changes.renames, dryRun);
    if (!result.success) {
      return { success: false, createdFiles, renamedFiles, patchedFiles, deletedFiles, error: result.error };
    }
    renamedFiles.push(...result.files);
  }

  // Apply DELETE blocks third
  if (changes.deletePaths.length > 0) {
    const result = applyDeletes(cwd, changes.deletePaths, dryRun);
    if (!result.success) {
      return { success: false, createdFiles, renamedFiles, patchedFiles, deletedFiles, error: result.error };
    }
    deletedFiles.push(...result.files);
  }

  // Apply Search/Replace blocks (before diff PATCH for predictability)
  if (changes.searchReplaceBlocks.length > 0) {
    const result = applySearchReplace(cwd, changes.searchReplaceBlocks, dryRun);
    if (!result.success) {
      return { success: false, createdFiles, renamedFiles, patchedFiles, deletedFiles, error: result.error };
    }
    patchedFiles.push(...result.files);
  }

  // Apply PATCH block last
  if (changes.patchText) {
    const result = applyPatch(cwd, changes.patchText, dryRun);
    if (!result.success) {
      return { success: false, createdFiles, renamedFiles, patchedFiles, deletedFiles, error: result.error };
    }
    patchedFiles.push(...result.files);
  }

  return { success: true, createdFiles, renamedFiles, patchedFiles, deletedFiles };
}

function parsePatchFiles(patchText: string): string[] {
  const files: string[] = [];
  const fileHeader = /^---\s+a\/(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = fileHeader.exec(patchText)) !== null) {
    if (m[1]) files.push(m[1]);
  }
  return files;
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
        // Skip diff headers (---, +++, @@) and removed/context lines
        if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@ ")) continue;
        if (line.startsWith("+")) addedLines.push(line.slice(1));
        else if (line.startsWith(" ")) addedLines.push(line.slice(1));
        // lines starting with - have no meaning for new files
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
