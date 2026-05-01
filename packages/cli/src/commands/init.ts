import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { detectTechStack, detectVerifyCommands, loadRuleContents } from "@dsh/repo";

interface InitOptions {
  force?: boolean;
}

export async function initCommand(opts: InitOptions): Promise<void> {
  const cwd = process.cwd();
  const dshDir = path.join(cwd, ".dsh");
  const configPath = path.join(dshDir, "config.yml");

  if (fs.existsSync(configPath) && !opts.force) {
    console.log("dsh 已初始化。使用 --force 覆盖。");
    return;
  }

  console.log("正在分析项目...");
  const stack = detectTechStack(cwd);
  const verify = detectVerifyCommands(cwd, stack);
  const rules = loadRuleContents(cwd);

  const config: Record<string, unknown> = {
    project: {
      name: path.basename(cwd),
      language: stack.language,
      package_manager: stack.packageManager ?? "unknown",
    },
    verify: {
      test: verify.test ?? "",
      lint: verify.lint ?? "",
      typecheck: verify.typecheck ?? "",
      build: verify.build ?? "",
    },
    static_scan: {
      enabled: true,
      command: verify.lint ?? "",
      top_n: 5,
    },
    rules: {
      files: rules.map((r) => ({ path: r.path })),
    },
    deepseek: {
      default_model: "deepseek-v4-pro",
      flash_model: "deepseek-v4-flash",
      max_repair_rounds: 3,
      thinking_default: true,
      api_key: "",
    },
  };

  fs.mkdirSync(dshDir, { recursive: true });
  fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: -1, noRefs: true }), "utf-8");

  const statePath = path.join(dshDir, "task-state.json");
  const initialState = {
    version: "0.1",
    status: "init",
    task: {
      description: "",
      type: "feature",
      created_at: new Date().toISOString(),
    },
    patches: [],
    verify_results: [],
    repair_rounds: 0,
  };
  fs.writeFileSync(statePath, JSON.stringify(initialState, null, 2), "utf-8");

  console.log("");
  console.log(`✓ 检测到 ${stack.language} 项目`);
  if (stack.framework) console.log(`  框架: ${stack.framework}`);
  console.log("");
  console.log("✓ 验证命令:");
  if (verify.test) console.log(`  test:      ${verify.test}`);
  if (verify.lint) console.log(`  lint:      ${verify.lint}`);
  if (verify.typecheck) console.log(`  typecheck: ${verify.typecheck}`);
  if (verify.build) console.log(`  build:     ${verify.build}`);
  console.log("");

  if (rules.length > 0) {
    console.log("✓ 规则文件:");
    for (const r of rules) console.log(`  - ${r.path}`);
    console.log("");
  }

  console.log(`✓ 配置已写入 ${configPath}`);
  console.log("");
  console.log("下一步: dsh plan \"你的任务描述\"");
}
