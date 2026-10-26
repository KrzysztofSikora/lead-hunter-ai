import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HttpClient, HttpResponse } from '../http/client.js';
import { HttpFetchError } from '../http/client.js';
import { createTedAdapter, TED_MIN_GAP_MS, TED_PAGE_CAP, TED_PAGE_SIZE } from './adapter.js';

const FIXTURE = readFileSync(
  new URL('../../../../test/fixtures/tenders/ted-page.json', import.meta.url),
  'utf8',
);
const DAY = 24 * 3_600_000;
const NOW = Date.parse('2026-10-26T12:00:00Z');

type Answer = { status?: number; body?: string; headers?: HttpResponse['headers'] } | Error;
type Sent = { at: number; url: string; body: Record<string, unknown> };

function harness(answer: (request: number, sent: Sent) => Answer) {
  const state = { now: NOW, log: [] as Sent[], sleeps: [] as number[] };
  const http: HttpClient = {
    async get() {
      throw new Error('TED does not GET');
    },
    async post(url, options) {
      const sent: Sent = { at: state.now, url, body: JSON.parse(options.body) };
      expect(options.contentType).toBe('application/json');
      state.log.push(sent);
      const reply = answer(state.log.length, sent);
      if (reply instanceof Error) throw reply;
      return {
        status: reply.status ?? 200,
        headers: reply.headers ?? {},
        body: new TextEncoder().encode(reply.body ?? '{"notices":[]}'),
        url,
      };
    },
  };
  const adapter = createTedAdapter({
    http,
    clock: { now: () => new Date(state.now) },
    timeoutMs: 1_000,
    maxAttempts: 3,
    maxTextChars: 20_000,
    sleep: async (ms) => {
      state.sleeps.push(ms);
      state.now += ms;
    },
  });
  return { adapter, state };
}

const CONFIG = { cpvPrefixes: ['72', '48', '73'], countries: ['PL'] };
const fullPage = (token: string | null): string =>
  JSON.stringify({
    notices: Array.from({ length: TED_PAGE_SIZE }, (_, i) => ({
      'publication-number': `${i}-2026`,
      'notice-type': 'can-standard',
    })),
    iterationNextToken: token,
  });

