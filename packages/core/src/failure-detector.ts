import { execSync } from "node:child_process";
import * as path from "node:path";

export interface FailureDetection {
  mode: string;
  description: string;
  confidence: "high" | "medium" | "low";
  evidence: string;
  repairHint: string;
}

export interface DetectParams {
  response: string;
  planFiles: string[];
  actualChangedFiles: string[];
  verifyOutput: string | null;
  patchApplyError: string | null;
  prevVerifyOutput?: string | null;
  /**
   * Project module roots (e.g. ["backend", "frontend", "src", "."]) used to
   * strip absolute path prefixes from compilation error output. Sourced from
   * `moduleRoots(assembleIntelligence(cwd))` in @dsh/repo. When omitted or
   * empty, falls back to basename — equivalent to the pre-Intelligence behavior.
   */
  moduleRoots?: string[];
}

export interface SignatureChange {
  file: string;
  name: string;
  type: "added" | "removed" | "modified";
  beforeSignature: string | null;
  afterSignature: string | null;
}

export interface CallSite {
  file: string;
  line: number;
  content: string;
  matchType: "direct_call" | "import_reference" | "attribute_access";
}

// ---- Individual detectors ----

function detectOverconfidence(params: DetectParams): FailureDetection | null {
  const hasVerifyBlock = /<VERIFY>([\s\S]*?)<\/VERIFY>/i.test(params.response);
  const verifyContent = hasVerifyBlock
    ? (params.response.match(/<VERIFY>([\s\S]*?)<\/VERIFY>/i)?.[1]?.trim() ?? "")
    : "";

  const verifyIsEmpty =
    !hasVerifyBlock ||
    verifyContent.length === 0 ||
    verifyContent
      .split("\n")
      .every((l) => l.trim().length === 0 || l.trim().startsWith("#"));

  const risksBlock = params.response.match(/<RISKS>([\s\S]*?)<\/RISKS>/i)?.[1] ?? "";
  const risksTrivial =
    risksBlock.includes("无风险") ||
    risksBlock.includes("不适用") ||
    risksBlock.includes("No risks") ||
    risksBlock.includes("无需") ||
    risksBlock.trim().length === 0;

  if (verifyIsEmpty) {
    return {
      mode: "overconfidence",
      description: "模型跳过验证直接声称完成",
      confidence: risksTrivial ? "high" : "medium",
      evidence: verifyIsEmpty
        ? "VERIFY 块为空或仅含注释"
        : "RISKS 块标记为无风险",
      repairHint: [
        "CRITICAL: You claimed completion without providing VERIFY commands.",
        "You MUST output at least one executable shell verification command.",
        "Add a <VERIFY> block with real test/lint/typecheck commands.",
        'Never claim "无风险" — list at least 2 specific risks.',
      ].join("\n"),
    };
  }

  if (risksTrivial && params.verifyOutput && params.verifyOutput.includes("failed")) {
    return {
      mode: "overconfidence",
      description: "模型低估了修改的风险",
      confidence: "medium",
      evidence: "RISKS 标记为无风险但验证失败",
      repairHint: [
        "Your changes failed verification, but you listed risks as trivial.",
        "Re-examine the failure output and list SPECIFIC risks about what could go wrong.",
        "Be honest about uncertainty — list at least 2 concrete, actionable risks.",
      ].join("\n"),
    };
  }

  return null;
}

function detectPatchDrift(params: DetectParams): FailureDetection | null {
  if (!params.patchApplyError) return null;

  const isDriftError =
    params.patchApplyError.includes("Failed to apply") ||
    params.patchApplyError.includes("patch apply") ||
    params.patchApplyError.includes("hunk");

  if (isDriftError) {
    return {
      mode: "patch-drift",
      description: "patch 格式偏移——hunk header 行号与实际文件不匹配",
      confidence: "high",
      evidence: `patch 应用失败: ${params.patchApplyError}`,
      repairHint: [
        "Your patch failed to apply because hunk headers don't match the actual file content.",
        "Before writing the patch:",
        "1. Re-read the file content in Task Context CAREFULLY",
        "2. Note the EXACT line numbers where the code to change appears",
        "3. Ensure hunk headers (@@ -l,s +l,s @@) use the CORRECT line numbers",
        "4. Verify context lines match the actual file content EXACTLY",
        "5. Use <CREATE> for new files, not /dev/null patches",
        "",
        "IMPORTANT: Use <CREATE> blocks for any NEW files instead of patching.",
      ].join("\n"),
    };
  }

  return null;
}

