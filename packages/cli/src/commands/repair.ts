import { DeepSeekClient } from "@dsh/provider";
import { runRepair } from "@dsh/core";
import type { RepairRoundResult } from "@dsh/core";

interface RepairOptions {
  rounds: number;
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
}
