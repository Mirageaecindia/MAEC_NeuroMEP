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
