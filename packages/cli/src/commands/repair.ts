import { DeepSeekClient } from "@dsh/provider";
import { loadRuleContents, detectTechStack, generateRepoContext, rankFiles, loadTopFiles, scanProjectFiles } from "@dsh/repo";
import {
  readTaskState,
  runRepairLoop,
  buildBaseContext,
  buildRepoContext,
  buildTaskContext,
  assembleContext,
} from "@dsh/core";
import type { RepairRoundResult } from "@dsh/core";
import { readConfig } from "../utils/config.js";

interface RepairOptions {
  rounds: number;
}

export async function repairCommand(opts: RepairOptions): Promise<void> {
  const cwd = process.cwd();

  let state = readTaskState(cwd);
  if (!state) {
    console.log("错误: 尚未初始化。请先运行 dsh init");
    process.exit(1);
  }

  if (state.status !== "verification_failed") {
    console.log(`错误: 当前状态为 ${state.status}，需要 verification_failed`);
    process.exit(1);
  }

  const maxRounds = opts.rounds ?? 3;
  let client: DeepSeekClient;
  try {
    client = DeepSeekClient.fromEnv();
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  // Build stable context layers
  const config = readConfig(cwd);
  const rules = loadRuleContents(cwd);
  const stack = detectTechStack(cwd);
  const repoContext = generateRepoContext(cwd, stack);

  const allFiles = await scanProjectFiles(cwd);
  const ranked = rankFiles(state.task.description, allFiles);
  const taskFiles = loadTopFiles(cwd, ranked, 10);

  const contextLayers = assembleContext({
    config,
    rules,
    repoContext,
    taskState: state,
    taskFiles,
  });

  // Bridge: set verify commands from config onto plan for repair-loop to use
  const verifyConfig = config.verify as Record<string, string> | undefined;
  if (verifyConfig && state.plan) {
    const commands = [verifyConfig.test, verifyConfig.lint, verifyConfig.typecheck]
      .filter((c): c is string => typeof c === "string" && c.length > 0);
    state.plan = { ...state.plan, verify_commands: commands };
  }

  const onRound = (round: number, result: RepairRoundResult) => {
    console.log(`⟳ Repair Round ${round}/${maxRounds}:`);
    if (result.error) {
      console.log(`  ✗ ${result.error}`);
    }
    if (result.patched) {
      console.log("  ✓ patch 应用成功");
    }
    if (result.verifyOutput) {
      console.log(result.verifyOutput);
    }
  };

  const finalState = await runRepairLoop(state, {
    client,
    cwd,
    maxRounds,
    contextLayers,
    onRound,
  });

  if (finalState.status === "verified") {
    console.log("");
    console.log(`→ 修复成功 (${finalState.repair_rounds} 轮)。下一步: dsh handoff`);
  } else {
    console.log("");
    console.log(`→ ${maxRounds} 轮修复未能解决。请手动介入。`);
    console.log("  失败日志: .dsh/task-state.json → verify_results");
  }
}

