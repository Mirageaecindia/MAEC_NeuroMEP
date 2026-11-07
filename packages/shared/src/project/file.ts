import { migrateProjectData } from './migrate.js';
import { PROJECT_SCHEMA_VERSION, ProjectSchema, type Project } from './schema.js';

/** Project file (.json) contents - the project document itself (FR-10). */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export type ProjectFileResult = { ok: true; project: Project } | { ok: false; error: string };

/** Reads a project file, with a plain-language error for unsupported or damaged files. */
export function parseProjectFile(text: string): ProjectFileResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON, so it cannot be a NeuroMEP project.' };
  }
  if (typeof data !== 'object' || data === null || !('schemaVersion' in data)) {
    return { ok: false, error: 'This file is not a NeuroMEP project file (no schemaVersion).' };
  }
  data = migrateProjectData(data);
  const v = (data as { schemaVersion: unknown }).schemaVersion;
  if (v !== PROJECT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported project file version ${JSON.stringify(v)}. This version of NeuroMEP reads version ${PROJECT_SCHEMA_VERSION}.`,
    };
  }
  const parsed = ProjectSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` (at ${first.path.join('.')})` : '';
    return { ok: false, error: `The project file is damaged or incomplete${where}.` };
  }
  return { ok: true, project: parsed.data };
}

/**
 * The name of a copied project (import of a project file, Save as new project): unchanged when
 * no other project has it, else name_duplicated, name_duplicated_2 ... (user request 7 Nov 2026).
 * Names are compared ignoring case and spaces at the ends; an empty name stays empty.
 */
export function uniqueProjectName(name: string, existing: readonly string[]): string {
  const base = name.trim();
  if (!base) return name;
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 1; ; n++) {
    const next = n === 1 ? `${base}_duplicated` : `${base}_duplicated_${n}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
}
