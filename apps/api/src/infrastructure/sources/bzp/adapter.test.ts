import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HttpClient, HttpResponse } from '../http/client.js';
import { HttpFetchError } from '../http/client.js';
import { BZP_MIN_GAP_MS, BZP_PAGE_CAP, BZP_PAGE_SIZE, createBzpAdapter } from './adapter.js';

const FIXTURE = readFileSync(
  new URL('../../../../test/fixtures/tenders/bzp-page.json', import.meta.url),
  'utf8',
);
const DAY = 24 * 3_600_000;
const NOW = Date.parse('2026-10-26T12:00:00Z');

type Answer = { status?: number; body?: string; headers?: HttpResponse['headers'] } | Error;

/** A client that answers from a script and logs when (on the injected clock) and what was asked. */
function harness(answer: (request: number, url: URL) => Answer) {
  const state = { now: NOW, log: [] as { at: number; url: URL }[], sleeps: [] as number[] };
  const http: HttpClient = {
    async get(rawUrl) {
      const url = new URL(rawUrl);
      state.log.push({ at: state.now, url });
      const reply = answer(state.log.length, url);
      if (reply instanceof Error) throw reply;
      return {
        status: reply.status ?? 200,
        headers: reply.headers ?? {},
        body: new TextEncoder().encode(reply.body ?? '[]'),
        url: rawUrl,
      };
    },
    async post() {
      throw new Error('BZP does not POST');
    },
  };
  const adapter = createBzpAdapter({
    http,
    clock: { now: () => new Date(state.now) },
    timeoutMs: 1_000,
    maxAttempts: 3,
    maxTextChars: 20_000,
    // The clock moves with every wait, so the gaps between requests are measurable.
    sleep: async (ms) => {
      state.sleeps.push(ms);
      state.now += ms;
    },
  });
  return { adapter, state };
}

const CONFIG = { cpvPrefixes: ['72', '48', '73'] };
const fullPage = (): string =>
  JSON.stringify(
    Array.from({ length: BZP_PAGE_SIZE }, (_, i) => ({
      objectId: `id-${i}`,
      bzpNumber: `2026/BZP ${i}`,
      noticeType: 'Other',
    })),
  );

