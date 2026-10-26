import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { opportunities, opportunityEvidence, rawSignals } from '../src/infrastructure/db/schema.js';
import type { FeedItem, SourceAdapter, SourceAdapters } from '../src/modules/sources/ports.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./fixtures/tenders/bzp-page.json', import.meta.url)),
  'utf8',
);
const TED_FIXTURE = readFileSync(
  fileURLToPath(new URL('./fixtures/tenders/ted-page.json', import.meta.url)),
  'utf8',
);
const BZP = 'https://ezamowienia.gov.pl';
const TED = 'https://api.ted.europa.eu';
const HOUR = 3_600_000;

type Answer = { status: number; body?: string; headers?: Record<string, string> };
/** The BZP request log (day asked for, page) and the scripted answer per request. */
const asked: { day: string; page: number }[] = [];
let answer: (day: string, page: number) => Answer = () => ({ status: 200, body: '[]' });

beforeAll(() => {
  const agent = getGlobalDispatcher() as unknown as MockAgent;
  agent
    .get(BZP)
    .intercept({ path: (path) => path.startsWith('/mo-board/api/v1/notice?') })
    .reply((options) => {
      const params = new URL(options.path, BZP).searchParams;
      const day = (params.get('PublicationDateFrom') ?? '').slice(0, 10);
      const page = Number(params.get('PageNumber'));
      asked.push({ day, page });
      const reply = answer(day, page);
      return {
        statusCode: reply.status,
        data: reply.body ?? '',
        responseOptions: { headers: { 'content-type': 'application/json', ...reply.headers } },
      };
    })
    .persist();
});

/** The TED request log (parsed body) and the scripted answer per request. */
const tedAsked: { query: string; token: string | undefined }[] = [];
let tedAnswer: (query: string, token: string | undefined) => Answer = () => ({
  status: 200,
  body: '{"notices":[]}',
});

beforeAll(() => {
  const agent = getGlobalDispatcher() as unknown as MockAgent;
  agent
    .get(TED)
    .intercept({ path: '/v3/notices/search', method: 'POST' })
    .reply((options) => {
      const body = JSON.parse(String(options.body)) as {
        query: string;
        iterationNextToken?: string;
      };
      tedAsked.push({ query: body.query, token: body.iterationNextToken });
      const reply = tedAnswer(body.query, body.iterationNextToken);
      return {
        statusCode: reply.status,
        data: reply.body ?? '',
        responseOptions: { headers: { 'content-type': 'application/json', ...reply.headers } },
      };
    })
    .persist();
});

beforeEach(() => {
  tedAsked.length = 0;
  tedAnswer = () => ({ status: 200, body: '{"notices":[]}' });
  asked.length = 0;
  answer = () => ({ status: 200, body: '[]' });
});

/** `n` DEMO notices with unique numbers, all CPV 72. */
const notices = (prefix: string, n: number, over: object = {}) =>
  Array.from({ length: n }, (_, i) => ({
    objectId: `${prefix}-${i}`,
    bzpNumber: `2026/BZP ${prefix}-${i}`,
    noticeType: 'ContractNotice',
    orderObject: `DEMO przetarg ${prefix}-${i}`,
    organizationName: 'DEMO Gmina',
    cpvCode: '72000000-5',
    publicationDate: '2026-01-01T08:00:00Z',
    submittingOffersDate: '2026-02-01T09:00:00Z',
    htmlBody: '<p>Opis.</p>',
    ...over,
  }));
const filler = (): string =>
  JSON.stringify(
    Array.from({ length: 100 }, (_, i) => ({ objectId: `f${i}`, noticeType: 'Other' })),
  );

async function setup() {
  const clock = new FakeClock();
  const built = await buildTestApp({ clock, env: { LLM_PROVIDER: 'mock' } });
  const cookie = await loginAsOperator(built.app);
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const created = await call('POST', '/api/sources', { preset: 'bzp-it' });
  expect(created.statusCode).toBe(201);
  const id = created.json().id as number;
  const run = async () => (await call('POST', `/api/sources/${id}/run`)).json();
  const signals = () => openTestDb(built.dir).db.select().from(rawSignals).all();
  return { ...built, clock, call, id, run, signals, created: created.json() };
}

