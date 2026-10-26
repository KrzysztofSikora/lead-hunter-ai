import { describe, expect, it } from 'vitest';
import { HttpFetchError, type HttpClient } from '../http/client.js';
import {
  createGithubApi,
  GITHUB_GAP_ANONYMOUS_MS,
  GITHUB_GAP_TOKEN_MS,
  GITHUB_MAX_WAIT_MS,
} from './api.js';

interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  error?: Error;
}

function setup(
  replies: Reply[],
  opts: { token?: string; sleep?: (ms: number) => Promise<void> } = {},
) {
  const state = {
    now: Date.UTC(2026, 9, 26, 12),
    sleeps: [] as number[],
    calls: [] as { url: string; at: number; headers: Record<string, string> | undefined }[],
  };
  const http: HttpClient = {
    async get(url, options) {
      state.calls.push({ url, at: state.now, headers: options.headers });
      expect(options.accept).toBe('application/vnd.github+json');
      const reply = replies[Math.min(state.calls.length - 1, replies.length - 1)]!;
      if (reply.error) throw reply.error;
      return {
        status: reply.status ?? 200,
        headers: reply.headers ?? {},
        body: new TextEncoder().encode(reply.body ?? '{}'),
        url,
      };
    },
    async post() {
      throw new Error('GitHub does not POST');
    },
  };
  const api = createGithubApi({
    http,
    clock: { now: () => new Date(state.now) },
    timeoutMs: 1_000,
    maxAttempts: 3,
    sleep: async (ms) => {
      state.sleeps.push(ms);
      state.now += ms;
    },
    ...opts,
  });
  return { api, state };
}

