import * as fs from "node:fs";
import * as path from "node:path";
import {
  assembleIntelligence,
  projectYmlPath,
  readProjectYml,
  renderProjectYml,
  toProjectCard,
  writeProjectYml,
} from "@dsh/repo";

interface DoctorOptions {
  write?: boolean;
  force?: boolean;
}

export async function doctorCommand(opts: DoctorOptions): Promise<void> {
  const cwd = process.cwd();

  let pi;
  try {
    pi = assembleIntelligence(cwd);
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  // Surface project.yml schema errors explicitly — assembleIntelligence
  // silently ignores malformed yml. dsh doctor is the right place to alert.
  if (fs.existsSync(projectYmlPath(cwd))) {
    try {
      readProjectYml(cwd);
    } catch (e) {
      console.log(`警告: .dsh/project.yml 无法解析 — ${e instanceof Error ? e.message : String(e)}`);
      console.log("  人工锁定将被忽略，推断将仅基于自动 Fact 收集。\n");
    }
  }

  // doctor is human-facing — show full capability commands
  console.log(toProjectCard(pi, { includeCommands: true }));

  if (!opts.write) return;

  const target = projectYmlPath(cwd);
  if (fs.existsSync(target) && !opts.force) {
    console.log("");
    console.log(`提示: ${path.relative(cwd, target)} 已存在，使用 --force 覆盖`);
    return;
  }

  const draft = renderProjectYml(pi);
  try {
    writeProjectYml(cwd, draft);
  } catch (e) {
    console.log(`错误: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  console.log("");
  console.log(`✓ 已写入 ${path.relative(cwd, target)}`);
  console.log("  编辑并提交后，assembleIntelligence 将以本文件锁定的字段为准。");
}