describe('BZP source through the source loop (S-18 FR-32 AC1)', () => {
  it('offers the preset with its default CPV prefixes and adds it once', async () => {
    const { call, created } = await setup();
    expect(created).toMatchObject({
      type: 'bzp',
      name: 'e-Zamówienia (BZP) — IT i oprogramowanie',
      presetId: 'bzp-it',
      url: 'https://ezamowienia.gov.pl/mo-board/api/v1/notice',
      tender: { cpvPrefixes: ['72', '48', '73'], countries: null },
    });
    expect(created.accessNote).toContain('30 zapytań na minutę');
    expect((await call('POST', '/api/sources', { preset: 'bzp-it' })).json()).toEqual({
      error: 'exists',
    });
    const presets = (await call('GET', '/api/sources')).json().presets;
    expect(presets.find((p: { id: string }) => p.id === 'bzp-it')).toMatchObject({ type: 'bzp' });
  });

  it('turns notices into signals with buyer, deadline, URL and a value only where stated', async () => {
    answer = (day) => ({ status: 200, body: day === '2026-01-01' ? FIXTURE : '[]' });
    const { run, signals } = await setup();
    // Three of the six fixture notices map, one is malformed; the rest are ignored.
    expect(await run()).toMatchObject({ status: 'partial', new: 3, failed: 1 });
    const stored = signals();
    expect(stored.every((s) => s.sourceType === 'bzp')).toBe(true);
    const tender = (number: string) =>
      JSON.parse(stored.find((s) => s.externalId === number)?.tenderJson ?? 'null');
    expect(tender('2026/BZP 00000001')).toMatchObject({
      buyer: 'DEMO Gmina Przykładowo',
      deadlineAt: '2026-11-20T09:00:00.000Z',
      estimatedValue: { amountMinor: 12_345_678, currency: 'PLN' },
    });
    expect(tender('2026/BZP 00000002').estimatedValue).toBeNull();
    expect(stored.find((s) => s.externalId === '2026/BZP 00000001')?.sourceUrl).toMatch(
      /^https:\/\/ezamowienia\.gov\.pl\/.+000000000001$/,
    );
  });

  it('asks for the last three days on a first run and repeats only duplicates on the next', async () => {
    answer = (day) => ({
      status: 200,
      body: day === '2026-01-01' ? JSON.stringify(notices('a', 2)) : '[]',
    });
    const { run, clock } = await setup();
    expect(await run()).toMatchObject({ status: 'ok', new: 2 });
    expect([...new Set(asked.map((r) => r.day))]).toEqual([
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
    ]);
    clock.advance(2 * HOUR);
    expect(await run()).toMatchObject({ status: 'ok', new: 0, duplicates: 2 });
  });

  it('shows a 500 as an explicit error and keeps the signals of the earlier run', async () => {
    answer = (day) => ({
      status: 200,
      body: day === '2026-01-01' ? JSON.stringify(notices('a', 1)) : '[]',
    });
    const { run, clock, signals, call } = await setup();
    await run();
    answer = (day) =>
      day === '2026-01-01'
        ? { status: 200, body: JSON.stringify(notices('b', 3)) }
        : { status: 500 };
    clock.advance(2 * HOUR);
    expect(await run()).toMatchObject({
      status: 'failed',
      new: 0,
      error: { reason: 'http_status', httpStatus: 500 },
    });
    // The pages read before the failure were dropped; the next run repeats the window.
    expect(signals()).toHaveLength(1);
    const listed = (await call('GET', '/api/sources')).json().items[0];
    expect(listed.lastError).toMatchObject({ reason: 'http_status', httpStatus: 500 });
  });

  it('answers 403 with rate_limited and a wait of at least the interval, with no second request', async () => {
    answer = () => ({ status: 403 });
    const { run, clock } = await setup();
    const result = await run();
    expect(result).toMatchObject({
      status: 'failed',
      error: { reason: 'rate_limited', httpStatus: 403 },
    });
    expect(asked).toHaveLength(1);
    expect(Date.parse(result.nextAllowedAt)).toBeGreaterThanOrEqual(clock.now().getTime() + HOUR);
  });

  it('backs off on 429 with Retry-After and then completes', async () => {
    let first = true;
    answer = (day) => {
      if (first) {
        first = false;
        return { status: 429, headers: { 'retry-after': '3' } };
      }
      return { status: 200, body: day === '2026-01-01' ? JSON.stringify(notices('a', 1)) : '[]' };
    };
    const { run } = await setup();
    expect(await run()).toMatchObject({ status: 'ok', new: 1 });
    expect(asked[0]).toEqual(asked[1]);
  });

  it('after a capped run the next one starts at the gap and fetches the rest (plan-review 1)', async () => {
    // Day 1 ends after a short page; day 2 has more full pages than the cap allows.
    answer = (day, page) => {
      if (day === '2025-12-29') return { status: 200, body: page === 1 ? filler() : '[]' };
      if (day === '2025-12-30') return { status: 200, body: filler() };
      return { status: 200, body: '[]' };
    };
    const { run, clock, signals } = await setup();
    expect(await run()).toMatchObject({ status: 'partial', failed: 0 });
    expect(asked).toHaveLength(10);

    asked.length = 0;
    answer = (day) => ({
      status: 200,
      body: day === '2025-12-31' ? JSON.stringify(notices('late', 2)) : '[]',
    });
    clock.advance(2 * HOUR);
    expect(await run()).toMatchObject({ status: 'ok', new: 2 });
    // It resumed at the day that was not finished, not at lastSuccessAt - 24 h.
    expect(asked[0]?.day).toBe('2025-12-30');
    expect(signals()).toHaveLength(2);
    // The gap is closed: a third run starts from the usual window again (last success - 24 h).
    asked.length = 0;
    clock.advance(2 * HOUR);
    await run();
    expect(asked[0]?.day).toBe('2025-12-31');
  });

  it('lets through with the source filter off what the filter on rejects (lesson)', async () => {
    answer = (day) => ({
      status: 200,
      body:
        day === '2026-01-01'
          ? JSON.stringify(notices('a', 1, { orderObject: 'DEMO SEEKING WORK' }))
          : '[]',
    });
    const off = await setup();
    expect(await off.run()).toMatchObject({ new: 1, filtered: 0 });

    const on = await setup();
    await on.call('PATCH', `/api/sources/${on.id}`, {
      filter: { enabled: true, include: [], exclude: ['SEEKING WORK'] },
    });
    expect(await on.run()).toMatchObject({ new: 1, filtered: 1 });
  });
});

