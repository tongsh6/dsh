import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

export function readConfig(cwd: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(path.join(cwd, ".dsh", "config.yml"), "utf-8");
    return (yaml.load(raw) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}
