import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashes for the user file (WBS 1.2.2), with Node's built-in scrypt.
 * Format: `scrypt$N$r$p$<salt base64url>$<hash base64url>`.
 */
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, opts, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  const { N, r, p } = PARAMS;
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** True when the password matches the stored hash; false for a wrong password or a bad hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const opts = { N: Number(n), r: Number(r), p: Number(p) };
  if (![opts.N, opts.r, opts.p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const key = await derive(password, Buffer.from(salt, 'base64url'), opts);
  return key.length === expected.length && timingSafeEqual(key, expected);
}
