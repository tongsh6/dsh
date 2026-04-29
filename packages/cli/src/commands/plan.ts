import { DeepSeekClient } from "@dsh/provider";
import { runPlan } from "@dsh/core";

interface PlanOptions {
  type?: string;
}

export async function planCommand(description: string, opts: PlanOptions): Promise<void> {
  const cwd = process.cwd();
  const taskType = (opts.type ?? "feature") as "bugfix" | "feature" | "refactor" | "test" | "docs";

  let client: DeepSeekClient;
  try {
    client = DeepSeekClient.fromEnv();
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  console.log("正在分析任务和项目上下文...");

  let state;
  try {
    state = await runPlan({ cwd, client, description, taskType });
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  console.log("");
  console.log("## 计划");
  console.log(state.plan?.raw_xml ?? "");
  console.log("");
  if (state.plan?.files && state.plan.files.length > 0) {
    console.log("### 涉及文件");
    for (const f of state.plan.files) console.log(`- ${f}`);
    console.log("");
  }
  if (state.plan?.risks && state.plan.risks.length > 0) {
    console.log("### 风险");
    for (const r of state.plan.risks) console.log(`- ${r}`);
    console.log("");
  }
  console.log("→ 下一步: dsh patch");
}
