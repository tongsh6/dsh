
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

export function loadDshConfig(cwd: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(path.join(cwd, ".dsh", "config.yml"), "utf-8");
    const parsed = yaml.load(raw);
    if (parsed === null || parsed === undefined) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
