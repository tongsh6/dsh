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

// ---- Main ----

const DETECTORS = [
  detectOverconfidence,
  detectPatchDrift,
  detectScopeCreep,
  detectRuleBlindness,
  detectHallucinatedApi,
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
