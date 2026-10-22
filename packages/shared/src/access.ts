import type { Project } from './project/schema.js';
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
