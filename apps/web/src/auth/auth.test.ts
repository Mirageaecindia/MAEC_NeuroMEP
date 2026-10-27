import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/client';
import { HttpAuthProvider } from './AuthProvider';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('#TASK-01 cookie session in the browser (WBS 1.2.2)', () => {
  it('sends the session cookie and never an Authorization header or stored token', async () => {
    const fetchMock = vi.fn(async () => json(200, { user: { id: 'u-lead' } }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = new HttpAuthProvider(new ApiClient());
    await auth.signIn('lead@neuromep.dev', 'pw');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).not.toHaveProperty('authorization');
    expect(localStorage.length).toBe(0);
  });

  it('reports an ended session on data requests, not on the sign-in calls', async () => {
    vi.stubGlobal('fetch', async () => json(401, { code: 'E0102', error: 'Please sign in.' }));
    const api = new ApiClient();
    const ended = vi.fn();
    api.setUnauthorizedHandler(ended);
    await expect(api.me()).rejects.toThrow();
    expect(ended).not.toHaveBeenCalled();
    await expect(api.listProjects()).rejects.toThrow('Please sign in (E0102)');
    expect(ended).toHaveBeenCalledOnce();
  });

  it('Sign Out ends the server session', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await new HttpAuthProvider(new ApiClient()).signOut();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/sign-out',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows the attempt-limit message with its code', async () => {
    vi.stubGlobal('fetch', async () =>
      json(429, {
        code: 'E0103',
        error: 'Too many sign-in attempts. Try again in a few minutes.',
      }),
    );
    await expect(new HttpAuthProvider(new ApiClient()).signIn('a@x.dev', 'pw')).rejects.toThrow(
      'Too many sign-in attempts. Try again in a few minutes (E0103)',
    );
  });
});
