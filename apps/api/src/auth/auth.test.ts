import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_USERS_FILE } from '../config.js';
import { LoginLimiter } from './attempts.js';
import { ConfigAuthProvider, loadUsersFile } from './config-provider.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { MemorySessionStore } from './sessions.js';

describe('#TASK-01 password hashes (WBS 1.2.2)', () => {
  it('hashes with a random salt and verifies only the right password', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('correct horse batterz', a)).toBe(false);
  });

  it('treats a malformed hash as a wrong password', async () => {
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$0$8$1$abc$def')).toBe(false);
  });
});

describe('#TASK-01 user file', () => {
  const write = (content: unknown) => {
    const file = join(mkdtempSync(join(tmpdir(), 'neuromep-users-')), 'users.json');
    writeFileSync(file, JSON.stringify(content));
    return file;
  };

  it('the development file has one user per role, all with hashed passwords', () => {
    const users = loadUsersFile(DEV_USERS_FILE);
    expect(new Set(users.map((u) => u.role)).size).toBe(6);
    expect(users.every((u) => u.passwordHash.startsWith('scrypt$'))).toBe(true);
  });

  it('rejects plain-text passwords, unknown roles and duplicate emails', () => {
    const user = {
      id: 'u-1',
      name: 'A',
      email: 'a@x.dev',
      role: 'TECHNICAL_LEAD',
      passwordHash: 'scrypt$16384$8$1$s$h',
    };
    expect(() => loadUsersFile(write({ users: [{ ...user, passwordHash: 'secret' }] }))).toThrow(
      /not valid/,
    );
    expect(() => loadUsersFile(write({ users: [{ ...user, role: 'OWNER' }] }))).toThrow(
      /not valid/,
    );
    expect(() =>
      loadUsersFile(write({ users: [user, { ...user, id: 'u-2', email: 'A@x.dev' }] })),
    ).toThrow(/Each email may appear only once/);
    expect(() => loadUsersFile(join(tmpdir(), 'missing-neuromep-users.json'))).toThrow(
      /cannot be read/,
    );
  });

  it('authenticates by email (any case) and never returns the hash', async () => {
    const auth = new ConfigAuthProvider([
      {
        id: 'u-1',
        name: 'A',
        email: 'a@x.dev',
        role: 'CHECKER',
        passwordHash: await hashPassword('right-password'),
      },
    ]);
    expect(await auth.authenticate(' A@X.dev ', 'right-password')).toEqual({
      id: 'u-1',
      name: 'A',
      email: 'a@x.dev',
      role: 'CHECKER',
    });
    expect(await auth.authenticate('a@x.dev', 'wrong')).toBeNull();
    expect(await auth.authenticate('b@x.dev', 'right-password')).toBeNull();
    expect(await auth.findUser('u-2')).toBeNull();
  });
});

describe('#TASK-01 login attempt limit and sessions', () => {
  it('locks after the maximum failures in the window and unlocks when it has passed', () => {
    let t = 0;
    const limiter = new LoginLimiter(3, 1000, () => t);
    limiter.fail('k');
    limiter.fail('k');
    expect(limiter.isLocked('k')).toBe(false);
    limiter.fail('k');
    expect(limiter.isLocked('k')).toBe(true);
    t = 1001;
    expect(limiter.isLocked('k')).toBe(false);
    limiter.fail('k');
    limiter.clear('k');
    expect(limiter.isLocked('k')).toBe(false);
  });

  it('sessions expire and can be deleted', async () => {
    let t = 0;
    const store = new MemorySessionStore(() => t);
    const a = await store.create('u-1');
    expect(await store.get(a.token)).toMatchObject({ userId: 'u-1' });
    await store.delete(a.token);
    expect(await store.get(a.token)).toBeNull();
    const b = await store.create('u-1');
    t = 12 * 3600_000;
    expect(await store.get(b.token)).toBeNull();
  });
});
