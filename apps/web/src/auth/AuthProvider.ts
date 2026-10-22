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
  /** Token for API calls, or null. */
  getToken(): string | null;
}

const STORAGE_KEY = 'neuromep.session';

/** Signs in against apps/api (dev provider there today) and keeps the session across reloads. */
export class HttpAuthProvider implements AuthProvider {
  private api: ApiClient | null = null;

  constructor(private readonly storage: Storage = window.localStorage) {}

  /** The client needs the token and the provider needs the client; wired after construction. */
  attach(api: ApiClient) {
    this.api = api;
  }

  getToken() {
    return this.storage.getItem(STORAGE_KEY);
  }

  async signIn(email: string, password: string) {
    try {
      const { token, user } = await this.client().signIn(email, password);
      this.storage.setItem(STORAGE_KEY, token);
      return user;
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
    this.storage.removeItem(STORAGE_KEY);
  }

  async getCurrentUser() {
    if (!this.getToken()) return null;
    try {
      return (await this.client().me()).user;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.storage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  private client() {
    if (!this.api) throw new Error('HttpAuthProvider.attach() was not called');
    return this.api;
  }
}