function detectScopeCreep(params: DetectParams): FailureDetection | null {
  if (params.planFiles.length === 0) return null;

  const planSet = new Set(params.planFiles);
  const extraFiles = params.actualChangedFiles.filter((f) => !planSet.has(f));

  if (extraFiles.length > 0) {
    return {
      mode: "scope-creep",
      description: "修改范围扩大——修改了计划外的文件",
      confidence: extraFiles.length > 2 ? "high" : "medium",
      evidence: `计划外修改: ${extraFiles.join(", ")}`,
      repairHint: [
        `You modified files outside the declared scope: ${extraFiles.join(", ")}.`,
        "CRITICAL: Only modify files listed in the <FILES> block.",
        "If these extra modifications are necessary, you MUST explain why in <PLAN> and include them in <FILES>.",
        "For the repair: revert any changes to files not in <FILES>.",
        "Focus ONLY on: " + params.planFiles.join(", "),
      ].join("\n"),
    };
  }

  return null;
}

function detectRuleBlindness(params: DetectParams): FailureDetection | null {
  if (!params.verifyOutput) return null;

  const output = params.verifyOutput.toLowerCase();
  const ruleKeywords = [
    /eslint/i,
    /prettier/i,
    /ts\d+/i,             // TypeScript error codes like TS2345
    /is not assignable/i,
    /tsc/i,
    /typecheck/i,
    /architecture/i,
    /convention/i,
    /rule/i,
    /standard/i,
    /pattern/i,
  ];

  const hasRuleFailure = ruleKeywords.some((kw) => kw.test(output));
  const isImportError = /cannot find module|module not found|import.*not found/i.test(output);

  if (hasRuleFailure || isImportError) {
    return {
      mode: "rule-blindness",
      description: "漏读项目规则或架构约束",
      confidence: isImportError ? "high" : "medium",
      evidence: `验证输出包含规则相关错误: ${params.verifyOutput.slice(0, 200)}`,
      repairHint: [
        "Your changes violate project rules or architecture constraints.",
        "Before repairing:",
        "1. Re-read the Base Context — it contains project rules you MUST follow",
        "2. Check that you're following the project's conventions (lint, type, naming)",
        "3. Verify imports and module references exist in the project",
        "4. Do NOT assume APIs or modules exist — only use what's in the provided context",
        "",
        "The verification output indicates: " + params.verifyOutput.slice(0, 300),
      ].join("\n"),
    };
  }

  return null;
}

function detectHallucinatedApi(params: DetectParams): FailureDetection | null {
  if (!params.verifyOutput) return null;

  const output = params.verifyOutput.toLowerCase();
  const apiErrorPatterns = [
    /cannot find name/i,
    /is not defined/i,
    /has no exported member/i,
    /does not exist on type/i,
    /property.*does not exist/i,
    /cannot find module/i,
    /module.*has no exported member/i,
    /not callable/i,
    /is not a function/i,
    /cannot read propert/i,
    /undefined is not an object/i,
    // Python TypeError patterns — often indicate signature mismatch or wrong argument types
    /takes\s+\d+\s+positional\s+argument.*but\s+\d+\s+(?:was|were)\s+given/i,
    /got\s+an\s+unexpected\s+keyword\s+argument/i,
    /missing\s+\d+\s+required\s+positional\s+argument/i,
    /takes\s+exactly\s+\d+\s+argument/i,
  ];

  const hasApiError = apiErrorPatterns.some((p) => p.test(output));

  if (hasApiError) {
    return {
      mode: "hallucinated-api",
      description: "编造或错用了不存在的 API",
      confidence: "high",
      evidence: `验证输出包含 API 错误: ${params.verifyOutput.slice(0, 200)}`,
      repairHint: [
        "You referenced APIs, modules, or properties that DON'T EXIST in this codebase.",
        "CRITICAL REPAIR INSTRUCTIONS:",
        "1. ONLY use APIs and modules that are VISIBLE in the provided Task Context files",
        "2. Re-read the file contents in Task Context — the actual exports and signatures are there",
        "3. Do NOT guess method names, property names, or module paths",
        "4. If you're unsure whether an API exists, use a simpler approach with APIs you CAN see",
        "5. Check import statements in the Task Context to see what's actually available",
        "",
        "The exact error was: " + params.verifyOutput.slice(0, 300),
      ].join("\n"),
    };
  }

  return null;
}

