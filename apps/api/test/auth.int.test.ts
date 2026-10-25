import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildTestApp, FakeClock, loginAsOperator, TEST_PASSWORD } from './helpers/app.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PUBLIC = new Set(['GET /api/health', 'POST /api/auth/login']);

const login = (
  app: Awaited<ReturnType<typeof buildTestApp>>['app'],
  password = TEST_PASSWORD,
  remoteAddress?: string,
  headers?: Record<string, string>,
) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password },
    ...(remoteAddress ? { remoteAddress } : {}),
    ...(headers ? { headers } : {}),
  });

describe('operator session (FR-20, TR-13)', () => {
  it('answers 401 on every registered /api route except health and login (AC3)', async () => {
    const routes: { method: string; url: string }[] = [];
    const { app } = await buildTestApp({
      overrides: { onRoute: ({ method, url }) => void routes.push({ method, url }) },
    });
    const protectedRoutes = routes.filter(
      (r) =>
        r.method !== 'HEAD' && r.url.startsWith('/api/') && !PUBLIC.has(`${r.method} ${r.url}`),
    );
    expect(protectedRoutes.length).toBeGreaterThan(0);
    for (const { method, url } of protectedRoutes) {
      const path = url.replace(/:\w+/g, 'x');
      for (const headers of [{}, { cookie: 'lh_session=made-up' }]) {
        const res = await app.inject({ method: method as 'GET', url: path, headers });
        expect(res.statusCode, `${method} ${url}`).toBe(401);
        expect(res.json()).toEqual({ error: 'unauthorized' });
      }
    }
  });

  it('does not let an escaped URL slip past the guard', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject('/%61pi/auth/session');
    expect(res.statusCode).toBe(401);
  });

  it('logs in with a HttpOnly, SameSite=Strict cookie and accepts it (AC4)', async () => {
    const { app } = await buildTestApp();
    const res = await login(app);
    expect(res.statusCode).toBe(204);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^lh_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=2592000/);
    expect(setCookie).not.toMatch(/Secure/i);

    const session = await app.inject({
      url: '/api/auth/session',
      headers: { cookie: await loginAsOperator(app) },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ authenticated: true });
  });

  it('sets Secure only behind a loopback proxy that forwards https (D-6)', async () => {
    const { app } = await buildTestApp();
    const https = { 'x-forwarded-proto': 'https' };
    expect(
      String((await login(app, TEST_PASSWORD, '127.0.0.1', https)).headers['set-cookie']),
    ).toMatch(/Secure/i);
    expect(
      String((await login(app, TEST_PASSWORD, '10.0.0.5', https)).headers['set-cookie']),
    ).not.toMatch(/Secure/i);
  });

  it('invalidates the cookie on logout (AC4)', async () => {
    const { app } = await buildTestApp();
    const cookie = await loginAsOperator(app);
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    const after = await app.inject({ url: '/api/auth/session', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('throttles to 5 attempts per 15 minutes, even with the right password (AC4)', async () => {
    const { app } = await buildTestApp();
    for (let i = 0; i < 5; i++) {
      const res = await login(app, 'wrong password');
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'invalid_password' });
    }
    const res = await login(app);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.json()).toEqual({
      error: 'too_many_attempts',
      retryAfterSeconds: Number(res.headers['retry-after']),
    });
  });

  it('expires a session after 30 days idle, not before (D-3)', async () => {
    const clock = new FakeClock();
    const { app } = await buildTestApp({ clock });
    const kept = await loginAsOperator(app);
    clock.advance(29 * DAY_MS);
    expect(
      (await app.inject({ url: '/api/auth/session', headers: { cookie: kept } })).statusCode,
    ).toBe(200);
    clock.advance(29 * DAY_MS);
    expect(
      (await app.inject({ url: '/api/auth/session', headers: { cookie: kept } })).statusCode,
    ).toBe(200);

    const idle = await loginAsOperator(app);
    clock.advance(30 * DAY_MS);
    expect(
      (await app.inject({ url: '/api/auth/session', headers: { cookie: idle } })).statusCode,
    ).toBe(401);
  });

  it('keeps several devices logged in at once', async () => {
    const { app } = await buildTestApp();
    const phone = await loginAsOperator(app);
    const laptop = await loginAsOperator(app);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: phone } });
    expect(
      (await app.inject({ url: '/api/auth/session', headers: { cookie: laptop } })).statusCode,
    ).toBe(200);
  });

  it('disables login without a configured hash (D-2)', async () => {
    const { app } = await buildTestApp({ noPassword: true });
    const res = await login(app);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'auth_not_configured' });
    expect((await app.inject('/api/auth/session')).statusCode).toBe(401);
  });

  it('stores only a hash of the token (D-3)', async () => {
    const { app, dir } = await buildTestApp();
    const cookie = await loginAsOperator(app);
    const token = cookie.split('=')[1] ?? '';
    const { default: Database } = await import('better-sqlite3');
    const sqlite = new Database(`${dir}/lead-hunter.db`, { readonly: true });
    const rows = sqlite.prepare('SELECT token_hash FROM sessions').all() as {
      token_hash: string;
    }[];
    sqlite.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).not.toBe(token);
    expect(rows[0]?.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
  });
});