describe('createGithubApi', () => {
  it('sends the version header, and the token only when one is set', async () => {
    const anonymous = setup([{}]);
    await anonymous.api.get('/search/issues?q=x');
    expect(anonymous.state.calls[0]?.url).toBe('https://api.github.com/search/issues?q=x');
    expect(anonymous.state.calls[0]?.headers).toEqual({ 'x-github-api-version': '2022-11-28' });

    const withToken = setup([{}], { token: 'TOKEN-LEAK-CANARY' });
    await withToken.api.get('/x');
    expect(withToken.state.calls[0]?.headers?.authorization).toBe('Bearer TOKEN-LEAK-CANARY');
  });

  it('spaces any two requests: 6 100 ms anonymous, 2 100 ms with a token', async () => {
    const anonymous = setup([{}]);
    await anonymous.api.get('/a');
    await anonymous.api.get('/b');
    await anonymous.api.get('/c');
    expect(anonymous.state.sleeps).toEqual([GITHUB_GAP_ANONYMOUS_MS, GITHUB_GAP_ANONYMOUS_MS]);
    expect(anonymous.state.calls.map((c) => c.at)).toEqual(
      [0, GITHUB_GAP_ANONYMOUS_MS, 2 * GITHUB_GAP_ANONYMOUS_MS].map(
        (n) => n + Date.UTC(2026, 9, 26, 12),
      ),
    );

    const token = setup([{}], { token: 't' });
    await token.api.get('/a');
    await token.api.get('/b');
    expect(token.state.sleeps).toEqual([GITHUB_GAP_TOKEN_MS]);
  });

  it('queues concurrent callers behind each other instead of sending back to back (R4)', async () => {
    // A sleep that leaves the clock alone: every caller is waiting at the same moment.
    const waits: number[] = [];
    const { api } = setup([{}], { sleep: async (ms) => void waits.push(ms) });
    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(waits).toEqual([GITHUB_GAP_ANONYMOUS_MS, 2 * GITHUB_GAP_ANONYMOUS_MS]);
  });

  it('parses JSON; a body that is not JSON is invalid_feed', async () => {
    expect(await setup([{ body: '{"a":1}' }]).api.get('/x')).toEqual({ ok: true, json: { a: 1 } });
    expect(await setup([{ body: '<html>' }]).api.get('/x')).toEqual({
      ok: false,
      reason: 'invalid_feed',
    });
  });

  it.each([403, 429])(
    'maps a primary limit (%i) to rate_limited with the reset time',
    async (status) => {
      const { api, state } = setup([
        {
          status,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Date.UTC(2026, 9, 26, 12, 0, 30) / 1000),
          },
        },
      ]);
      expect(await api.get('/x')).toEqual({
        ok: false,
        reason: 'rate_limited',
        httpStatus: status,
        retryAfterMs: 30_000,
      });
      expect(state.calls).toHaveLength(1);
    },
  );

  it('bounds the reset time at one hour and at zero', async () => {
    const far = setup([
      {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '99999999999' },
      },
    ]);
    expect(await far.api.get('/x')).toMatchObject({ retryAfterMs: GITHUB_MAX_WAIT_MS });
    const past = setup([
      { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' } },
    ]);
    expect(await past.api.get('/x')).toMatchObject({ retryAfterMs: 0 });
    const junk = setup([
      { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'soon' } },
    ]);
    expect(await junk.api.get('/x')).toEqual({
      ok: false,
      reason: 'rate_limited',
      httpStatus: 403,
    });
  });

  it('maps a secondary 403 with retry-after to rate_limited, bounded', async () => {
    const { api, state } = setup([{ status: 403, headers: { 'retry-after': '90' } }]);
    expect(await api.get('/x')).toEqual({
      ok: false,
      reason: 'rate_limited',
      httpStatus: 403,
      retryAfterMs: 90_000,
    });
    expect(state.calls).toHaveLength(1);
    const huge = setup([{ status: 403, headers: { 'retry-after': '999999' } }]);
    expect(await huge.api.get('/x')).toMatchObject({ retryAfterMs: GITHUB_MAX_WAIT_MS });
  });

  it('retries a 429 with retry-after and no remaining 0 once, then gets the 200', async () => {
    const { api, state } = setup([
      { status: 429, headers: { 'retry-after': '5' } },
      { body: '{"ok":true}' },
    ]);
    expect(await api.get('/x')).toEqual({ ok: true, json: { ok: true } });
    expect(state.calls).toHaveLength(2);
    expect(state.sleeps).toContain(5_000);
  });

  it('gives up a 429 whose wait is over the cap, or after the last attempt', async () => {
    const over = setup([{ status: 429, headers: { 'retry-after': '3600' } }]);
    expect(await over.api.get('/x')).toMatchObject({
      ok: false,
      reason: 'rate_limited',
      httpStatus: 429,
    });
    expect(over.state.calls).toHaveLength(1);
    const always = setup([{ status: 429 }]);
    expect(await always.api.get('/x')).toMatchObject({ reason: 'rate_limited', httpStatus: 429 });
    expect(always.state.calls).toHaveLength(3);
  });

  it('backs off a 503 and then reports rate_limited', async () => {
    const recovers = setup([{ status: 503 }, { body: '[]' }]);
    expect(await recovers.api.get('/x')).toEqual({ ok: true, json: [] });
    const never = setup([{ status: 503 }]);
    expect(await never.api.get('/x')).toEqual({
      ok: false,
      reason: 'rate_limited',
      httpStatus: 503,
    });
    expect(never.state.calls).toHaveLength(3);
  });

  it('keeps any other 403 and non-2xx as http_status', async () => {
    expect(await setup([{ status: 403 }]).api.get('/x')).toEqual({
      ok: false,
      reason: 'http_status',
      httpStatus: 403,
    });
    expect(await setup([{ status: 404 }]).api.get('/x')).toEqual({
      ok: false,
      reason: 'http_status',
      httpStatus: 404,
    });
    expect(await setup([{ status: 500 }]).api.get('/x')).toEqual({
      ok: false,
      reason: 'http_status',
      httpStatus: 500,
    });
  });

  it('maps a transport error to its reason', async () => {
    const { api } = setup([{ error: new HttpFetchError('too_large') }]);
    expect(await api.get('/x')).toEqual({ ok: false, reason: 'too_large' });
    const other = setup([{ error: new Error('boom') }]);
    expect(await other.api.get('/x')).toEqual({ ok: false, reason: 'network' });
  });
});