function detectSearchReplaceMismatch(params: DetectParams): FailureDetection | null {
  if (params.patchApplyError?.includes("Search block not found")) {
    return {
      mode: "search-replace-mismatch",
      description: "SEARCH block does not match actual file content",
      confidence: "high",
      evidence: params.patchApplyError,
      repairHint: [
        "SEARCH block did not match the actual file content.",
        "1. Read the current file content from the Task Context",
        "2. Copy the EXACT section you want to replace — whitespace, indentation, and blank lines must match",
        "3. Use the EXACT same text in your SEARCH block as it appears in the file",
        "4. If the file has changed since the context was generated, read it again",
        "",
        "The exact error was: " + params.patchApplyError,
      ].join("\n"),
    };
  }
  return null;
}

function detectSignatureMismatch(params: DetectParams): FailureDetection | null {
  if (!params.verifyOutput) return null;

  const output = params.verifyOutput;

  const pythonSigMismatch =
    /takes\s+\d+\s+positional\s+argument.*but\s+\d+\s+(?:was|were)\s+given/i.test(output) ||
    /got\s+an\s+unexpected\s+keyword\s+argument/i.test(output) ||
    /missing\s+\d+\s+required\s+positional\s+argument/i.test(output) ||
    /takes\s+exactly\s+\d+\s+argument/i.test(output);

  const tsSigMismatch =
    /is not a function/i.test(output) &&
    !/cannot read property.*is not a function/i.test(output.toLowerCase());

  if (pythonSigMismatch || tsSigMismatch) {
    const funcNameMatch =
      output.match(/typeerror:\s*(\w+)\s*\(\)\s+takes/i) ??
      output.match(/'(\w+)'\s+is\s+not\s+a\s+function/i) ??
      output.match(/takes\s+\d+\s+positional\s+argument.*在\s+['"]?(\w+)['"]?/i);

    const funcName = funcNameMatch?.[1] ?? "the function";

    return {
      mode: "signature-mismatch",
      description: `函数 \`${funcName}\` 的签名变更导致调用方不匹配`,
      confidence: "high",
      evidence: `验证输出包含签名不匹配错误: ${output.slice(0, 250)}`,
      repairHint: [
        `SIGNATURE MISMATCH: You changed the signature of \`${funcName}\` but callers were NOT updated.`,
        "",
        "To fix this:",
        `1. Find ALL places where \`${funcName}\` is called (check the Repo Context and test files)`,
        "2. Update each call site to match the new signature, OR",
        "3. Revert to the ORIGINAL signature if the change was unnecessary",
        "",
        "The original task likely said: preserve the function's calling convention.",
        "",
        "Verification error: " + output.slice(0, 300),
      ].join("\n"),
    };
  }

  return null;
}

// ---- Signature Change Detection & Caller Analysis ----

function getGitDiff(cwd: string, files: string[]): string | null {
  try {
    const args = files.map((f) => `"${f}"`).join(" ");
    return execSync(`git diff -- ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim() || null;
  } catch {
    return null;
  }
}

const FN_DEF_PATTERNS: Record<string, RegExp> = {
  ".py": /^[+-]\s*def\s+(\w+)\s*\(([^)]*)\)/,
  ".ts": /^[+-]\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
  ".tsx": /^[+-]\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
  ".js": /^[+-]\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
  ".jsx": /^[+-]\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/,
};

const FN_ARROW_PATTERNS: Record<string, RegExp> = {
  ".ts": /^[+-]\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)/,
  ".tsx": /^[+-]\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)/,
  ".js": /^[+-]\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)/,
  ".jsx": /^[+-]\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)/,
};

export function detectSignatureChanges(
  cwd: string,
  changedFiles: string[],
): SignatureChange[] {
  const diff = getGitDiff(cwd, changedFiles);
  if (!diff) return [];

  const extByFile = new Map<string, string>();
  for (const f of changedFiles) {
    const ext = path.extname(f).toLowerCase();
    extByFile.set(f, ext);
    extByFile.set(path.basename(f), ext);
  }

  const removedDefs = new Map<string, { name: string; signature: string }>();
  const addedDefs = new Map<string, { name: string; signature: string }>();

  let currentFile: string | null = null;
  for (const line of diff.split(/\r?\n/)) {
    const fileMatch = line.match(/^diff --git a\/(.+?) b\/$/);
    if (fileMatch) {
      currentFile = fileMatch[1] ?? null;
      continue;
    }

    if (!currentFile) continue;

    const ext = extByFile.get(currentFile) ?? extByFile.get(path.basename(currentFile)) ?? path.extname(currentFile).toLowerCase();
    const defPattern = FN_DEF_PATTERNS[ext];
    const arrowPattern = FN_ARROW_PATTERNS[ext];

    const prefix = line.charAt(0);
    const m = defPattern?.exec(line) ?? arrowPattern?.exec(line);
    if (!m) continue;

    const name = m[1]!;
    const signature = m[2]?.trim() ?? "";
    const key = `${currentFile}::${name}`;

    if (prefix === "-") {
      removedDefs.set(key, { name, signature });
    } else if (prefix === "+") {
      addedDefs.set(key, { name, signature });
    }
  }

  const changes: SignatureChange[] = [];
  for (const [key, removed] of removedDefs) {
    const added = addedDefs.get(key);
    if (added && removed.signature !== added.signature) {
      changes.push({
        file: key.split("::")[0]!,
        name: removed.name,
        type: "modified",
        beforeSignature: removed.signature,
        afterSignature: added.signature,
      });
    } else if (!added) {
      changes.push({
        file: key.split("::")[0]!,
        name: removed.name,
        type: "removed",
        beforeSignature: removed.signature,
        afterSignature: null,
      });
    }
  }

  return changes;
}

export function findCallSites(
  cwd: string,
  functionNames: string[],
  excludeFiles: string[],
  maxResults: number = 20,
): CallSite[] {
  const results: CallSite[] = [];
  const excludeSet = new Set(excludeFiles.map((f) => path.basename(f)));

  for (const name of functionNames) {
    if (results.length >= maxResults) break;

    try {
      let output: string;
      try {
        output = execSync(
          `rg -n --no-heading "${name}" --type-add 'code:*.{ts,tsx,js,jsx,py}' --type code . 2>/dev/null`,
          { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
        ).trim();
      } catch {
        output = execSync(
          `grep -rn "${name}" . --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" 2>/dev/null`,
          { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
        ).trim();
      }

      for (const line of output.split(/\r?\n/)) {
        if (results.length >= maxResults) break;

        const m = line.match(/^\.?\/?(.+?):(\d+):(.*)$/);
        if (!m) continue;

        const file = m[1]!;
        const lineNum = Number(m[2]);
        const content = m[3]?.trim() ?? "";

        if (excludeSet.has(path.basename(file))) continue;
        if (file.includes("node_modules/") || file.includes(".dsh/") || file.includes("dist/")) continue;

        const trimmed = content.trimStart();
        if (trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
        if (trimmed.startsWith("def ") || trimmed.startsWith("function ") || trimmed.startsWith("export function")) continue;

        let matchType: CallSite["matchType"] = "direct_call";
        if (content.includes("import ") && content.includes(name)) {
          matchType = "import_reference";
        } else if (content.includes("." + name)) {
          matchType = "attribute_access";
        }

        results.push({ file, line: lineNum, content: content.slice(0, 200), matchType });
      }
    } catch {
      // no matches
    }
  }

  return results.slice(0, maxResults);
}

export function formatCallSiteContext(
  changes: SignatureChange[],
  callSites: CallSite[],
): string | null {
  if (changes.length === 0) return null;

  const parts: string[] = [];
  parts.push("## Signature Changes Detected");
  parts.push("");

  for (const change of changes) {
    const icon = change.type === "modified" ? "[MODIFIED]" : change.type === "added" ? "[ADDED]" : "[REMOVED]";
    parts.push(`- ${icon} **${change.name}** (${change.type}) in \`${change.file}\``);
    if (change.beforeSignature) parts.push(`  Before: \`${change.name}(${change.beforeSignature})\``);
    if (change.afterSignature) parts.push(`  After: \`${change.name}(${change.afterSignature})\``);
  }

  if (callSites.length > 0) {
    parts.push("");
    parts.push(`### Call Sites (${callSites.length} found)`);
    parts.push("These files call the changed functions and may need updating:");
    parts.push("```");
    for (const cs of callSites) {
      parts.push(`${cs.file}:${cs.line} ${cs.content.slice(0, 100)}`);
    }
    parts.push("```");
    parts.push("Update all call sites to match the new signature, or revert the signature change.");
  }

  return parts.join("\n");
}

// ---- Compilation Error Detector ----

const COMPILATION_ERROR_PATTERNS: Array<{ regex: RegExp; extract(parts: RegExpExecArray): { file: string; line: string; col?: string; message: string } | null }> = [
  {
    regex: /\[ERROR\]\s+(\S+\.java):\[(\d+),(\d+)\]\s+(.*)/,
    extract(p) {
      return { file: p[1]!, line: p[2]!, col: p[3]!, message: p[4] ?? "" };
    },
  },
  {
    regex: /^(.+?\.tsx?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)/m,
    extract(p) {
      return { file: p[1]!, line: p[2]!, col: p[3]!, message: `${p[4]}: ${p[5] ?? ""}` };
    },
  },
  {
    regex: /File\s+"([^"]+\.py)",\s+line\s+(\d+)(?:,\s+in\s+(\w+))?/,
    extract(p) {
      return { file: p[1]!, line: p[2]!, message: p[3] ? `in ${p[3]}` : "in <module>" };
    },
  },
  {
    regex: /^(.+?\.\w{1,6}):(\d+):(\d+):\s+(error):\s+(.*)/m,
    extract(p) {
      if (p[4] !== "error") return null;
      return { file: p[1]!, line: p[2]!, col: p[3]!, message: p[5] ?? "" };
    },
  },
  {
    regex: /error\[E\d+\].*\n\s+-->\s+(.+?\.rs):(\d+):(\d+)/,
    extract(p) {
      return { file: p[1]!, line: p[2]!, col: p[3]!, message: "Rust compilation error" };
    },
  },
];

