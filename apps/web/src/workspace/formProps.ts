import type { Project, UserSummary } from '@neuromep/shared';
import type { AuditMeta, ProjectAction } from './projectReducer';

export interface CardProps {
  project: Project;
  dispatch: (action: ProjectAction) => void;
  readOnly: boolean;
  user: UserSummary;
  /** Validation message for a field, once the user has left it or pressed Next. */
  errorFor: (field: string) => string | null;
  touch: (field: string) => void;
}

export const newAudit = (user: UserSummary): AuditMeta => ({
  id: crypto.randomUUID(),
  at: new Date().toISOString(),
  userId: user.id,
});
