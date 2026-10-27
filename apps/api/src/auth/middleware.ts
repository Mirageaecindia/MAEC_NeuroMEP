import type { UserSummary } from '@neuromep/shared';
import type { NextFunction, Request, Response } from 'express';
import { sendError } from '../errors.js';
import type { AuthProvider } from './provider.js';
import type { SessionStore } from './sessions.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserSummary;
  }
}

export const SESSION_COOKIE = 'neuromep_session';

/** The session token from the Cookie header, or ''. */
export function sessionToken(req: Request): string {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim();
  }
  return '';
}

/** httpOnly, SameSite=Strict session cookie; Secure outside development (HTTPS on the VPS). */
export function sessionCookie(token: string, expiresAt: Date | null, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    ...(secure ? ['Secure'] : []),
    expiresAt ? `Expires=${expiresAt.toUTCString()}` : 'Max-Age=0',
  ].join('; ');
}

/** Rejects requests without a live session (401 E0102). */
export function requireUser(auth: AuthProvider, sessions: SessionStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = sessionToken(req);
    const session = token ? await sessions.get(token) : null;
    const user = session ? await auth.findUser(session.userId) : null;
    if (!user) {
      sendError(res, 401, 'E0102');
      return;
    }
    req.user = user;
    next();
  };
}

/** The signed-in user; only valid after requireUser. */
export function currentUser(req: Request): UserSummary {
  if (!req.user) throw new Error('requireUser must run before this handler');
  return req.user;
}
