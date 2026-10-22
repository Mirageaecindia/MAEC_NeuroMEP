import type { UserSummary } from '@neuromep/shared';

/**
 * Authentication behind an interface so the provider can be swapped when the company login is
 * decided (MAEC One unified login, OI-28).
 */
export interface AuthProvider {
  /** Returns a session token and the user, or null for wrong credentials (never says which). */
  signIn(email: string, password: string): Promise<{ token: string; user: UserSummary } | null>;
  /** The user a token belongs to, or null if it is invalid or expired. */
  verify(token: string): Promise<UserSummary | null>;
  /** Users that can be assigned to projects. */
  listUsers(): Promise<UserSummary[]>;
}
