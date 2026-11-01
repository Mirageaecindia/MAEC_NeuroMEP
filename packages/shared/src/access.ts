import { DisciplineSchema, type Discipline } from './model/elements.js';
import { stable } from './stable.js';
import { isFlagged, type FloorFlag } from './model/floorFlags.js';
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

/** Ids of the items added, changed or removed between two lists. */
function changed<T extends { id: string }>(a: readonly T[], b: readonly T[]): string[] {
  const old = new Map(a.map((x) => [x.id, stable(x)]));
  const now = new Map(b.map((x) => [x.id, stable(x)]));
  return [...new Set([...old.keys(), ...now.keys()])].filter((id) => old.get(id) !== now.get(id));
}

const flagKey = (f: FloorFlag) => `${f.floorId}:${f.discipline}`;

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
  if (!layers.has('electrical') && stable(before.model.results) !== stable(after.model.results)) {
    return 'Cable Size results (electrical)';
  }
  // Floor flags (A-08): engineers flag their own layer; only the Technical Lead reopens.
  const oldFlags = new Set(before.model.floorFlags.map(flagKey));
  const newFlags = new Set(after.model.floorFlags.map(flagKey));
  if ([...oldFlags].some((k) => !newFlags.has(k))) return 'floor flags (only the Lead reopens)';
  const added = after.model.floorFlags.find((f) => !oldFlags.has(flagKey(f)));
  if (added && !layers.has(added.discipline)) return `floor flag (${added.discipline})`;
  return null;
}

/**
 * A change to a floor flagged done (A-08, E1003), for every user including the Technical Lead:
 * the floor stays locked until it is reopened (flagged before and after the save). Components
 * and cables of the flagged discipline and the floor plan are locked. Returns what changed.
 */
export function lockedChange(before: Project, after: Project): string | null {
  const locked = (floorId: string, d: Discipline) =>
    isFlagged(before.model.floorFlags, floorId, d) && isFlagged(after.model.floorFlags, floorId, d);
  const name = (floorId: string) =>
    after.building.floors.find((f) => f.id === floorId)?.name ?? floorId;
  const items = <T extends { id: string; floorId: string }>(
    a: readonly T[],
    b: readonly T[],
    discipline: (x: T) => Discipline,
    label: (x: T) => string,
  ) => {
    const old = new Map(a.map((x) => [x.id, x]));
    const now = new Map(b.map((x) => [x.id, x]));
    for (const id of changed(a, b)) {
      for (const x of [old.get(id), now.get(id)]) {
        if (x && locked(x.floorId, discipline(x))) return `${label(x)} (${name(x.floorId)})`;
      }
    }
    return null;
  };
  const element = items(
    before.model.elements,
    after.model.elements,
    (e) => e.discipline,
    (e) => e.tag,
  );
  if (element) return element;
  const cable = items(
    before.model.cables,
    after.model.cables,
    () => 'electrical',
    (c) => c.tag,
  );
  if (cable) return cable;
  for (const f of after.building.floors) {
    const old = before.building.floors.find((x) => x.id === f.id);
    const anyFlag = DisciplineSchema.options.some((d) => locked(f.id, d));
    if (old && anyFlag && stable(old.plan) !== stable(f.plan)) return `${f.name} plan`;
  }
  return null;
}
