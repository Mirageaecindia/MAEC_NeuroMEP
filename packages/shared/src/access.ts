import type { Discipline } from './model/elements.js';
import type { Project } from './project/schema.js';
import type { Role } from './roles.js';
import type { UserSummary } from './users.js';

/**
 * Project access rules (design doc Section 2). Interim until OI-28 (roles, MAEC One login):
 * - Technical Lead, Checker and System Administrator see every project.
 * - Discipline engineers see projects they created or are assigned to.
 * - Only the Technical Lead creates projects and edits Project Set-up (Page 1).
 */
const SEES_ALL = new Set(['TECHNICAL_LEAD', 'CHECKER', 'SYSTEM_ADMINISTRATOR']);

export function canViewProject(
  user: UserSummary,
  project: Pick<Project, 'meta' | 'disciplines'>,
): boolean {
  if (SEES_ALL.has(user.role)) return true;
  const d = project.disciplines;
  return (
    project.meta.createdBy === user.id ||
    d.electrical.includes(user.id) ||
    d.mechanical.includes(user.id) ||
    d.phe.includes(user.id)
  );
}

export const canCreateProject = (user: UserSummary) => user.role === 'TECHNICAL_LEAD';
export const canEditProjectSetup = (user: UserSummary) => user.role === 'TECHNICAL_LEAD';

/** What the project picker lists (D-13). */
export interface ProjectSummary {
  id: string;
  name: string;
  clientName: string;
  designStage: Project['details']['designStage'];
  revision: string;
  updatedAt: string;
  lastPage: Project['meta']['lastPage'];
}

export function summarizeProject(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.details.name,
    clientName: p.details.clientName,
    designStage: p.details.designStage,
    revision: p.details.revision,
    updatedAt: p.meta.updatedAt,
    lastPage: p.meta.lastPage,
  };
}

const DISCIPLINE_OF_ROLE: Partial<Record<Role, Discipline>> = {
  ELECTRICAL_ENGINEER: 'electrical',
  MECHANICAL_ENGINEER: 'mechanical',
  PHE_ENGINEER: 'phe',
};

/**
 * Discipline layers this user may edit in this project (Section 2): the Technical Lead all of
 * them, an engineer their own layer when assigned to the project, everyone else none.
 */
export function editableDisciplines(
  user: UserSummary,
  project: Pick<Project, 'disciplines'>,
): Discipline[] {
  if (user.role === 'TECHNICAL_LEAD') return ['electrical', 'mechanical', 'phe'];
  const d = DISCIPLINE_OF_ROLE[user.role];
  return d && project.disciplines[d].includes(user.id) ? [d] : [];
}

/** Uploading and calibrating floor plans: the Technical Lead and the engineers of the project. */
export const canEditFloorPlans = (user: UserSummary, project: Pick<Project, 'disciplines'>) =>
  editableDisciplines(user, project).length > 0;

/** JSON with sorted keys, so two equal objects compare equal whatever their key order. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

/** Everything that only the Technical Lead may change: the project without model, plans and meta. */
function setupPart(p: Project) {
  const { model: _m, meta: _meta, version: _v, auditLog: _a, building, ...rest } = p;
  return {
    ...rest,
    building: { ...building, floors: building.floors.map(({ plan: _p, ...f }) => f) },
  };
}

/**
 * Checks a save by someone who is not the Technical Lead (Section 2): Project Set-up must be
 * unchanged, and every added, changed or removed component must be in one of their layers
 * (cables and risers belong to the electrical layer). Returns what was out of bounds, or null.
 */
export function outsideEditRights(
  user: UserSummary,
  before: Project,
  after: Project,
): string | null {
  const layers = new Set<Discipline>(editableDisciplines(user, before));
  if (layers.size === 0) return 'this project';
  if (stable(setupPart(before)) !== stable(setupPart(after))) return 'Project Set-up';
  const changed = <T extends { id: string }>(a: T[], b: T[]) => {
    const old = new Map(a.map((x) => [x.id, stable(x)]));
    const now = new Map(b.map((x) => [x.id, stable(x)]));
    return [...new Set([...old.keys(), ...now.keys()])].filter((id) => old.get(id) !== now.get(id));
  };
  const oldById = new Map(before.model.elements.map((e) => [e.id, e]));
  const newById = new Map(after.model.elements.map((e) => [e.id, e]));
  for (const id of changed(before.model.elements, after.model.elements)) {
    // Both the old and the new version must be in the user's layers (no moving between layers).
    for (const e of [oldById.get(id), newById.get(id)]) {
      if (e && !layers.has(e.discipline)) return `${e.tag} (${e.discipline})`;
    }
  }
  if (!layers.has('electrical') && changed(before.model.cables, after.model.cables).length > 0) {
    return 'cables (electrical)';
  }
  if (!layers.has('electrical') && changed(before.model.risers, after.model.risers).length > 0) {
    return 'risers (electrical)';
  }
  return null;
}
