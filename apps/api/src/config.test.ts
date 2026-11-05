import { describe, expect, it } from 'vitest';
import { DEV_USERS_FILE, loadConfig } from './config.js';

const PRODUCTION = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb://db:27017/?replicaSet=rs0',
  USERS_FILE: '/run/neuromep/users.json',
};

describe('API configuration (Docker deployment)', () => {
  it('development: dev users, in-process MongoDB, plain cookies, loopback proxy', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      production: false,
      usersFile: DEV_USERS_FILE,
      secureCookies: false,
      TRUST_PROXY: 'loopback',
      API_PORT: 4000,
    });
    expect(c.plansDir.split('\\').join('/')).toBe('.data/plans');
  });

  it('production needs a user file and MongoDB, and sends Secure cookies by default', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/USERS_FILE/);
    expect(() =>
      loadConfig({ NODE_ENV: 'production', USERS_FILE: '/run/neuromep/users.json' }),
    ).toThrow(/MONGODB_URI/);
    expect(loadConfig(PRODUCTION)).toMatchObject({ production: true, secureCookies: true });
  });

  it('takes the trusted proxies and the cookie flag from the environment', () => {
    expect(
      loadConfig({ ...PRODUCTION, TRUST_PROXY: 'loopback,uniquelocal', COOKIE_SECURE: 'false' }),
    ).toMatchObject({ TRUST_PROXY: 'loopback,uniquelocal', secureCookies: false });
    expect(() => loadConfig({ ...PRODUCTION, COOKIE_SECURE: 'no' })).toThrow();
  });
});
