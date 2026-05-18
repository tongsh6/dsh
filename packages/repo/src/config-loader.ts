import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

// ---- Types ----

export interface DshConfig extends Record<string, unknown> {
  project?: {
    name?: string;
    language?: string;
    package_manager?: string;
    framework?: string;
  };
  verify?: {
    test?: string;
    lint?: string;
    typecheck?: string;
    build?: string;
    commands?: string[];
    initial_preflight?: boolean;
    preflight_commands?: string[];
    preflight_assertions?: unknown[];
    // Structured assertions (spec 2026-05-08-verify-protocol-structured §3.3).
    // When non-empty, takes precedence over commands/test/lint/typecheck.
    // Each entry must conform to VerifyAssertion shape; parsing happens at
    // resolveVerifyAssertions time in @dsh/core/pipeline.
    assertions?: unknown[];
  };
  static_scan?: {
    enabled?: boolean;
    command?: string;
    top_n?: number;
    selection?: {
      weights?: {
        severity?: number;
        changed_file?: number;
        security?: number;
        build_blocking?: number;
        rule_confidence?: number;
      };
    };
  };
  rules?: {
    files?: { path: string }[];
  };
  deepseek?: {
    default_model?: string;
    flash_model?: string;
    plan_explore_model?: string;
    plan_explore_thinking?: boolean;
    plan_finalize_model?: string;
    plan_finalize_thinking?: boolean;
    plan_protocol_repair_model?: string;
    plan_protocol_repair_thinking?: boolean;
    max_repair_rounds?: number;
    thinking_default?: boolean;
    api_key?: string;
  };
}

// ---- DSH root discovery ----

/**
 * Walk up the directory tree from `startDir` to find the nearest `.dsh/` directory.
 * Returns the path to the `.dsh/` directory, or null if not found (up to filesystem root).
 */
export function findDshRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    const dshPath = path.join(current, ".dsh");
    if (fs.existsSync(dshPath) && fs.statSync(dshPath).isDirectory()) {
      return dshPath;
    }
    
    // Boundary: Stop if we hit a .git entry (file or directory)
    // This prevents walking up past the project root in worktrees or nested repos.
    const gitPath = path.join(current, ".git");
    if (fs.existsSync(gitPath)) {
      break;
    }

    current = path.dirname(current);
  }

  // Check root as well
  const rootDsh = path.join(root, ".dsh");
  if (fs.existsSync(rootDsh) && fs.statSync(rootDsh).isDirectory()) {
    return rootDsh;
  }

  return null;
}

// ---- Read ----

export function loadDshConfig(cwd: string): DshConfig {
  try {
    const dshRoot = findDshRoot(cwd);
    if (!dshRoot) return {};
    const raw = fs.readFileSync(path.join(dshRoot, "config.yml"), "utf-8");
    const parsed = yaml.load(raw);
    if (parsed === null || parsed === undefined) return {};
    return parsed as DshConfig;
  } catch {
    return {};
  }
}

// ---- Write (merge semantics) ----

export function writeDshConfig(cwd: string, overrides: DshConfig): void {
  const existing = loadDshConfig(cwd);
  const merged = mergeConfig(existing, overrides);
  const dshRoot = findDshRoot(cwd) ?? path.join(path.resolve(cwd), ".dsh");
  const configPath = path.join(dshRoot, "config.yml");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml.dump(merged, { lineWidth: -1, noRefs: true }), "utf-8");
}

// ---- Key extraction ----

export function readApiKey(cwd: string): string | null {
  const config = loadDshConfig(cwd);
  const key = config.deepseek?.api_key;
  if (typeof key === "string" && key.trim().length > 0) {
    return key.trim();
  }
  return null;
}

// ---- Merge ----

export function mergeConfig(existing: DshConfig, overrides: DshConfig): DshConfig {
  const result: Record<string, unknown> = {};

  // Start with all existing keys
  for (const [key, val] of Object.entries(existing)) {
    result[key] = val;
  }

  // Apply overrides
  for (const [key, val] of Object.entries(overrides)) {
    if (val === undefined) continue;
    const existingVal = result[key];

    if (Array.isArray(val)) {
      // Arrays: replace entirely (not concatenate)
      result[key] = val;
    } else if (isRecord(val) && isRecord(existingVal)) {
      // Nested objects: recursive merge
      result[key] = mergeConfig(existingVal as DshConfig, val as DshConfig);
    } else if (val !== null) {
      // Scalars: override
      result[key] = val;
    }
    // null values are skipped (don't erase existing)
  }

  return result as DshConfig;
}

// ---- Internal helpers ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
