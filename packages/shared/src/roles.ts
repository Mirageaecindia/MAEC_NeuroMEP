import { z } from 'zod';

/** User roles, design doc Section 2. */
export const RoleSchema = z.enum([
  'TECHNICAL_LEAD',
  'ELECTRICAL_ENGINEER',
  'MECHANICAL_ENGINEER',
  'PHE_ENGINEER',
  'CHECKER',
  'SYSTEM_ADMINISTRATOR',
]);
export type Role = z.infer<typeof RoleSchema>;

export const ROLE_LABELS: Record<Role, string> = {
  TECHNICAL_LEAD: 'Technical Lead',
  ELECTRICAL_ENGINEER: 'Electrical Engineer',
  MECHANICAL_ENGINEER: 'Mechanical Engineer',
  PHE_ENGINEER: 'PHE Engineer',
  CHECKER: 'Checker',
  SYSTEM_ADMINISTRATOR: 'System Administrator',
};
