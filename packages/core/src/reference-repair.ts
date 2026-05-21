import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { extractRenameIntent } from "./rename-intent.js";
import type { VerifyAssertion, VerifyRunResult } from "./verifier.js";

export interface DeterministicReferenceRepair {
  content: string;
  files: string[];
  hints: string[];
}

interface BuildRenameReferenceRepairArgs {
  cwd: string;
  taskDescription: string;
  assertions: VerifyAssertion[];
  results: VerifyRunResult[];
}

interface BuildFailedContainsImportRepairArgs {
  cwd: string;
  assertions: VerifyAssertion[];
  results: VerifyRunResult[];
}

function countOccurrences(source: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while (pos <= source.length) {
    const idx = source.indexOf(needle, pos);
    if (idx < 0) break;
    count += 1;
    pos = idx + needle.length;
  }
  return count;
}

function deriveOldReferencePattern(expectedPattern: string, fromPath: string, toPath: string): string | null {
  const fromStem = path.basename(fromPath, path.extname(fromPath));
  const toStem = path.basename(toPath, path.extname(toPath));
  if (!fromStem || !toStem || fromStem === toStem) return null;
  if (!expectedPattern.includes(toStem)) return null;
  const oldPattern = expectedPattern.split(toStem).join(fromStem);
  return oldPattern !== expectedPattern ? oldPattern : null;
}

function xmlSafeBlockText(value: string): boolean {
  return !/<\/(?:SEARCH|REPLACE|PATCH)>/i.test(value);
}

function isSafeRelativePath(filePath: string): boolean {
  return filePath.length > 0 && !path.isAbsolute(filePath) && !filePath.includes("..") && !filePath.includes('"');
}

function hasGitHeadContentAssertion(
  assertions: VerifyAssertion[],
  results: VerifyRunResult[],
  fromPath: string,
  toPath: string,
): boolean {
  return results.some((result, index) => {
    if (result.status !== "failed") return false;
    const assertion = assertions[index];
    if (assertion?.type !== "shell") return false;
    const command = assertion.command;
    return command.includes(`git show HEAD:${fromPath}`)
      && command.includes("cmp -")
      && command.includes(toPath);
  });
}

