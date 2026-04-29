import { DeepSeekClient } from "@dsh/provider";
import { runPatch } from "@dsh/core";

interface PatchOptions {
  auto?: boolean;
  dryRun?: boolean;
}

export async function patchCommand(opts: PatchOptions): Promise<void> {
  const cwd = process.cwd();

  let client: DeepSeekClient;
  try {
    client = DeepSeekClient.fromEnv();
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

  if (opts.dryRun) {
    const lastPatch = state.patches.at(-1);
    console.log("");
    console.log(lastPatch?.patch ?? "(no patch)");
    console.log(`→ 将修改 ${lastPatch?.files_changed.length ?? 0} 个文件 (dry-run)`);
    return;
  }

  console.log(`✓ 已修改 ${state.patches.at(-1)?.files_changed.length ?? 0} 个文件`);
  console.log("→ 下一步: dsh verify");
}