describe('createBzpAdapter (S-18 FR-32 AC1, D-9, D-10, D-18)', () => {
  it('validates the config and keys the source as `bzp`', () => {
    const { adapter } = harness(() => ({}));
    expect(adapter.validateConfig(CONFIG)).toEqual({ ok: true, config: CONFIG, key: 'bzp' });
    expect(adapter.validateConfig({ cpvPrefixes: ['7'] })).toMatchObject({ ok: false });
    expect(adapter.validateConfig({ cpvPrefixes: ['72'], extra: 1 })).toMatchObject({ ok: false });
  });

  it('reads the window in UTC-day slices with the documented parameters', async () => {
    const { adapter, state } = harness(() => ({ body: FIXTURE }));
    const outcome = await adapter.discover(CONFIG, { since: NOW - 2 * DAY });
    // since is the 24th 12:00, so the slices start on the 24th, 25th and 26th.
    expect(state.log.map((r) => r.url.searchParams.get('PublicationDateFrom'))).toEqual([
      '2026-10-24T00:00:00.000Z',
      '2026-10-25T00:00:00.000Z',
      '2026-10-26T00:00:00.000Z',
    ]);
    const first = state.log[0]?.url.searchParams;
    expect(first?.get('NoticeType')).toBe('ContractNotice');
    expect(first?.get('PageSize')).toBe(String(BZP_PAGE_SIZE));
    expect(first?.get('PageNumber')).toBe('1');
    // 3 slices of the same page: 3 notices mapped and 1 invalid in each.
    expect(outcome).toMatchObject({ ok: true, skipped: 3 });
    expect(outcome.ok && outcome.items).toHaveLength(9);
  });

  it('keeps every gap between two requests at or above the minimum, health check included', async () => {
    const { adapter, state } = harness(() => ({ body: fullPage() }));
    await adapter.healthCheck(CONFIG);
    await adapter.discover(CONFIG, { since: NOW });
    const gaps = state.log.slice(1).map((r, i) => r.at - (state.log[i]?.at ?? 0));
    expect(state.log.length).toBeGreaterThan(5);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(BZP_MIN_GAP_MS);
    // 60 000 / 2 100 = 28 requests in any minute, under the 30 the API guarantees.
    const burst = state.log.filter((r) => r.at < (state.log[0]?.at ?? 0) + 60_000).length;
    expect(burst).toBeLessThanOrEqual(30);
  });

  it('stops at the page cap, reports the gap start and never calls it complete', async () => {
    const { adapter, state } = harness(() => ({ body: fullPage() }));
    const outcome = await adapter.discover(CONFIG, { since: NOW - DAY });
    expect(state.log).toHaveLength(BZP_PAGE_CAP);
    expect(outcome).toMatchObject({
      ok: true,
      truncated: true,
      resumeFrom: Date.parse('2026-10-25T00:00:00Z'),
    });
  });

  it('is complete, not truncated, when the cap is reached exactly at the end', async () => {
    // Window of one day: ten full pages would be truncated, nine plus a short one is complete.
    const { adapter, state } = harness((n) => ({ body: n < 10 ? fullPage() : '[]' }));
    const outcome = await adapter.discover(CONFIG, { since: NOW });
    expect(state.log).toHaveLength(10);
    expect(outcome).toEqual({ ok: true, items: [], skipped: 0 });
  });

  it('drops the pages already read when a later page fails (plan-review 8)', async () => {
    const { adapter } = harness((n) =>
      n === 1 ? { body: JSON.stringify(JSON.parse(FIXTURE)) } : { status: 500 },
    );
    const outcome = await adapter.discover(CONFIG, { since: NOW - DAY });
    expect(outcome).toEqual({ ok: false, reason: 'http_status', httpStatus: 500 });
  });

  it('maps 403 to rate_limited with a one-minute hint and no second request (D-18)', async () => {
    const { adapter, state } = harness(() => ({ status: 403 }));
    const outcome = await adapter.discover(CONFIG, { since: NOW });
    expect(outcome).toEqual({
      ok: false,
      reason: 'rate_limited',
      httpStatus: 403,
      retryAfterMs: 60_000,
    });
    expect(state.log).toHaveLength(1);
  });

  it('backs off on 429 with Retry-After, then succeeds', async () => {
    const { adapter, state } = harness((n) =>
      n === 1 ? { status: 429, headers: { 'retry-after': '5' } } : { body: '[]' },
    );
    const outcome = await adapter.discover(CONFIG, { since: NOW });
    expect(outcome).toMatchObject({ ok: true });
    expect(state.log).toHaveLength(2);
    expect(state.sleeps[0]).toBe(5_000);
  });

  it('gives up after the attempts, or at once for a Retry-After above 30 s', async () => {
    const tired = harness(() => ({ status: 503 }));
    expect(await tired.adapter.discover(CONFIG, { since: NOW })).toMatchObject({
      ok: false,
      reason: 'rate_limited',
      httpStatus: 503,
    });
    expect(tired.state.log).toHaveLength(3);
    const told = harness(() => ({ status: 429, headers: { 'retry-after': '3600' } }));
    expect(await told.adapter.discover(CONFIG, { since: NOW })).toMatchObject({
      ok: false,
      retryAfterMs: 3_600_000,
    });
    expect(told.state.log).toHaveLength(1);
  });

  it('maps 404, a transport error, a non-JSON body and a non-array body to explicit reasons', async () => {
    const cases: [Answer, object][] = [
      [{ status: 404 }, { reason: 'http_status', httpStatus: 404 }],
      [new HttpFetchError('timeout'), { reason: 'timeout' }],
      [new HttpFetchError('too_large'), { reason: 'too_large' }],
      [{ body: '<html>' }, { reason: 'invalid_feed' }],
      [{ body: '{"items":[]}' }, { reason: 'invalid_feed' }],
    ];
    for (const [answer, expected] of cases) {
      const { adapter } = harness(() => answer);
      expect(await adapter.discover(CONFIG, { since: NOW })).toMatchObject({
        ok: false,
        ...expected,
      });
    }
  });

  it('health check reads one page and returns what it mapped', async () => {
    const { adapter, state } = harness(() => ({ body: FIXTURE }));
    const outcome = await adapter.healthCheck(CONFIG);
    expect(state.log).toHaveLength(1);
    expect(outcome.ok && outcome.items.map((i) => i.key)).toEqual([
      '2026/BZP 00000001',
      '2026/BZP 00000002',
      '2026/BZP 00000006',
    ]);
  });
});
