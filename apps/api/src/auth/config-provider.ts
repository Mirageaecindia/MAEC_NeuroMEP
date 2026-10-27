import { readFileSync } from 'node:fs';
import { RoleSchema, type UserSummary } from '@neuromep/shared';
import { z } from 'zod';
import { hashPassword, verifyPassword } from './passwords.js';
import type { AuthProvider } from './provider.js';

/** One entry of the user file (prototype user store, 26 Oct: config file, no users collection). */
const StoredUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.email(),
  role: RoleSchema,
  passwordHash: z.string().startsWith('scrypt$'),
});
export type StoredUser = z.infer<typeof StoredUserSchema>;

const UsersFileSchema = z
  .object({ users: z.array(StoredUserSchema).min(1) })
  .refine((f) => new Set(f.users.map((u) => u.email.toLowerCase())).size === f.users.length, {
    message: 'Each email may appear only once.',
  })
  .refine((f) => new Set(f.users.map((u) => u.id)).size === f.users.length, {
    message: 'Each id may appear only once.',
  });

/** Reads and checks the user file; throws with the file name and the problem. */
export function loadUsersFile(path: string): StoredUser[] {
  let raw: unknown;
  try {
    // The path comes from the server configuration (USERS_FILE), never from a request.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`User file ${path} cannot be read: ${(e as Error).message}`, { cause: e });
  }
  const parsed = UsersFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`User file ${path} is not valid: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data.users;
}

const summary = ({ id, name, email, role }: StoredUser): UserSummary => ({ id, name, email, role });

/** Users from the server-side user file, passwords checked against their scrypt hashes. */
export class ConfigAuthProvider implements AuthProvider {
  /** Compared against when the email is unknown, so both cases take the same time. */
  private readonly dummyHash: Promise<string>;

  constructor(private readonly users: readonly StoredUser[]) {
    this.dummyHash = hashPassword('neuromep-timing-equaliser');
  }

  async authenticate(email: string, password: string) {
    const key = email.trim().toLowerCase();
    const user = this.users.find((u) => u.email.toLowerCase() === key);
    const ok = await verifyPassword(password, user?.passwordHash ?? (await this.dummyHash));
    return user && ok ? summary(user) : null;
  }

  async findUser(id: string) {
    const user = this.users.find((u) => u.id === id);
    return user ? summary(user) : null;
  }

  async listUsers() {
    return this.users.map(summary);
  }
}
