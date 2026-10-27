import type { UserSummary } from '@neuromep/shared';
import { ApiError, type ApiClient } from '../api/client';

/**
 * Authentication behind an interface so the provider can be swapped when the company login is
 * decided (MAEC One unified login, OI-28).
 */
export interface AuthProvider {
  /** Throws an Error with a plain-language message on failure. */
  signIn(email: string, password: string): Promise<UserSummary>;
  signOut(): Promise<void>;
  /** The signed-in user, or null (also after the session expired). */
  getCurrentUser(): Promise<UserSummary | null>;
}

/**
 * Signs in against apps/api. The session lives in an httpOnly cookie set by the server (WBS
 * 1.2.2), so the browser code never sees or stores a token.
 */
export class HttpAuthProvider implements AuthProvider {
  constructor(private readonly api: ApiClient) {}

  async signIn(email: string, password: string) {
    try {
      return (await this.api.signIn(email, password)).user;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        throw new Error('Email or password is incorrect.', { cause: e });
      }
      throw new Error(e instanceof ApiError ? e.message : 'Sign-in failed. Please try again.', {
        cause: e,
      });
    }
  }

  async signOut() {
    try {
      await this.api.signOut();
    } catch {
      // Signed out locally either way; the server session expires on its own.
    }
  }

  async getCurrentUser() {
    try {
      return (await this.api.me()).user;
    } catch {
      return null;
    }
  }
}
