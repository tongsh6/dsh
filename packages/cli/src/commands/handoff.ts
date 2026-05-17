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

  if (state.deepseek_usage.length > 0) {
    const totals = state.deepseek_usage.reduce(
      (acc, usage) => ({
        prompt: acc.prompt + usage.prompt,
        completion: acc.completion + usage.completion,
        total: acc.total + usage.total,
        reasoning: acc.reasoning + usage.reasoning,
        cacheHit: acc.cacheHit + usage.cache_hit,
        cacheMiss: acc.cacheMiss + usage.cache_miss,
      }),
      { prompt: 0, completion: 0, total: 0, reasoning: 0, cacheHit: 0, cacheMiss: 0 },
    );
    const cacheTotal = totals.cacheHit + totals.cacheMiss;
    const hitRatio = cacheTotal > 0 ? totals.cacheHit / cacheTotal : 0;
    console.log("");
    console.log("Token Usage:");
    console.log(`- Prompt: ${totals.prompt}`);
    console.log(`- Completion: ${totals.completion}`);
    console.log(`- Reasoning: ${totals.reasoning}`);
    console.log(`- Cache Hit: ${totals.cacheHit}`);
    console.log(`- Cache Miss: ${totals.cacheMiss}`);
    console.log(`- Cache Hit Ratio: ${(hitRatio * 100).toFixed(2)}%`);
    console.log(`- Total: ${totals.total}`);
  }
}