function readGitHeadFile(cwd: string, filePath: string): string | null {
  try {
    const content = execFileSync("git", ["show", `HEAD:${filePath}`], {
      cwd,
      encoding: "utf-8",
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (content.includes("\0")) return null;
  return content;
  } catch {
    return null;
  }
}

function isSimpleIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function sourcePathForImport(fromFile: string, importSpec: string): string | null {
  if (!importSpec.startsWith(".")) return null;
  const fromDir = path.dirname(fromFile);
  const withoutJsExtension = importSpec.replace(/\.(?:mjs|cjs|js|jsx)$/i, "");
  const candidate = path.normalize(path.join(fromDir, `${withoutJsExtension}.ts`));
  return isSafeRelativePath(candidate) ? candidate : null;
}

function moduleExportsIdentifier(content: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bexport\\s+(?:async\\s+)?(?:function|const|let|var|class|interface|type)\\s+${escaped}\\b`).test(content)
    || new RegExp(`\\bexport\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}`).test(content);
}

function buildImportWithIdentifier(importBlock: string, identifier: string): string | null {
  if (new RegExp(`\\b${identifier}\\b`).test(importBlock)) return null;
  const lines = importBlock.split("\n");
  const closeIndex = lines.findIndex((line) => line.trim().startsWith("} from "));
  if (closeIndex < 0) return null;
  const typeIndex = lines.findIndex((line, index) => index > 0 && index < closeIndex && line.trim().startsWith("type "));
  const insertIndex = typeIndex >= 0 ? typeIndex : closeIndex;
  const indentMatch = lines[Math.max(1, insertIndex - 1)]?.match(/^(\s*)/) ?? ["", "  "];
  const indent = indentMatch[1] || "  ";
  lines.splice(insertIndex, 0, `${indent}${identifier},`);
  return lines.join("\n");
}

export function buildFailedContainsImportRepair(
  args: BuildFailedContainsImportRepairArgs,
): DeterministicReferenceRepair | null {
  const blocks: string[] = [];
  const files = new Set<string>();
  const hints = new Set<string>();
  const seen = new Set<string>();

  for (let index = 0; index < args.results.length; index++) {
    const result = args.results[index];
    const assertion = args.assertions[index];
    if (result?.status !== "failed" || assertion?.type !== "file_contains" || assertion.regex) continue;
    if (!isSimpleIdentifier(assertion.pattern) || !isSafeRelativePath(assertion.file)) continue;

    const targetAbs = path.join(args.cwd, assertion.file);
    if (!fs.existsSync(targetAbs) || !fs.statSync(targetAbs).isFile()) continue;
    const targetContent = fs.readFileSync(targetAbs, "utf-8");
    if (targetContent.includes(assertion.pattern)) continue;

    const importRegex = /import\s*\{[\s\S]*?\}\s*from\s*"([^"]+)";/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(targetContent)) !== null) {
      const importBlock = match[0];
      const importSpec = match[1] ?? "";
      const sourcePath = sourcePathForImport(assertion.file, importSpec);
      if (!sourcePath) continue;

      const sourceAbs = path.join(args.cwd, sourcePath);
      if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isFile()) continue;
      const sourceContent = fs.readFileSync(sourceAbs, "utf-8");
      if (!moduleExportsIdentifier(sourceContent, assertion.pattern)) continue;

      const replacement = buildImportWithIdentifier(importBlock, assertion.pattern);
      if (!replacement || !xmlSafeBlockText(importBlock) || !xmlSafeBlockText(replacement)) continue;
      if (countOccurrences(targetContent, importBlock) !== 1) continue;

      const editKey = `${assertion.file}\0${importBlock}\0${replacement}`;
      if (seen.has(editKey)) continue;
      seen.add(editKey);

      blocks.push([
        `<PATCH type="search" file="${assertion.file}">`,
        `<SEARCH>${importBlock}</SEARCH>`,
        `<REPLACE>${replacement}</REPLACE>`,
        "</PATCH>",
      ].join("\n"));
      files.add(assertion.file);
      hints.add(`deterministic_failed_contains_import_repair: ${assertion.file} imports ${JSON.stringify(assertion.pattern)} from ${sourcePath}`);
      break;
    }
  }

  if (blocks.length === 0) return null;
  return {
    content: blocks.join("\n\n"),
    files: [...files],
    hints: [...hints],
  };
}

function hasRenamePreservationFailure(
  assertions: VerifyAssertion[],
  results: VerifyRunResult[],
  fromPath: string,
  toPath: string,
): boolean {
  return results.some((result, index) => {
    if (result.status !== "failed") return false;
    const assertion = assertions[index];
    if (!assertion) return false;
    if (assertion.type === "file_exists" && assertion.file === toPath) return true;
    if (assertion.type === "file_not_exists" && assertion.file === fromPath) return true;
    if (assertion.type !== "shell") return false;
    const text = `${assertion.name ?? ""} ${assertion.command}`.toLowerCase();
    return text.includes("cmp")
      || text.includes("content_unchanged")
      || text.includes("content unchanged")
      || text.includes("same content")
      || text.includes("equivalent content");
  });
}

function shouldRepairRenameContent(
  cwd: string,
  fromPath: string,
  toPath: string,
  assertions: VerifyAssertion[],
  results: VerifyRunResult[],
): boolean {
  if (!hasRenamePreservationFailure(assertions, results, fromPath, toPath)) return false;
  if (path.isAbsolute(fromPath) || path.isAbsolute(toPath) || fromPath.includes("..") || toPath.includes("..")) {
    return false;
  }
  const fromAbs = path.join(cwd, fromPath);
  const toAbs = path.join(cwd, toPath);
  if (!fs.existsSync(fromAbs) || !fs.statSync(fromAbs).isFile()) return false;
  if (!fs.existsSync(toAbs)) return true;
  if (!fs.statSync(toAbs).isFile()) return false;
  return !fs.readFileSync(fromAbs).equals(fs.readFileSync(toAbs));
}

function buildGitHeadContentRepair(
  cwd: string,
  fromPath: string,
  toPath: string,
  assertions: VerifyAssertion[],
  results: VerifyRunResult[],
): { block: string; file: string; hint: string } | null {
  if (!hasRenamePreservationFailure(assertions, results, fromPath, toPath)) return null;
  if (!hasGitHeadContentAssertion(assertions, results, fromPath, toPath)) return null;
  if (!isSafeRelativePath(fromPath) || !isSafeRelativePath(toPath)) return null;

  const expectedContent = readGitHeadFile(cwd, fromPath);
  if (expectedContent === null || !xmlSafeBlockText(expectedContent)) return null;

  const toAbs = path.join(cwd, toPath);
  if (!fs.existsSync(toAbs)) {
    if (expectedContent.trim().length === 0) return null;
    return {
      block: `<CREATE path="${toPath}">\n${expectedContent}</CREATE>`,
      file: toPath,
      hint: `deterministic_content_restore_from_git_head: HEAD:${fromPath} -> ${toPath}`,
    };
  }

  if (!fs.statSync(toAbs).isFile()) return null;
  const currentContent = fs.readFileSync(toAbs, "utf-8");
  if (currentContent === expectedContent) return null;
  if (currentContent.trim().length === 0 || !xmlSafeBlockText(currentContent)) return null;

  return {
    block: [
      `<PATCH type="search" file="${toPath}">`,
      `<SEARCH>${currentContent}</SEARCH>`,
      `<REPLACE>${expectedContent}</REPLACE>`,
      "</PATCH>",
    ].join("\n"),
    file: toPath,
    hint: `deterministic_content_restore_from_git_head: HEAD:${fromPath} -> ${toPath}`,
  };
}

export function buildRenameReferenceRepair(args: BuildRenameReferenceRepairArgs): DeterministicReferenceRepair | null {
  const intent = extractRenameIntent(args.taskDescription);
  if (!intent?.from || !intent.to) return null;

  const simulatedContent = new Map<string, string>();
  const blocks: string[] = [];
  const files = new Set<string>();
  const hints = new Set<string>();
  const seenEdits = new Set<string>();

  if (shouldRepairRenameContent(args.cwd, intent.from, intent.to, args.assertions, args.results)) {
    blocks.push(`<RENAME from="${intent.from}" to="${intent.to}" />`);
    files.add(`${intent.from} -> ${intent.to}`);
    hints.add(`deterministic_content_preserving_rename: ${intent.from} -> ${intent.to}`);
  } else {
    const gitHeadRepair = buildGitHeadContentRepair(
      args.cwd,
      intent.from,
      intent.to,
      args.assertions,
      args.results,
    );
    if (gitHeadRepair) {
      blocks.push(gitHeadRepair.block);
      files.add(gitHeadRepair.file);
      hints.add(gitHeadRepair.hint);
    }
  }

  for (let index = 0; index < args.results.length; index++) {
    const result = args.results[index];
    const assertion = args.assertions[index];
    if (result?.status !== "failed" || assertion?.type !== "file_contains" || assertion.regex) {
      continue;
    }

    const oldPattern = deriveOldReferencePattern(assertion.pattern, intent.from, intent.to);
    if (!oldPattern) continue;

    const absPath = path.join(args.cwd, assertion.file);
    if (path.isAbsolute(assertion.file) || assertion.file.includes("..") || !fs.existsSync(absPath)) {
      continue;
    }

    const content = simulatedContent.get(assertion.file) ?? fs.readFileSync(absPath, "utf-8");
    if (content.includes(assertion.pattern) || !content.includes(oldPattern)) {
      simulatedContent.set(assertion.file, content);
      continue;
    }

    const lines = content.split("\n");
    let nextContent = content;
    for (const line of lines) {
      if (!line.includes(oldPattern)) continue;
      const replacementLine = line.split(oldPattern).join(assertion.pattern);
      if (replacementLine === line) continue;
      if (line.length > 1200 || replacementLine.length > 1200) continue;
      if (!xmlSafeBlockText(line) || !xmlSafeBlockText(replacementLine)) continue;
      if (countOccurrences(nextContent, line) !== 1) continue;

      const editKey = `${assertion.file}\0${line}\0${replacementLine}`;
      if (seenEdits.has(editKey)) continue;
      seenEdits.add(editKey);

      blocks.push([
        `<PATCH type="search" file="${assertion.file}">`,
        `<SEARCH>${line}</SEARCH>`,
        `<REPLACE>${replacementLine}</REPLACE>`,
        "</PATCH>",
      ].join("\n"));
      nextContent = nextContent.replace(line, replacementLine);
      files.add(assertion.file);
      hints.add(`deterministic_reference_repair: ${assertion.file} ${JSON.stringify(oldPattern)} -> ${JSON.stringify(assertion.pattern)}`);
    }

    simulatedContent.set(assertion.file, nextContent);
  }

  if (blocks.length === 0) return null;
  return {
    content: blocks.join("\n\n"),
    files: [...files],
    hints: [...hints],
  };
}
