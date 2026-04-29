#!/usr/bin/env node
import { cac } from "cac";
import { initCommand } from "./commands/init.js";
import { planCommand } from "./commands/plan.js";
import { patchCommand } from "./commands/patch.js";
import { verifyCommand } from "./commands/verify.js";
import { repairCommand } from "./commands/repair.js";
import { handoffCommand } from "./commands/handoff.js";

const cli = cac("dsh");

cli
  .command("init", "Initialize dsh configuration for the project")
  .option("--force", "Overwrite existing config")
  .action(initCommand);

cli
  .command("plan <description>", "Generate a task plan")
  .option("--type <type>", "Task type: bugfix, feature, refactor, test, docs")
  .action((description, opts) => planCommand(description, opts));

cli
  .command("patch", "Generate and apply a patch from the current plan")
  .option("--auto", "Apply patch without confirmation")
  .option("--dry-run", "Show patch without applying")
  .action((opts) => patchCommand(opts));

cli
  .command("verify", "Run verification commands")
  .option("--test", "Run only tests")
  .option("--lint", "Run only linter")
  .option("--typecheck", "Run only type check")
  .option("--all", "Run all commands")
  .action((opts) => verifyCommand(opts));

cli
  .command("repair", "Repair failed verification")
  .option("--rounds <n>", "Max repair rounds", { default: 3 })
  .action((opts) => repairCommand(opts));

cli
  .command("handoff", "Generate handoff report")
  .option("--format <format>", "Output format: markdown or json", { default: "markdown" })
  .option("--output <dir>", "Output directory")
  .action((opts) => handoffCommand(opts));

cli.help();
cli.version("0.1.0");

cli.parse();
