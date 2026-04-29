import { readTaskState, writeTaskState, transition, runVerify, isAllPassed, formatResults, summarizeResults } from "@dsh/core";
import { readConfig } from "../utils/config.js";

interface VerifyOptions {
  test?: boolean;
  lint?: boolean;
  typecheck?: boolean;
  all?: boolean;
}

export async function verifyCommand(opts: VerifyOptions): Promise<void> {
  const cwd = process.cwd();

  let state = readTaskState(cwd);
  if (!state) {
    console.log("错误: 尚未初始化。请先运行 dsh init");
    process.exit(1);
  }

  if (state.status !== "patched" && state.status !== "repairing") {
    console.log(`错误: 当前状态为 ${state.status}，需要 patched`);
    process.exit(1);
  }

  // Read verify commands from config
  const config = readConfig(cwd);
  const verifyConfig = config.verify as Record<string, string> | undefined;
  const commands: string[] = [];

  if (opts.test || opts.all) commands.push(verifyConfig?.test ?? "");
  if (opts.lint || opts.all) commands.push(verifyConfig?.lint ?? "");
  if (opts.typecheck || opts.all) commands.push(verifyConfig?.typecheck ?? "");

  // If no specific flags, run all
  if (!opts.test && !opts.lint && !opts.typecheck && !opts.all) {
    if (verifyConfig?.test) commands.push(verifyConfig.test);
    if (verifyConfig?.lint) commands.push(verifyConfig.lint);
    if (verifyConfig?.typecheck) commands.push(verifyConfig.typecheck);
  }

  const validCommands = commands.filter((c) => c && c.trim());
  if (validCommands.length === 0) {
    console.log("错误: 没有配置验证命令。请检查 .dsh/config.yml");
    process.exit(1);
  }

  console.log("正在执行验证...");
  console.log("");

  const results = runVerify(validCommands, cwd);
  const round = (state.verify_results?.length ?? 0) + 1;
  state.verify_results.push({ round, results });

  console.log(formatResults(results));
  console.log("");
  console.log(summarizeResults(results));

  if (isAllPassed(results)) {
    state = transition(state, "verified");
    console.log("");
    console.log("→ 全部通过。下一步: dsh handoff");
  } else {
    state = transition(state, "verification_failed");
    console.log("");
    console.log("→ 验证失败。下一步: dsh repair");
  }

  writeTaskState(cwd, state);
}

