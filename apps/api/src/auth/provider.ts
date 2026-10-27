import type { UserSummary } from '@neuromep/shared';

/**
 * Who the users are and how their password is checked, behind an interface so the provider can be
 * swapped when the company login is decided (MAEC One unified login, OI-28). Sessions are kept
 * separately (SessionStore), so a new provider only answers these questions.
 */
export interface AuthProvider {
  /** The user for these credentials, or null (the caller never says which part was wrong). */
  authenticate(email: string, password: string): Promise<UserSummary | null>;
  /** A user by id, or null when the account no longer exists. */
  findUser(id: string): Promise<UserSummary | null>;
  /** Users that can be assigned to projects. */
  listUsers(): Promise<UserSummary[]>;
}