describe('createTedAdapter (S-18 FR-32 AC2, D-9, D-11, D-19)', () => {
  it('validates the config and keys the source as `ted`', () => {
    const { adapter } = harness(() => ({}));
    expect(adapter.validateConfig(CONFIG)).toEqual({ ok: true, config: CONFIG, key: 'ted' });
    expect(adapter.validateConfig({ cpvPrefixes: ['72'] })).toMatchObject({ ok: false });
    expect(adapter.validateConfig({ ...CONFIG, countries: ['US'] })).toMatchObject({ ok: false });
  });

  it('posts one query per UTC day with the configured prefixes and country', async () => {
    const { adapter, state } = harness(() => ({ body: FIXTURE }));
    const outcome = await adapter.discover(CONFIG, { since: NOW - DAY });
    expect(state.log).toHaveLength(2);
    expect(state.log[0]?.url).toBe('https://api.ted.europa.eu/v3/notices/search');
    const body = state.log[0]?.body;
    expect(body).toMatchObject({
      limit: TED_PAGE_SIZE,
      scope: 'ACTIVE',
      paginationMode: 'ITERATION',
    });
    expect(body?.query).toContain('classification-cpv IN (72* 48* 73*)');
    expect(body?.query).toContain('buyer-country IN (POL)');
    expect(body?.query).toContain('publication-date>=20261025');
    expect(state.log[1]?.body.query).toContain('publication-date>=20261026');
    expect(body).not.toHaveProperty('iterationNextToken');
    // Per day: 2 items, 1 type-ignored, 1 cpv-ignored, 1 invalid.
    expect(outcome).toMatchObject({ ok: true, skipped: 2 });
    expect(outcome.ok && outcome.items).toHaveLength(4);
  });

  it('follows the iteration token and stops on an empty page', async () => {
    const { adapter, state } = harness((n) => {
      if (n === 1) return { body: fullPage('tok-1') };
      if (n === 2) return { body: fullPage('tok-2') };
      return { body: '{"notices":[],"iterationNextToken":"tok-3"}' };
    });
    const outcome = await adapter.discover(CONFIG, { since: NOW });
    expect(state.log.map((r) => r.body.iterationNextToken)).toEqual([undefined, 'tok-1', 'tok-2']);
    expect(outcome).toEqual({ ok: true, items: [], skipped: 0 });
  });

  it('stops at a short page without a token', async () => {
    const { adapter, state } = harness(() => ({ body: FIXTURE }));
    await adapter.discover(CONFIG, { since: NOW });
    expect(state.log).toHaveLength(1);
  });

  it('is truncated at the page cap and says where the next run resumes', async () => {
    const { adapter, state } = harness((n) => ({ body: fullPage(`tok-${n}`) }));
    const outcome = await adapter.discover(CONFIG, { since: NOW - DAY });
    expect(state.log).toHaveLength(TED_PAGE_CAP);
    expect(outcome).toMatchObject({
      ok: true,
      truncated: true,
      resumeFrom: Date.parse('2026-10-25T00:00:00Z'),
    });
  });

  it('is truncated, not complete, when a full page has no token to continue with', async () => {
    const { adapter } = harness(() => ({ body: fullPage(null) }));
    expect(await adapter.discover(CONFIG, { since: NOW })).toMatchObject({
      ok: true,
      truncated: true,
      resumeFrom: Date.parse('2026-10-26T00:00:00Z'),
    });
  });

  it('keeps at least the spacing between two requests on the injected clock', async () => {
    const { adapter, state } = harness((n) => ({ body: n < 4 ? fullPage(`t${n}`) : undefined }));
    await adapter.discover(CONFIG, { since: NOW });
    const gaps = state.log.slice(1).map((r, i) => r.at - (state.log[i]?.at ?? 0));
    expect(gaps.length).toBeGreaterThan(0);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(TED_MIN_GAP_MS);
  });

  it('drops pages already read when a later page fails', async () => {
    const { adapter } = harness((n) => (n === 1 ? { body: fullPage('tok') } : { status: 500 }));
    expect(await adapter.discover(CONFIG, { since: NOW })).toEqual({
      ok: false,
      reason: 'http_status',
      httpStatus: 500,
    });
  });

  it('maps 403 to http_status (not rate_limited) with no retry', async () => {
    const { adapter, state } = harness(() => ({ status: 403 }));
    expect(await adapter.discover(CONFIG, { since: NOW })).toEqual({
      ok: false,
      reason: 'http_status',
      httpStatus: 403,
    });
    expect(state.log).toHaveLength(1);
  });

  it('backs off on 429 with Retry-After, then succeeds; gives up as rate_limited', async () => {
    const ok = harness((n) =>
      n === 1 ? { status: 429, headers: { 'retry-after': '3' } } : { body: FIXTURE },
    );
    expect(await ok.adapter.discover(CONFIG, { since: NOW })).toMatchObject({ ok: true });
    expect(ok.state.sleeps).toContain(3_000);

    const never = harness(() => ({ status: 503 }));
    expect(await never.adapter.discover(CONFIG, { since: NOW })).toMatchObject({
      ok: false,
      reason: 'rate_limited',
      httpStatus: 503,
    });
    expect(never.state.log).toHaveLength(3);

    const long = harness(() => ({ status: 429, headers: { 'retry-after': '600' } }));
    expect(await long.adapter.discover(CONFIG, { since: NOW })).toMatchObject({
      ok: false,
      reason: 'rate_limited',
      retryAfterMs: 600_000,
    });
    expect(long.state.log).toHaveLength(1);
  });

  it('turns transport errors and bad bodies into explicit failures', async () => {
    expect(
      await harness(() => new HttpFetchError('timeout')).adapter.discover(CONFIG, { since: NOW }),
    ).toEqual({ ok: false, reason: 'timeout' });
    expect(
      await harness(() => new HttpFetchError('too_large')).adapter.discover(CONFIG, { since: NOW }),
    ).toEqual({ ok: false, reason: 'too_large' });
    for (const body of ['not json', '[]', '{"items":[]}', 'null']) {
      expect(await harness(() => ({ body })).adapter.discover(CONFIG, { since: NOW })).toEqual({
        ok: false,
        reason: 'invalid_feed',
      });
    }
  });

  it('health check reads one notice of today and stores nothing', async () => {
    const { adapter, state } = harness(() => ({ body: FIXTURE }));
    const outcome = await adapter.healthCheck(CONFIG);
    expect(state.log).toHaveLength(1);
    expect(state.log[0]?.body.limit).toBe(1);
    expect(outcome).toMatchObject({ ok: true, skipped: 0 });
  });
});