describe('TED source through the source loop (S-18 FR-32 AC2)', () => {
  async function setupTed(adapters?: Partial<SourceAdapters>) {
    const clock = new FakeClock();
    const built = await buildTestApp({
      clock,
      env: { LLM_PROVIDER: 'mock' },
      ...(adapters ? { adapters } : {}),
    });
    const cookie = await loginAsOperator(built.app);
    const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
      built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
    const created = await call('POST', '/api/sources', { preset: 'ted-pl-it' });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number;
    const run = async () => (await call('POST', `/api/sources/${id}/run`)).json();
    const rows = () => {
      const { db } = openTestDb(built.dir);
      return {
        signals: db.select().from(rawSignals).all(),
        opps: db.select().from(opportunities).all(),
        evidence: db.select().from(opportunityEvidence).all(),
      };
    };
    return { ...built, clock, call, id, run, rows, created: created.json(), cookie };
  }

  it('offers the preset with PL and the CPV prefixes, and adds it once', async () => {
    const { call, created } = await setupTed();
    expect(created).toMatchObject({
      type: 'ted',
      name: 'TED — przetargi IT w Polsce',
      presetId: 'ted-pl-it',
      url: 'https://api.ted.europa.eu/v3/notices/search',
      tender: { cpvPrefixes: ['72', '48', '73'], countries: ['PL'] },
    });
    expect((await call('POST', '/api/sources', { preset: 'ted-pl-it' })).json()).toEqual({
      error: 'exists',
    });
  });

  it('sends the configured CPV prefixes and country, and stores buyer, deadline, URL and value only where stated', async () => {
    tedAnswer = (query) => ({
      status: 200,
      body: query.includes('publication-date>=20260101') ? TED_FIXTURE : '{"notices":[]}',
    });
    const { run, rows, call, id } = await setupTed();
    await call('PATCH', `/api/sources/${id}`, {
      tender: { cpvPrefixes: ['72', '48'], countries: ['PL', 'DE'] },
    });
    expect(await run()).toMatchObject({ status: 'partial', new: 2, failed: 1 });
    expect(tedAsked[0]?.query).toContain('classification-cpv IN (72* 48*)');
    expect(tedAsked[0]?.query).toContain('buyer-country IN (POL DEU)');
    const { signals } = rows();
    expect(signals.every((s) => s.sourceType === 'ted')).toBe(true);
    const tender = (number: string) =>
      JSON.parse(signals.find((s) => s.externalId === number)?.tenderJson ?? 'null');
    expect(tender('900001-2026')).toMatchObject({
      buyer: 'DEMO Uniwersytet Przykładowy',
      deadlineAt: '2026-11-24T09:30:00.000Z',
      estimatedValue: { amountMinor: 25_000_050, currency: 'PLN' },
    });
    expect(tender('900002-2026').estimatedValue).toBeNull();
    expect(signals.find((s) => s.externalId === '900001-2026')?.sourceUrl).toBe(
      'https://ted.europa.eu/pl/notice/-/detail/900001-2026',
    );
  });

  it('rejects a country TED cannot be asked for before it is stored', async () => {
    const { call, id } = await setupTed();
    const bad = await call('PATCH', `/api/sources/${id}`, {
      tender: { cpvPrefixes: ['72'], countries: ['US'] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('shows 500 and 403 as explicit errors with the status', async () => {
    const { run, clock } = await setupTed();
    for (const status of [500, 403]) {
      tedAnswer = () => ({ status });
      expect(await run()).toMatchObject({
        status: 'failed',
        new: 0,
        error: { reason: 'http_status', httpStatus: status },
      });
      clock.advance(2 * HOUR);
    }
  });

  it('follows the iteration token and stops on the empty page', async () => {
    const full = JSON.stringify({
      notices: Array.from({ length: 100 }, (_, i) => ({
        'publication-number': `${i}`,
        'notice-type': 'can-standard',
      })),
      iterationNextToken: 'tok-1',
    });
    tedAnswer = (query, token) => {
      if (!query.includes('publication-date>=20260101'))
        return { status: 200, body: '{"notices":[]}' };
      return { status: 200, body: token === undefined ? full : '{"notices":[]}' };
    };
    const { run } = await setupTed();
    expect(await run()).toMatchObject({ status: 'ok', new: 0 });
    const today = tedAsked.filter((r) => r.query.includes('publication-date>=20260101'));
    expect(today.map((r) => r.token)).toEqual([undefined, 'tok-1']);
  });

  it('adds the TED notice as REPEAT_IMPORT evidence when a BZP signal has the same URL, and keeps two opportunities otherwise (D-16)', async () => {
    const sameUrl = 'https://ted.europa.eu/pl/notice/-/detail/900001-2026';
    const bzp: SourceAdapter = {
      type: 'bzp',
      validateConfig: (config) => ({ ok: true, config, key: 'bzp' }),
      async discover() {
        const first: FeedItem = {
          key: 'DEMO-BZP-1',
          url: sameUrl,
          title: 'DEMO to samo ogłoszenie w BZP',
          text: 'DEMO treść BZP',
          publishedAt: null,
        };
        const other: FeedItem = {
          key: 'DEMO-BZP-2',
          url: 'https://ezamowienia.gov.pl/inne',
          title: 'DEMO inne ogłoszenie',
          text: 'DEMO inna treść',
          publishedAt: null,
        };
        return { ok: true, items: [first, other], skipped: 0 };
      },
      async healthCheck() {
        return { ok: true, items: [], skipped: 0 };
      },
    };
    tedAnswer = (query) => ({
      status: 200,
      body: query.includes('publication-date>=20260101') ? TED_FIXTURE : '{"notices":[]}',
    });
    const { run, rows, call } = await setupTed({ bzp });
    const bzpId = (await call('POST', '/api/sources', { preset: 'bzp-it' })).json().id as number;
    await call('POST', `/api/sources/${bzpId}/run`);
    expect(rows().opps).toHaveLength(2);

    expect(await run()).toMatchObject({ new: 1, duplicates: 1 });
    const after = rows();
    // The BZP source owns the shared opportunity; the TED notice is evidence, not a second row.
    expect(after.opps).toHaveLength(3);
    expect(after.signals.filter((s) => s.sourceType === 'ted')).toHaveLength(1);
    const repeat = after.evidence.filter((e) => e.evidenceType === 'REPEAT_IMPORT');
    expect(repeat).toHaveLength(1);
    expect(repeat[0]?.sourceUrl).toBe(sameUrl);
  });

  it('keeps the first source as the owner when a manual import came before (plan-review 4)', async () => {
    const { run, rows, cookie, app } = await (async () => {
      const t = await setupTed();
      return t;
    })();
    tedAnswer = (query) => ({
      status: 200,
      body: query.includes('publication-date>=20260101') ? TED_FIXTURE : '{"notices":[]}',
    });
    const imported = await app.inject({
      method: 'POST',
      url: '/api/signals/import',
      headers: { cookie },
      payload: {
        text: 'DEMO ręcznie wklejone ogłoszenie TED',
        url: 'https://ted.europa.eu/pl/notice/-/detail/900001-2026',
      },
    });
    expect(imported.statusCode).toBe(201);
    await run();
    const { signals, opps } = rows();
    // First source decides: the opportunity stays a manual one (no tender facts), the TED notice
    // is repeat evidence. Documented in docs/source-policy.md.
    const manual = signals.filter((s) => s.sourceType.startsWith('manual'));
    expect(manual).toHaveLength(1);
    expect(manual[0]?.tenderJson).toBeNull();
    // 900001 matched the manual import by URL and became evidence; only 900002 is a new signal.
    expect(signals.filter((s) => s.sourceType === 'ted').map((s) => s.externalId)).toEqual([
      '900002-2026',
    ]);
    expect(opps).toHaveLength(2);
  });
});
