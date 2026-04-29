import { runVerify, formatResults, summarizeResults } from "@dsh/core";

interface VerifyOptions {
  test?: boolean;
  lint?: boolean;
  typecheck?: boolean;
  all?: boolean;
}

export async function verifyCommand(opts: VerifyOptions): Promise<void> {
  const cwd = process.cwd();

  const test = opts.test || opts.all || undefined;
  const lint = opts.lint || opts.all || undefined;
  const typecheck = opts.typecheck || opts.all || undefined;

  console.log("正在执行验证...");
  console.log("");

  let state;
  try {
    state = await runVerify({ cwd, test, lint, typecheck });
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const lastRound = state.verify_results.at(-1);
  if (lastRound) {
    console.log(formatResults(lastRound.results));
    console.log("");
    console.log(summarizeResults(lastRound.results));
  }

  if (state.status === "verified") {
    console.log("");
    console.log("→ 全部通过。下一步: dsh handoff");
  } else {
    console.log("");
    console.log("→ 验证失败。下一步: dsh repair");
  }
}
