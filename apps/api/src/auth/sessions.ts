import { createHash, randomBytes } from 'node:crypto';
import type { Collection, Db } from 'mongodb';

export const SESSION_HOURS = 12;

export interface Session {
  userId: string;
  expiresAt: Date;
}

/**
 * Server-side sessions (WBS 1.2.2): the browser holds a random token in an httpOnly cookie; only
 * its SHA-256 is stored, so a database copy cannot be replayed. Sign Out deletes the session.
 */
export interface SessionStore {
  /** Starts a session and returns the token for the cookie. */
  create(userId: string): Promise<{ token: string; expiresAt: Date }>;
  /** The live session for a token, or null (unknown or expired). */
  get(token: string): Promise<Session | null>;
  delete(token: string): Promise<void>;
}

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

interface SessionDoc {
  _id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

/** `sessions` collection; MongoDB removes expired documents through a TTL index. */
export class MongoSessionStore implements SessionStore {
  private readonly sessions: Collection<SessionDoc>;

  constructor(
    db: Db,
    private readonly now: () => number = Date.now,
  ) {
    this.sessions = db.collection<SessionDoc>('sessions');
  }

  async init() {
    await this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }

  async create(userId: string) {
    const token = newToken();
    const createdAt = new Date(this.now());
    const expiresAt = new Date(this.now() + SESSION_HOURS * 3600_000);
    await this.sessions.insertOne({ _id: digest(token), userId, createdAt, expiresAt });
    return { token, expiresAt };
  }

  async get(token: string) {
    const doc = await this.sessions.findOne({ _id: digest(token) });
    // The TTL monitor runs about once a minute, so expiry is also checked here.
    if (!doc || doc.expiresAt.getTime() <= this.now()) return null;
    return { userId: doc.userId, expiresAt: doc.expiresAt };
  }

  async delete(token: string) {
    await this.sessions.deleteOne({ _id: digest(token) });
  }
}

/** In-memory sessions for tests. */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly now: () => number = Date.now) {}

  async create(userId: string) {
    const token = newToken();
    const expiresAt = new Date(this.now() + SESSION_HOURS * 3600_000);
    this.sessions.set(digest(token), { userId, expiresAt });
    return { token, expiresAt };
  }

  async get(token: string) {
    const s = this.sessions.get(digest(token));
    return s && s.expiresAt.getTime() > this.now() ? s : null;
  }

  async delete(token: string) {
    this.sessions.delete(digest(token));
  }
}
