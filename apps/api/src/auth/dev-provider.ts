import { createHmac, timingSafeEqual } from 'node:crypto';
import type { UserSummary } from '@neuromep/shared';
import type { AuthProvider } from './provider.js';

/** Shared password of the seeded development users. Development only. */
export const DEV_PASSWORD = 'neuromep-dev';

/** One seeded user per role of design doc Section 2 (plus a second Electrical engineer). */
export const DEV_USERS: readonly UserSummary[] = [
  { id: 'u-lead', name: 'Alex Morgan', email: 'lead@neuromep.dev', role: 'TECHNICAL_LEAD' },
  {
    id: 'u-elec',
    name: 'Sam Patel',
    email: 'electrical@neuromep.dev',
    role: 'ELECTRICAL_ENGINEER',
  },
  {
    id: 'u-elec2',
    name: 'Priya Nair',
    email: 'electrical2@neuromep.dev',
    role: 'ELECTRICAL_ENGINEER',
  },
  {
    id: 'u-mech',
    name: 'Jordan Lee',
    email: 'mechanical@neuromep.dev',
    role: 'MECHANICAL_ENGINEER',
  },
  { id: 'u-phe', name: 'Rana Haddad', email: 'phe@neuromep.dev', role: 'PHE_ENGINEER' },
  { id: 'u-check', name: 'Noor Khan', email: 'checker@neuromep.dev', role: 'CHECKER' },
  { id: 'u-admin', name: 'Dana Smith', email: 'admin@neuromep.dev', role: 'SYSTEM_ADMINISTRATOR' },
];

const SESSION_HOURS = 12;

/** Seeded users and HMAC-signed, stateless session tokens (survive API restarts). */
export class DevAuthProvider implements AuthProvider {
  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {}

  async signIn(email: string, password: string) {
    const user = DEV_USERS.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || password !== DEV_PASSWORD) return null;
    const payload = Buffer.from(
      JSON.stringify({ sub: user.id, exp: this.now() + SESSION_HOURS * 3600_000 }),
    ).toString('base64url');
    return { token: `${payload}.${this.sign(payload)}`, user };
  }

  async verify(token: string) {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
        sub: string;
        exp: number;
      };
      if (exp < this.now()) return null;
      return DEV_USERS.find((u) => u.id === sub) ?? null;
    } catch {
      return null;
    }
  }

  async listUsers() {
    return [...DEV_USERS];
  }

  private sign(payload: string) {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}
