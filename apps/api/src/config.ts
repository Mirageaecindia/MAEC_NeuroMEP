import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Seeded development users (password `neuromep-dev`); never used in production. */
export const DEV_USERS_FILE = fileURLToPath(new URL('../config/users.dev.json', import.meta.url));

const EnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  /** Unset in development: an in-process MongoDB is started (data kept in DATA_DIR). */
  MONGODB_URI: z.string().optional(),
  MONGODB_DB: z.string().default('neuromep'),
  /** Authentication provider; "config" (user file) until OI-28 decides the company login. */
  AUTH_PROVIDER: z.enum(['config']).default('config'),
  /** User file with password hashes (`npm run hash-password -w @neuromep/api`). Required in production. */
  USERS_FILE: z.string().optional(),
  DATA_DIR: z.string().default('.data'),
  NODE_ENV: z.string().default('development'),
});

export type Config = z.infer<typeof EnvSchema> & { usersFile: string; production: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  const production = parsed.NODE_ENV === 'production';
  if (!parsed.USERS_FILE && production) throw new Error('USERS_FILE must be set in production.');
  if (!parsed.MONGODB_URI && production) throw new Error('MONGODB_URI must be set in production.');
  return { ...parsed, usersFile: parsed.USERS_FILE ?? DEV_USERS_FILE, production };
}
