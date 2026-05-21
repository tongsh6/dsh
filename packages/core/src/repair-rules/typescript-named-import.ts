import * as fs from "node:fs";
import * as path from "node:path";
import type { VerifyAssertion, VerifyRunResult } from "../verifier.js";

export interface DeterministicRepair {
  content: string;
  files: string[];
  hints: string[];
}

interface BuildTypescriptNamedImportRepairArgs {
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

function xmlSafeBlockText(value: string): boolean {
  return !/<\/(?:SEARCH|REPLACE|PATCH)>/i.test(value);
}

function isSafeRelativePath(filePath: string): boolean {
  return filePath.length > 0
    && !path.isAbsolute(filePath)
    && !filePath.includes("..")
    && !filePath.includes('"');
}

function isSimpleIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function isTypescriptOrJavascriptPath(filePath: string): boolean {
  return /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(filePath);
}

function sourcePathForImport(cwd: string, fromFile: string, importSpec: string): string | null {
  if (!importSpec.startsWith(".")) return null;
  const fromDir = path.dirname(fromFile);
  const withoutRuntimeExtension = importSpec.replace(/\.(?:mts|cts|mjs|cjs|ts|tsx|js|jsx)$/i, "");
  const candidates = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"].map((ext) =>
    path.normalize(path.join(fromDir, `${withoutRuntimeExtension}${ext}`)));
  return candidates.find((candidate) =>
    isSafeRelativePath(candidate)
    && fs.existsSync(path.join(cwd, candidate))
    && fs.statSync(path.join(cwd, candidate)).isFile()) ?? null;
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

/**
 * JS/TS ESM named-import repair rule.
 *
 * Scope is intentionally narrow: it only adds a missing identifier to an
 * existing local named import when the imported module already exports that
 * identifier. It must not synthesize implementation or infer business logic.
 */
export function buildTypescriptNamedImportRepair(
  args: BuildTypescriptNamedImportRepairArgs,
): DeterministicRepair | null {
  const blocks: string[] = [];
  const files = new Set<string>();
  const hints = new Set<string>();
  const seen = new Set<string>();

  for (let index = 0; index < args.results.length; index++) {
    const result = args.results[index];
    const assertion = args.assertions[index];
    if (result?.status !== "failed" || assertion?.type !== "file_contains" || assertion.regex) continue;
    if (!isSimpleIdentifier(assertion.pattern) || !isSafeRelativePath(assertion.file)) continue;
    if (!isTypescriptOrJavascriptPath(assertion.file)) continue;

    const targetAbs = path.join(args.cwd, assertion.file);
    if (!fs.existsSync(targetAbs) || !fs.statSync(targetAbs).isFile()) continue;
    const targetContent = fs.readFileSync(targetAbs, "utf-8");
    if (targetContent.includes(assertion.pattern)) continue;

    const importRegex = /import\s*\{[\s\S]*?\}\s*from\s*"([^"]+)";/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(targetContent)) !== null) {
      const importBlock = match[0];
      const importSpec = match[1] ?? "";
      const sourcePath = sourcePathForImport(args.cwd, assertion.file, importSpec);
      if (!sourcePath) continue;

      const sourceAbs = path.join(args.cwd, sourcePath);
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
      hints.add(`deterministic_typescript_named_import_repair: ${assertion.file} imports ${JSON.stringify(assertion.pattern)} from ${sourcePath}`);
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
