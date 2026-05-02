import type { DeepSeekClient } from "@dsh/provider";
import { runPatch } from "@dsh/core";
import { createClient } from "../utils/config.js";

interface PatchOptions {
  auto?: boolean;
  dryRun?: boolean;
}

interface CategorizedChanges {
  created: string[];
  renamed: string[];
  modified: string[];
  deleted: string[];
}

interface StaticScanSummary {
  round: number;
  status: "passed" | "failed";
  total_findings: number;
  selected_top_n: unknown[];
}

interface StaticRepairSummary {
  scan_round: number;
  post_scan_round?: number;
  apply_status: "ok" | "failed" | "skipped";
  post_scan_status: "passed" | "failed" | "skipped";
  remaining_findings: number;
}

interface StaticScanState {
  static_scan_runs?: StaticScanSummary[];
  static_repair_results?: StaticRepairSummary[];
}

function categorizeChanges(patchText: string): CategorizedChanges {
  const created: string[] = [];
  const renamed: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const m of patchText.matchAll(/<CREATE\s+path="([^"]+)"/g)) {
    if (m[1]) created.push(m[1]);
  }
  for (const m of patchText.matchAll(/<RENAME\s+from="([^"]+)"\s+to="([^"]+)"/g)) {
    if (m[1] && m[2]) renamed.push(`${m[1]} → ${m[2]}`);
  }
  for (const m of patchText.matchAll(/<DELETE\s+path="([^"]+)"/g)) {
    if (m[1]) deleted.push(m[1]);
  }
  for (const m of patchText.matchAll(/^---\s+a\/(.+)$/gm)) {
    if (m[1]) modified.push(m[1]);
  }

  return { created, renamed, modified, deleted };
}

function formatChangeSummary(changes: CategorizedChanges): string {
  const parts: string[] = [];
  if (changes.created.length > 0) {
    parts.push(`创建 ${changes.created.length} 个文件`);
  }
  if (changes.renamed.length > 0) {
    parts.push(`重命名 ${changes.renamed.length} 个文件`);
  }
  if (changes.modified.length > 0) {
    parts.push(`修改 ${changes.modified.length} 个文件`);
  }
  if (changes.deleted.length > 0) {
    parts.push(`删除 ${changes.deleted.length} 个文件`);
  }
  return parts.join("，") || "无文件变更";
}

export async function patchCommand(opts: PatchOptions): Promise<void> {
  const cwd = process.cwd();

  let client: DeepSeekClient;
  try {
    client = createClient(cwd);
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  let state;
  try {
    state = await runPatch({ cwd, client, auto: opts.auto, dryRun: opts.dryRun });
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const lastPatch = state.patches.at(-1);

  if (opts.dryRun) {
    if (lastPatch?.patch && lastPatch.patch !== "<empty>") {
      console.log("");
      console.log(lastPatch.patch);
    } else {
      console.log("(no patch)");
    }
    const changes = categorizeChanges(lastPatch?.patch ?? "");
    console.log(`→ ${formatChangeSummary(changes)} (dry-run)`);
    return;
  }

  const changes = categorizeChanges(lastPatch?.patch ?? "");
  console.log(`✓ ${formatChangeSummary(changes)}`);
  const scanState = state as StaticScanState;
  const latestScan = scanState.static_scan_runs?.at(-1);
  if (latestScan) {
    const selected = latestScan.selected_top_n.length;
    console.log(`✓ 静态扫描: ${latestScan.status}，发现 ${latestScan.total_findings} 个问题，Top N ${selected} 个`);
    const latestRepair = scanState.static_repair_results?.at(-1);
    if (latestRepair?.scan_round === latestScan.round || latestRepair?.post_scan_round === latestScan.round) {
      console.log(`✓ Top N 修复: ${latestRepair.apply_status}，复扫 ${latestRepair.post_scan_status}，剩余 ${latestRepair.remaining_findings} 个`);
    }
  }
  console.log("→ 下一步: dsh verify");
}
