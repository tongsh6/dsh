// .dsh/project.yml — manual project-intelligence override layer.
// BLUEPRINT §2.6 Phase 2 Tier 3 + spec 2026-05-13-pie-phase2-tier1-submodule-fact-promotion §3.7.

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { z } from "zod";

const ModuleSchema = z.object({
  path: z.string().min(1),
  language: z.string().min(1).optional(),
  buildSystem: z.string().min(1).optional(),
  framework: z.string().min(1).optional(),
});

const VerifyOverrideSchema = z.object({
  build: z.string().nullable().optional(),
  test: z.string().nullable().optional(),
  typecheck: z.string().nullable().optional(),
  lint: z.string().nullable().optional(),
});

export const ProjectYmlSchema = z.object({
  language: z.string().min(1).optional(),
  buildSystem: z.string().min(1).optional(),
  framework: z.string().min(1).optional(),
  modules: z.array(ModuleSchema).optional(),
  verifyOverride: VerifyOverrideSchema.optional(),
}).strict();

export type ProjectYml = z.infer<typeof ProjectYmlSchema>;
export type ProjectYmlModule = z.infer<typeof ModuleSchema>;
export type ProjectYmlVerifyOverride = z.infer<typeof VerifyOverrideSchema>;

const PROJECT_YML_REL_PATH = path.join(".dsh", "project.yml");

export function projectYmlPath(cwd: string): string {
  return path.join(cwd, PROJECT_YML_REL_PATH);
}

/** Read and validate `.dsh/project.yml`. Returns null if file missing.
 *  Throws zod ZodError if file exists but content fails schema. */
export function readProjectYml(cwd: string): ProjectYml | null {
  const p = projectYmlPath(cwd);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf-8");
  const parsed = yaml.load(raw) as unknown;
  // Empty file → return empty object (all fields optional)
  if (parsed === undefined || parsed === null) return {};
  return ProjectYmlSchema.parse(parsed);
}

export function writeProjectYml(cwd: string, data: ProjectYml): void {
  // Validate before writing — never persist malformed yml
  const validated = ProjectYmlSchema.parse(data);
  const p = projectYmlPath(cwd);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, yaml.dump(validated, { lineWidth: 100 }), "utf-8");
}

/** Render a ProjectYml draft from current Intelligence decisions.
 *  Used by `dsh doctor --write` to seed a manual-override file for the user
 *  to edit and commit. Only `auto` decisions are emitted (suggest/blocked
 *  decisions are left for the user to fill in). */
export function renderProjectYml(pi: {
  language: { selected: string | null; mode: string };
  buildSystem: { selected: string | null; mode: string };
  facts: Array<{ key: string; value: unknown }>;
}): ProjectYml {
  const out: ProjectYml = {};
  if (pi.language.mode === "auto" && pi.language.selected) out.language = pi.language.selected;
  if (pi.buildSystem.mode === "auto" && pi.buildSystem.selected) out.buildSystem = pi.buildSystem.selected;

  // Primary framework from facts
  const primaryFw = pi.facts.find((f) => f.value === true && f.key.startsWith("framework.primary."));
  if (primaryFw) out.framework = primaryFw.key.slice("framework.primary.".length);

  // Submodules from facts
  const submoduleByName = new Map<string, ProjectYmlModule>();
  for (const f of pi.facts) {
    if (f.value !== true) continue;
    const sysMatch = f.key.match(/^submodule\.([^.]+)\.([^.]+)$/);
    if (sysMatch) {
      const [, name, system] = sysMatch;
      const entry = submoduleByName.get(name!) ?? { path: name! };
      entry.buildSystem = system;
      submoduleByName.set(name!, entry);
      continue;
    }
    const langMatch = f.key.match(/^submodule\.([^.]+)\.lang\.([^.]+)$/);
    if (langMatch) {
      const [, name, lang] = langMatch;
      const entry = submoduleByName.get(name!) ?? { path: name! };
      entry.language = lang;
      submoduleByName.set(name!, entry);
      continue;
    }
    const fwMatch = f.key.match(/^framework\.submodule\.([^.]+)\.(.+)$/);
    if (fwMatch) {
      const [, name, fw] = fwMatch;
      const entry = submoduleByName.get(name!) ?? { path: name! };
      entry.framework = fw;
      submoduleByName.set(name!, entry);
    }
  }
  if (submoduleByName.size > 0) {
    out.modules = Array.from(submoduleByName.values()).sort((a, b) => a.path.localeCompare(b.path));
  }
  return out;
}
