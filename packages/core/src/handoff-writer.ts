import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskState } from "./task-state.js";

export function writeHandoff(
  state: TaskState,
  cwd: string,
  format: "markdown" | "json" = "markdown",
  outputDir?: string,
): string {
  const dir = outputDir ?? path.join(cwd, ".dsh", "handoff");
  fs.mkdirSync(dir, { recursive: true });

  const timestamp = state.task.created_at.replace(/[:.]/g, "-");
  const taskSlug = state.task.description.slice(0, 40).replace(/[^a-zA-Z0-9一-鿿]/g, "-");

  if (format === "json") {
    const filePath = path.join(dir, `handoff-${taskSlug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
    return filePath;
  }

  // markdown
  const md = buildMarkdown(state);
  const filePath = path.join(dir, `handoff-${taskSlug}.md`);
  fs.writeFileSync(filePath, md, "utf-8");
  return filePath;
}

function buildMarkdown(state: TaskState): string {
  const lines: string[] = [];

  const statusLabel = state.status === "verified"
    ? "✓ 完成"
    : state.status === "repair_exhausted"
    ? "⚠ 修复未完成"
    : "◐ " + state.status;

  lines.push(`# Handoff: ${state.task.description}`);
  lines.push("");
  lines.push(`| 项目 | 值 |`);
  lines.push(`|------|-----|`);
  lines.push(`| 日期 | ${state.task.created_at} |`);
  lines.push(`| 任务类型 | ${state.task.type} |`);
  lines.push(`| 状态 | ${statusLabel} |`);
  lines.push(`| 修复轮数 | ${state.repair_rounds} |`);
  lines.push("");

  // Plan
  if (state.plan) {
    lines.push("## 修改了什么");
    lines.push("");
    lines.push("| 文件 |");
    lines.push("|------|");
    for (const f of state.plan.files) {
      lines.push(`| ${f} |`);
    }
    lines.push("");
    lines.push(state.plan.raw_xml);
    lines.push("");
  }

  // Changes from patches
  const allFiles = new Set<string>();
  for (const p of state.patches) {
    for (const f of p.files_changed) {
      allFiles.add(f);
    }
  }
  if (allFiles.size > 0) {
    lines.push("### 实际修改文件");
    lines.push("");
    for (const f of allFiles) {
      lines.push(`- ${f}`);
    }
    lines.push("");
  }

  // Verify results
  if (state.verify_results.length > 0) {
    lines.push("## 验证结果");
    lines.push("");
    for (const round of state.verify_results) {
      lines.push(`### Round ${round.round}`);
      lines.push("");
      for (const r of round.results) {
        const icon = r.status === "passed" ? "✓" : "✗";
        lines.push(`- ${icon} \`${r.command}\` (${(r.duration_ms / 1000).toFixed(1)}s)`);
      }
      lines.push("");
    }
  }

  // Repair history
  if (state.repair_rounds > 0) {
    lines.push("## 修复历史");
    lines.push("");
    for (let i = 1; i <= state.repair_rounds; i++) {
      const patch = state.patches.find((p) => p.round === i);
      const results = state.verify_results.find((r) => r.round === i);
      const status = results && results.results.every((r) => r.status === "passed")
        ? "✓ 通过"
        : "✗ 失败";
      lines.push(`${i}. ${patch?.apply_status === "ok" ? "Patch applied" : "Patch failed"} — ${status}`);
    }
    lines.push("");
  }

  // Risks
  if (state.plan?.risks && state.plan.risks.length > 0) {
    lines.push("## 风险");
    lines.push("");
    for (const risk of state.plan.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push("");
  }

  // Next steps
  lines.push("## 下一步");
  lines.push("");
  if (state.status === "verified") {
    lines.push("- Review the changes and commit");
    lines.push("- Consider adding tests for modified code paths");
  } else {
    lines.push("- Manual intervention required — review .dsh/task-state.json for details");
  }

  return lines.join("\n");
}
