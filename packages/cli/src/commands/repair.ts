import { DeepSeekClient } from "@dsh/provider";
import { runRepair } from "@dsh/core";
import type { RepairRoundResult } from "@dsh/core";

interface RepairOptions {
  rounds: number;
}

interface StaticScanSummary {
  status: "passed" | "failed";
  total_findings: number;
  selected_top_n: unknown[];
}

interface StaticRepairSummary {
  apply_status: "ok" | "failed" | "skipped";
  post_scan_status: "passed" | "failed" | "skipped";
  remaining_findings: number;
}

interface StaticScanState {
  static_scan_runs?: StaticScanSummary[];
  static_repair_results?: StaticRepairSummary[];
}

export async function repairCommand(opts: RepairOptions): Promise<void> {
  const cwd = process.cwd();
  const maxRounds = opts.rounds ?? 3;

  let client: DeepSeekClient;
  try {
    client = DeepSeekClient.fromEnv();
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const onRound = (round: number, result: RepairRoundResult) => {
    console.log(`⟳ Repair Round ${round}/${maxRounds}:`);
    if (result.error) console.log(`  ✗ ${result.error}`);
    if (result.patched) console.log("  ✓ patch 应用成功");
    if (result.verifyOutput) console.log(result.verifyOutput);
  };

  let state;
  try {
    state = await runRepair({ cwd, client, maxRounds, onRound });
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  if (state.status === "verified") {
    console.log("");
    console.log(`→ 修复成功 (${state.repair_rounds} 轮)。下一步: dsh handoff`);
  } else {
    console.log("");
    console.log(`→ ${maxRounds} 轮修复未能解决。请手动介入。`);
    console.log("  失败日志: .dsh/task-state.json → verify_results");
  }

  const scanState = state as StaticScanState;
  const latestScan = scanState.static_scan_runs?.at(-1);
  if (latestScan) {
    console.log(`  静态扫描: ${latestScan.status}，发现 ${latestScan.total_findings} 个问题，Top N ${latestScan.selected_top_n.length} 个`);
    const latestRepair = scanState.static_repair_results?.at(-1);
    if (latestRepair) {
      console.log(`  Top N 修复: ${latestRepair.apply_status}，复扫 ${latestRepair.post_scan_status}，剩余 ${latestRepair.remaining_findings} 个`);
    }
  }
}
