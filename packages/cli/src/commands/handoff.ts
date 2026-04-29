import { runHandoff, readTaskState } from "@dsh/core";

interface HandoffOptions {
  format?: "markdown" | "json";
  output?: string;
}

export async function handoffCommand(opts: HandoffOptions): Promise<void> {
  const cwd = process.cwd();

  const state = readTaskState(cwd);
  if (!state) {
    console.log("错误: 尚未初始化。请先运行 dsh init");
    process.exit(1);
  }

  if (state.status !== "verified" && state.status !== "repair_exhausted" && state.status !== "done") {
    console.log(`警告: 当前状态为 ${state.status}，建议先完成验证`);
  }

  const format = opts.format ?? "markdown";
  const filePath = await runHandoff({ cwd, format, outputDir: opts.output });

  console.log(`✓ 交接文件已生成: ${filePath}`);
  console.log("");
  console.log("## 摘要");
  console.log(`任务: ${state.task.description}`);
  console.log(`类型: ${state.task.type}`);
  console.log(`状态: ${state.status}`);
  console.log(`修复轮数: ${state.repair_rounds}`);
  console.log(`补丁数: ${state.patches.length}`);
  console.log(`验证轮数: ${state.verify_results.length}`);
}
