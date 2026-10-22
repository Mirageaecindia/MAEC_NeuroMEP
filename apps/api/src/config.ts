import { z } from 'zod';

const EnvSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  /** Unset in development: an in-process MongoDB is started (data kept in DATA_DIR). */
  MONGODB_URI: z.string().optional(),
  MONGODB_DB: z.string().default('neuromep'),
  /** Authentication provider; only "dev" exists until OI-28 is decided. */
  AUTH_PROVIDER: z.enum(['dev']).default('dev'),
  /** Secret for signing session tokens. Required outside development. */
  AUTH_SECRET: z.string().optional(),
  DATA_DIR: z.string().default('.data'),
  NODE_ENV: z.string().default('development'),
});

export type Config = z.infer<typeof EnvSchema> & { authSecret: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  const isDev = parsed.NODE_ENV !== 'production';
  if (!parsed.AUTH_SECRET && !isDev) throw new Error('AUTH_SECRET must be set in production.');
  if (!parsed.MONGODB_URI && !isDev) throw new Error('MONGODB_URI must be set in production.');
  return { ...parsed, authSecret: parsed.AUTH_SECRET ?? 'neuromep-development-only-secret' };
}
