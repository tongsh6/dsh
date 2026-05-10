import * as fs from "node:fs";
import * as path from "node:path";
import { applyPatch as diffApplyPatch } from "diff";

/** v0.3 协议操作类型（SPEC v0.3 §7.3.2） */
export type ProtocolOp = "CREATE" | "PATCH" | "SEARCH_REPLACE" | "INSERT" | "DELETE" | "RENAME";

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

export interface InsertBlock {
  filePath: string;
  anchor: string;
  position: "before" | "after";
  content: string;
  fromFile?: string;  // if set, read content from this file instead
}

export interface ParsedChanges {
  creates: CreateBlock[];
  renames: RenameBlock[];
  patchText: string | null;
  patchFiles: string[];
  hunks: HunkInfo[];
  deletePaths: string[];
  searchReplaceBlocks: SearchReplaceBlock[];
  insertBlocks: InsertBlock[];
}

export interface ApplyChangesResult {
  success: boolean;
  createdFiles: string[];
  renamedFiles: string[];
  patchedFiles: string[];
  deletedFiles: string[];
  error?: string;
}

export interface ChangeBlock {
  op: ProtocolOp;
  file: string;
  raw_block: string;
  create?: CreateBlock;
  patchText?: string;
  searchReplace?: SearchReplaceBlock;
  insert?: InsertBlock;
  rename?: RenameBlock;
}

export type PatchTurnAction =
  | { kind: "tools" }
  | { kind: "change"; change: ChangeBlock }
  | { kind: "done" }
  | { kind: "invalid"; reason: string };

/**
 * 从 ParsedChanges 中检测实际使用的协议操作类型。
 * 用于 benchmark 结果中记录模型实际选择的协议操作。
 */
export function detectProtocolOps(changes: ParsedChanges): ProtocolOp[] {
  const ops: ProtocolOp[] = [];
  if (changes.creates.length > 0) ops.push("CREATE");
  if (changes.patchText) ops.push("PATCH");
  if (changes.searchReplaceBlocks.length > 0) ops.push("SEARCH_REPLACE");
  if (changes.insertBlocks.length > 0) ops.push("INSERT");
  if (changes.deletePaths.length > 0) ops.push("DELETE");
  if (changes.renames.length > 0) ops.push("RENAME");
  return ops;
}

/**
 * 从原始 patch 文本中检测协议操作类型。
 * 逐个 XML 标签匹配，避免跨标签 type="search" 误判。
 */
export function detectProtocolOpsFromText(patchText: string): ProtocolOp[] {
  const found = new Set<ProtocolOp>();

  for (const match of patchText.matchAll(/<(\w+)(\s[^>]*)?>/gi)) {
    const tag = match[1]!.toUpperCase();
    const attrs = match[2] ?? "";

    if (tag === "CREATE") found.add("CREATE");
    if (tag === "INSERT") found.add("INSERT");
    if (tag === "DELETE") found.add("DELETE");
    if (tag === "RENAME") found.add("RENAME");
    if (tag === "PATCH") {
      if (/type\s*=\s*"search"/i.test(attrs)) {
        found.add("SEARCH_REPLACE");
      } else {
        found.add("PATCH");
      }
    }
  }

  return [...found];
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

/**
 * Extract INSERT blocks from response.
 * Format: <INSERT position="before|after" anchor="anchor text" file="path/to/file">
 * content to insert
 * </INSERT>
 *
 * INSERT is designed for DeepSeek's strengths: identifying anchors
 * without needing to reproduce exact text from the file.
 */
export function extractInsertBlocks(response: string): InsertBlock[] {
  const blocks: InsertBlock[] = [];
  // Match both inline and from-file INSERT blocks
  const blockRegex = /<INSERT\s+position="(before|after)"\s+anchor="([^"]*)"\s+file="([^"]+)"(?:\s+from="([^"]+)")?\s*>([\s\S]*?)<\/INSERT>/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(response)) !== null) {
    const position = (match[1] ?? "before") as "before" | "after";
    const anchor = match[2] ?? "";
    const filePath = match[3]?.trim() ?? "";
    const fromFile = match[4]?.trim() || undefined;
    const content = match[5] ?? "";

    if (!filePath || !anchor.trim()) continue;

    blocks.push({ filePath, anchor, position, content, fromFile });
  }

  return blocks;
}

