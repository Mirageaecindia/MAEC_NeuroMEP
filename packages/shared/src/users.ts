import { z } from 'zod';
import { RoleSchema } from './roles.js';

/** A signed-in user or an entry in the user directory (no secrets). */
export const UserSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.email(),
  role: RoleSchema,
});
export type UserSummary = z.infer<typeof UserSummarySchema>;

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
