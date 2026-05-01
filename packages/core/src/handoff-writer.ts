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

  if (state.static_scan_runs.length > 0) {
    lines.push("## 静态扫描");
    lines.push("");
    for (const scan of state.static_scan_runs) {
      const icon = scan.status === "passed" ? "✓" : "✗";
      lines.push(`### Scan Round ${scan.round}`);
      lines.push("");
      lines.push(`- ${icon} \`${scan.command}\` (${(scan.duration_ms / 1000).toFixed(1)}s)`);
      lines.push(`- 原始输出: \`${scan.output_path}\``);
      lines.push(`- 发现问题: ${scan.total_findings}`);
      if (scan.selected_top_n.length > 0) {
        lines.push(`- Top N 选择: ${scan.selected_top_n.map((f) => f.id).join(", ")}`);
      }
      lines.push("");
    }
  }

  if (state.static_repair_results.length > 0) {
    lines.push("## 静态扫描 Top N 修复");
    lines.push("");
    for (const repair of state.static_repair_results) {
      const icon = repair.apply_status === "ok" ? "✓" : repair.apply_status === "skipped" ? "◐" : "✗";
      lines.push(`### Repair Round ${repair.round}`);
      lines.push("");
      lines.push(`- ${icon} 处理扫描轮次: ${repair.scan_round}`);
      lines.push(`- 处理的问题: ${repair.selected_finding_ids.join(", ") || "无"}`);
      lines.push(`- 处理方式: ${repair.strategy}`);
      lines.push(`- 应用结果: ${repair.apply_status}`);
      lines.push(`- 复扫结果: ${repair.post_scan_status}`);
      lines.push(`- 剩余问题: ${repair.remaining_findings}`);
      if (repair.files_changed.length > 0) {
        lines.push(`- 修改文件: ${repair.files_changed.join(", ")}`);
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
