import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rawSignals } from '../src/infrastructure/db/schema.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./fixtures/tenders/bzp-page.json', import.meta.url)),
  'utf8',
);
const BZP = 'https://ezamowienia.gov.pl';
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

beforeEach(() => {
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