export function applyInserts(
  cwd: string,
  blocks: InsertBlock[],
  dryRun: boolean = false,
): { success: boolean; files: string[]; error?: string } {
  const changedFiles: string[] = [];

  for (const block of blocks) {
    const absPath = path.join(cwd, block.filePath);

    if (path.isAbsolute(block.filePath) || block.filePath.includes("..")) {
      return { success: false, files: changedFiles, error: `Unsafe path rejected: ${block.filePath}` };
    }

    // Resolve insert content: from fromFile if specified, otherwise inline
    let insertContent = block.content;
    if (block.fromFile) {
      const fromPath = path.join(cwd, block.fromFile);
      try {
        insertContent = fs.readFileSync(fromPath, "utf-8");
        // Clean up the temp file after reading
        try { fs.unlinkSync(fromPath); } catch { /* best effort */ }
      } catch {
        return { success: false, files: changedFiles, error: `Cannot read from file: ${block.fromFile}` };
      }
    }

    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf-8");
    } catch {
      return { success: false, files: changedFiles, error: `Cannot read ${block.filePath}` };
    }

    // Find the anchor (case-insensitive, anywhere in file)
    const lowerContent = content.toLowerCase();
    const lowerAnchor = block.anchor.toLowerCase();
    const anchorIdx = lowerContent.indexOf(lowerAnchor);

    if (anchorIdx < 0) {
      return {
        success: false,
        files: changedFiles,
        error: `INSERT anchor "${block.anchor}" not found in ${block.filePath}`,
      };
    }

    // Find the start of the line containing the anchor
    const lineStart = content.lastIndexOf("\n", anchorIdx) + 1;
    const lineEnd = content.indexOf("\n", anchorIdx);
    const insertionPoint = block.position === "before" ? lineStart : (lineEnd >= 0 ? lineEnd + 1 : content.length);

    const newContent = content.slice(0, insertionPoint) +
      (insertionPoint > 0 && !content.slice(insertionPoint - 1, insertionPoint).match(/\n/) ? "" : "") +
      insertContent +
      (insertContent.endsWith("\n") ? "" : "\n") +
      (block.position === "before" ? "\n" : "") +
      content.slice(insertionPoint);

    if (!dryRun) {
      fs.writeFileSync(absPath, newContent, "utf-8");
    }

    changedFiles.push(block.filePath);
  }

  return { success: true, files: changedFiles };
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

    // Level 0: case-insensitive substring match
    if (newContent === null) {
      const lowerContent = content.toLowerCase();
      const lowerSearch = block.search.toLowerCase();
      const idx = lowerContent.indexOf(lowerSearch);
      if (idx >= 0) {
        newContent = content.slice(0, idx) + block.replace + content.slice(idx + block.search.length);
      }
    }

    // Level 0.5: anchor search — for short search text, find any line containing a keyword
    if (newContent === null) {
      const searchLines = block.search.split("\n").filter((l) => l.trim().length > 0);
      // Extract potential keywords (words with >= 5 chars or containing dots/slashes)
      const keywords = searchLines.flatMap((l) =>
        l.match(/[a-zA-Z0-9_/.-]{5,}/g) ?? []
      );
      // Prefer file-like patterns
      const filePattern = block.search.match(/([a-zA-Z0-9_/.-]+\.(?:py|ts|js|md|yml|yaml|json))/);
      const anchorCandidates = filePattern ? [filePattern[1]!] : keywords;

      if (anchorCandidates.length > 0) {
        const contentLines = content.split("\n");
        // Find the first line that contains any anchor keyword
        let anchorIdx = -1;
        for (const kw of anchorCandidates) {
          const idx = contentLines.findIndex((l) => l.includes(kw));
          if (idx >= 0) { anchorIdx = idx; break; }
        }
        if (anchorIdx >= 0) {
          // Replace the anchored region with the replacement
          const replaceLines = block.replace.split("\n");
          // Replace from anchorIdx to anchorIdx + searchLines.length
          const endIdx = Math.min(anchorIdx + searchLines.length, contentLines.length);
          const resultLines = [
            ...contentLines.slice(0, anchorIdx),
            ...replaceLines,
            ...contentLines.slice(endIdx),
          ];
          newContent = resultLines.join("\n");
        }
      }
    }

    // Level 1: exact match
    if (newContent === null && content.includes(block.search)) {
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
      const debugInfo = `SEARCH length=${block.search.length}, file=${block.filePath} size=${content.length}, search preview="${block.search.slice(0, 120).replace(/\n/g, '\\n')}"`;
      console.error("[DEBUG] Search block not found:", debugInfo);
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
  const insertBlocks = extractInsertBlocks(response);

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
  if (creates.length === 0 && renames.length === 0 && !patchText && deletePaths.length === 0 && searchReplaceBlocks.length === 0 && insertBlocks.length === 0) {
    throw new PatchParseError(
      "No <CREATE>, <RENAME>, <PATCH>, <DELETE>, <PATCH type=\"search\">, or <INSERT> blocks found in response",
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
    insertBlocks,
  };
}

/**
 * v0.4 protocol: parse a single turn response into a discriminated action.
 *
 * Each turn the model must output EXACTLY ONE of:
 *   (a) tool calls — no change block in content
 *   (b) ONE change block — CREATE/PATCH/SEARCH_REPLACE/INSERT/DELETE/RENAME
 *   (c) <DONE/> — explicit termination
 *
 * If the model outputs none of these, or violates the single-change-per-turn
 * constraint, the turn is `invalid` and the pipeline sends a correction hint.
 */
export function parsePatchTurn(content: string, hasToolCalls: boolean): PatchTurnAction {
  // Strip NOTE blocks — audit only, not counted as change blocks
  const cleaned = content.replace(/<NOTE>[\s\S]*?<\/NOTE>/gi, "");

  // ---- DONE detection ----
  const hasDone = /<DONE\/>/i.test(cleaned) || /<DONE>[\s\S]*?<\/DONE>/i.test(cleaned);

  // ---- Extract change blocks ----
  const creates = extractCreateBlocks(cleaned);
  const deletes = extractDeleteBlocks(cleaned);
  const renames = extractRenameBlocks(cleaned);
  const searchReplaces = extractSearchReplaceBlocks(cleaned);
  const inserts = extractInsertBlocks(cleaned);
  const patchText = extractPatchBlock(cleaned);

  const totalBlocks = creates.length + deletes.length + renames.length +
    searchReplaces.length + inserts.length + (patchText ? 1 : 0);

  // DONE present → terminate regardless of other content
  if (hasDone) {
    return { kind: "done" };
  }

  // Zero blocks: tools or no-op
  if (totalBlocks === 0) {
    if (hasToolCalls) {
      return { kind: "tools" };
    }
    return { kind: "invalid", reason: "no action: expected tool calls, one change block, or <DONE/>" };
  }

  // Multi-block violation
  if (totalBlocks > 1) {
    return { kind: "invalid", reason: "multiple change blocks: output exactly one per turn" };
  }

  // ---- Single block dispatch ----
  if (creates.length === 1) {
    const c = creates[0]!;
    return {
      kind: "change",
      change: {
        op: "CREATE",
        file: c.path,
        raw_block: `<CREATE path="${c.path}">\n${c.content}\n</CREATE>`,
        create: c,
      },
    };
  }

  if (deletes.length === 1) {
    const d = deletes[0]!;
    return {
      kind: "change",
      change: {
        op: "DELETE",
        file: d,
        raw_block: `<DELETE path="${d}" />`,
      },
    };
  }

  if (renames.length === 1) {
    const r = renames[0]!;
    return {
      kind: "change",
      change: {
        op: "RENAME",
        file: `${r.from} -> ${r.to}`,
        raw_block: `<RENAME from="${r.from}" to="${r.to}" />`,
        rename: r,
      },
    };
  }

  if (searchReplaces.length === 1) {
    const s = searchReplaces[0]!;
    return {
      kind: "change",
      change: {
        op: "SEARCH_REPLACE",
        file: s.filePath,
        raw_block: `<PATCH type="search" file="${s.filePath}">\n<SEARCH>${s.search}</SEARCH>\n<REPLACE>${s.replace}</REPLACE>\n</PATCH>`,
        searchReplace: s,
      },
    };
  }

  if (inserts.length === 1) {
    const i = inserts[0]!;
    return {
      kind: "change",
      change: {
        op: "INSERT",
        file: i.filePath,
        raw_block: `<INSERT position="${i.position}" anchor="${i.anchor}" file="${i.filePath}">\n${i.content}\n</INSERT>`,
        insert: i,
      },
    };
  }

  // Single unified diff PATCH block
  if (patchText) {
    const files = parsePatchFiles(patchText);
    if (files.length > 1) {
      return { kind: "invalid", reason: "change block must target a single file" };
    }

    const validation = validateDiff(patchText);
    if (!validation.valid) {
      return { kind: "invalid", reason: `unified diff parse failed: ${validation.errors.join("; ")}` };
    }

    return {
      kind: "change",
      change: {
        op: "PATCH",
        file: files[0] ?? "unknown",
        raw_block: `<PATCH>\n${patchText}\n</PATCH>`,
        patchText,
      },
    };
  }

  return { kind: "invalid", reason: "unknown error parsing turn" };
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

  // Apply INSERT blocks (before SEARCH/REPLACE and PATCH)
  if (changes.insertBlocks.length > 0) {
    const result = applyInserts(cwd, changes.insertBlocks, dryRun);
    if (!result.success) {
      return { success: false, createdFiles, renamedFiles, patchedFiles, deletedFiles, error: result.error };
    }
    patchedFiles.push(...result.files);
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

export function extractVerifyStrategyBlock(response: string): string | undefined {
  const match = response.match(/<VERIFY_STRATEGY>([\s\S]*?)<\/VERIFY_STRATEGY>/);
  if (!match || !match[1]) return undefined;
  return match[1].trim();
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