// Exported for regression testing — task pie-phase-d-new-capabilities AC #10/#11.
// Internal callers should go through detectFailures(params) which threads moduleRoots
// from DetectParams. Direct use is only for path-strip behavior unit testing.
export function extractCompilationErrors(
  output: string,
  moduleRoots: string[] = [],
): Array<{ file: string; line: string; col?: string; message: string }> {
  const errors: Array<{ file: string; line: string; col?: string; message: string }> = [];
  const seen = new Set<string>();
  // Path-strip markers derived from project module roots (DetectParams.moduleRoots).
  // Format "/<root>/" so we match dir segments, not basename collisions.
  // Empty moduleRoots → fall back to basename only.
  const markers = moduleRoots.filter((r) => r && r !== ".").map((r) => `/${r}/`);

  // Strip ANSI color codes to ensure regex matches filenames/lines correctly
  // eslint-disable-next-line no-control-regex
  const cleanOutput = output.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");

  for (const { regex, extract } of COMPILATION_ERROR_PATTERNS) {
    const globalRegex = regex.global ? regex : new RegExp(regex.source, regex.flags + "g");
    globalRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = globalRegex.exec(cleanOutput)) !== null) {
      if (match[0].length === 0) globalRegex.lastIndex++;
      const entry = extract(match);
      if (!entry) continue;
      const key = `${entry.file}:${entry.line}:${entry.message.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Strip absolute prefix: keep everything after the last project-root
      // segment; fall back to the basename when no marker matches.
      let rel: string = entry.file;
      for (const dir of markers) {
        const idx = rel.lastIndexOf(dir);
        if (idx !== -1) { rel = rel.slice(idx + 1); break; }
      }
      if (rel === entry.file) rel = entry.file.split("/").pop() ?? entry.file;
      errors.push({ ...entry, file: rel.slice(-80) });
      if (errors.length >= 10) break;
    }
    if (errors.length >= 10) break;
  }

  return errors.slice(0, 10);
}

function detectCompilationError(params: DetectParams): FailureDetection | null {
  if (!params.verifyOutput) return null;

  const roots = params.moduleRoots ?? [];
  const errors = extractCompilationErrors(params.verifyOutput, roots);
  if (errors.length === 0) return null;

  const prevErrors = params.prevVerifyOutput ? extractCompilationErrors(params.prevVerifyOutput, roots) : [];
  const delta = errors.length - prevErrors.length;

  const byFile = new Map<string, typeof errors>();
  for (const e of errors) {
    const list = byFile.get(e.file) ?? [];
    list.push(e);
    byFile.set(e.file, list);
  }

  const summary = [...byFile.entries()]
    .map(([file, errs]) => `  ${file}: ${errs.map((e) => `line ${e.line} - ${e.message.slice(0, 80)}`).join("; ")}`)
    .join("\n");

  const regressionHint = delta > 0
    ? `\n🚨 REGRESSION: Last patch introduced ${delta} NEW error(s). If you are stuck, consider REVERTING your last change and trying a different approach.`
    : delta < 0
    ? `\n👍 PROGRESS: Fixed ${Math.abs(delta)} error(s). Keep going!`
    : "";

  const javaHints = params.verifyOutput.includes(".java")
    ? [
        "Java Tips:",
        "- 'illegal start of type' often means a missing semicolon ';' on the previous line or a curly brace '{' mismatch.",
        "- 'cannot find symbol' for a class usually means a missing import.",
        "- Ensure the class name matches the file name exactly.",
      ].join("\n")
    : "";

  return {
    mode: "compilation-error",
    description: "代码无法通过编译或静态检查",
    confidence: "high",
    evidence: `${errors.length} error(s) across ${byFile.size} file(s):\n${summary}${regressionHint}`,
    repairHint: [
      `COMPILATION ERRORS - ${errors.length} error(s) in ${byFile.size} file(s).`,
      regressionHint,
      "",
      summary,
      "",
      javaHints,
      "",
      "REPAIR STRATEGY:",
      "1. Fix the FIRST error per file - later errors often cascade from it.",
      "2. fix one file at a time. Start with the file with most errors.",
      "3. Use read_file on the ENTIRE file if line numbers seem shifted.",
      "4. Common causes: missing import, type mismatch, wrong package, signature change without updating callers.",
    ].filter(Boolean).join("\n"),
  };
}

// ---- Main ----

function detectDependencyMissing(params: DetectParams): FailureDetection | null {
  if (!params.verifyOutput) return null;

  const output = params.verifyOutput.toLowerCase();
  const dependencyErrorPatterns = [
    /could not resolve dependencies/i,
    /module not found/i,
    /cannot find module/i,
    /failed to resolve/i,
    /no such file or directory.*node_modules/i,
  ];

  const hasDependencyError = dependencyErrorPatterns.some((p) => p.test(output));

  if (hasDependencyError) {
    return {
      mode: "dependency-missing",
      description: "检测到依赖缺失或环境未就绪",
      confidence: "high",
      evidence: `验证输出包含依赖错误: ${params.verifyOutput.slice(0, 200)}`,
      repairHint: [
        "Your verification failed due to missing dependencies or an uninitialized environment.",
        "You are allowed to run installation commands (e.g., `pnpm install`, `mvn install -DskipTests`, `pip install -r requirements.txt`) using `exec_shell`.",
        "Fix the environment first before making further code changes.",
      ].join("\n"),
    };
  }

  return null;
}

const DETECTORS = [
  detectDependencyMissing,
  detectOverconfidence,
  detectPatchDrift,
  detectScopeCreep,
  detectCompilationError,
  detectRuleBlindness,
  detectHallucinatedApi,
  detectSearchReplaceMismatch,
  detectSignatureMismatch,
];

export function detectFailures(params: DetectParams): FailureDetection[] {
  return DETECTORS
    .map((detector) => detector(params))
    .filter((d): d is FailureDetection => d !== null);
}

export function buildRepairHints(detections: FailureDetection[]): string | null {
  if (detections.length === 0) return null;

  // Sort by confidence: high first
  const sorted = [...detections].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.confidence] ?? 1) - (order[b.confidence] ?? 1);
  });

  const highConfidence = sorted.filter((d) => d.confidence === "high");
  const mediumLow = sorted.filter((d) => d.confidence !== "high");

  const parts: string[] = [];

  parts.push("## FAILURE PATTERN ANALYSIS");
  parts.push("");
  parts.push(
    `Detected ${sorted.length} failure pattern(s): ${sorted.map((d) => d.mode).join(", ")}.`,
  );
  parts.push("");

  for (const d of highConfidence) {
    parts.push(`### ${d.mode} (${d.confidence} confidence)`);
    parts.push(`Evidence: ${d.evidence}`);
    parts.push("");
    parts.push(d.repairHint);
    parts.push("");
  }

  for (const d of mediumLow) {
    parts.push(`### ${d.mode} (${d.confidence} confidence)`);
    parts.push(`Evidence: ${d.evidence}`);
    parts.push("");
    parts.push(d.repairHint);
    parts.push("");
  }

  parts.push("---");
  parts.push("Address ALL detected failure patterns in your repair.");
  parts.push("The repair must fix the verification failure AND avoid repeating these patterns.");

  return parts.join("\n");
}
