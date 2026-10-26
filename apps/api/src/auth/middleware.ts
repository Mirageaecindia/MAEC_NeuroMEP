import type { UserSummary } from '@neuromep/shared';
import type { NextFunction, Request, Response } from 'express';
import { sendError } from '../errors.js';
import type { AuthProvider } from './provider.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserSummary;
  }
}

/** Rejects requests without a valid session token (401). */
export function requireUser(auth: AuthProvider) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const user = token ? await auth.verify(token) : null;
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
