import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jobRuns, rawSignals, sources } from '../src/infrastructure/db/schema.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const feed = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/feeds/${name}`, import.meta.url)), 'utf8');
const WWR_FEED = feed('synthetic-wwr-programming.xml');
const HN_FEED = feed('synthetic-hnrss-freelance.xml');

const FL = 'https://www.freelancer.com';
const FORUM = 'https://forum.arduino.cc';
const HN = 'https://hnrss.org';
const FL_ARDUINO = '/rss.xml?keyword=arduino';
const FL_REACT = '/rss.xml?keyword=react';
const HN_FREELANCE = '/whoishiring/freelance';
const FORUM_JOBS = '/c/community/jobs/42.rss';
const HOUR = 3_600_000;

type Answer = { status: number; body?: string; headers?: Record<string, string>; fail?: boolean };
const answers = new Map<string, Answer[]>();
const requests = new Map<string, number>();
const hits = (origin: string, path: string): number => requests.get(origin + path) ?? 0;
/** The last answer repeats; earlier ones are used up in order. */
function serve(origin: string, path: string, ...list: Answer[]): void {
  answers.set(origin + path, list);
}

beforeAll(() => {
  const agent = getGlobalDispatcher() as unknown as MockAgent;
  const paths: [string, string][] = [
    [FL, FL_ARDUINO],
    [FL, FL_REACT],
    [HN, HN_FREELANCE],
    [FORUM, FORUM_JOBS],
    [FL, '/robots.txt'],
    [FORUM, '/robots.txt'],
    [HN, '/robots.txt'],
  ];
  for (const [origin, path] of paths) {
    agent
      .get(origin)
      .intercept({ path })
      .reply(() => {
        const key = origin + path;
        requests.set(key, (requests.get(key) ?? 0) + 1);
        const list = answers.get(key) ?? [{ status: 404, body: '' }];
        const answer = list.length > 1 ? (list.shift() as Answer) : (list[0] as Answer);
        if (answer.fail) throw new Error('connection reset');
        return {
          statusCode: answer.status,
          data: answer.body ?? '',
          responseOptions: { headers: answer.headers ?? { 'content-type': 'application/xml' } },
        };
      })
      .persist();
  }
});

beforeEach(() => {
  answers.clear();
  requests.clear();
  serve(FL, '/robots.txt', { status: 404 });
  serve(FORUM, '/robots.txt', { status: 404 });
  serve(HN, '/robots.txt', { status: 404 });
});

async function setup() {
  const clock = new FakeClock();
  const built = await buildTestApp({ clock, env: { LLM_PROVIDER: 'mock' } });
  const cookie = await loginAsOperator(built.app);
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const add = async (preset: string): Promise<number> => {
    const res = await call('POST', '/api/sources', { preset });
    expect(res.statusCode).toBe(201);
    return res.json().id as number;
  };
  const db = () => openTestDb(built.dir).db;
  return { ...built, clock, call, add, db };
}

describe('sources (FR-04, FR-18 AC3)', () => {
  it('adds presets in one step and a feed by hand, and shows access methods (AC2, AC7)', async () => {
    const { call } = await setup();

    const wwr = await call('POST', '/api/sources', { preset: 'freelancer-arduino' });
    expect(wwr.statusCode).toBe(201);
    expect(wwr.json()).toMatchObject({
      name: 'Freelancer.com — Arduino',
      url: FL + FL_ARDUINO,
      presetId: 'freelancer-arduino',
      enabled: true,
      lastAttemptAt: null,
      lastError: null,
    });
    expect((await call('POST', '/api/sources', { preset: 'hn-freelance' })).statusCode).toBe(201);
    const manual = await call('POST', '/api/sources', {
      name: 'Mój kanał',
      url: 'https://feeds.example/jobs.xml',
    });
    expect(manual.statusCode).toBe(201);

    const list = (await call('GET', '/api/sources')).json();
    expect(list.items).toHaveLength(3);
    for (const item of list.items) expect(item.accessNote.length).toBeGreaterThan(20);
    expect(list.items[0].termsUrl).toMatch(/^https:/);
    expect(list.items[2].termsUrl).toBeNull();
    const offered = list.presets.map((p: { id: string }) => p.id);
    expect(offered).toContain('freelancer-iot');
    expect(offered).toContain('arduino-jobs');
    expect(offered.some((id: string) => id.startsWith('wwr-') || id === 'hn-jobs-contract')).toBe(
      false,
    );

    expect((await call('POST', '/api/sources', { preset: 'freelancer-arduino' })).json()).toEqual({
      error: 'exists',
    });
    expect((await call('POST', '/api/sources', { preset: 'nope' })).statusCode).toBe(400);
    const bad = await call('POST', '/api/sources', { name: 'x', url: 'ftp://x.example/feed' });
    expect(bad.statusCode).toBe(400);
    expect(
      (await call('POST', '/api/sources', { name: 'x', url: FL + FL_ARDUINO })).statusCode,
    ).toBe(409);
  });

  it('turns every new entry into a signal that names its source (AC1, AC6)', async () => {
    serve(FL, FL_ARDUINO, { status: 200, body: WWR_FEED });
    const { call, add, clock, db } = await setup();
    const id = await add('freelancer-arduino');

    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.statusCode).toBe(200);
    expect(run.json()).toMatchObject({
      status: 'ok',
      fetched: 2,
      new: 2,
      duplicates: 0,
      failed: 0,
    });

    const signals = db().select().from(rawSignals).all();
    expect(signals).toHaveLength(2);
    const first = signals.find((s) => s.sourceUrl?.endsWith('back-end-developer'));
    expect(first).toMatchObject({
      sourceType: 'rss',
      sourceId: id,
      externalId: 'https://weworkremotely.com/remote-jobs/demo-studio-senior-back-end-developer',
      title: 'DEMO Studio: Senior Back-End Developer (Node.js)',
      publishedAt: Date.parse('2026-10-06T08:00:00Z'),
      fetchedAt: clock.now().getTime(),
    });
    expect(first?.snippet).toContain('integration service');
    expect(first?.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const list = (await call('GET', '/api/opportunities')).json();
    expect(list.items).toHaveLength(2);
    const item = list.items.find((i: { source: { url: string } }) =>
      i.source.url.endsWith('back-end-developer'),
    );
    expect(item.source).toMatchObject({
      type: 'rss',
      name: 'Freelancer.com — Arduino',
      publishedAt: '2026-10-06T08:00:00.000Z',
    });
    const card = (await call('GET', `/api/opportunities/${item.id}`)).json();
    expect(card.source).toMatchObject({
      name: 'Freelancer.com — Arduino',
      url: 'https://weworkremotely.com/remote-jobs/demo-studio-senior-back-end-developer',
    });
  });

  it('never creates a duplicate on a re-read, respects the interval and dedupes across feeds (AC5, TR-06)', async () => {
    serve(FL, FL_ARDUINO, { status: 200, body: WWR_FEED });
    serve(FL, FL_REACT, { status: 200, body: WWR_FEED });
    const { call, add, clock, db } = await setup();
    const id = await add('freelancer-arduino');
    await call('POST', `/api/sources/${id}/run`);

    const early = await call('POST', `/api/sources/${id}/run`);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toEqual({
      error: 'too_soon',
      nextAllowedAt: new Date(clock.now().getTime() + HOUR).toISOString(),
    });
    expect(hits(FL, FL_ARDUINO)).toBe(1);

    clock.advance(HOUR);
    const again = await call('POST', `/api/sources/${id}/run`);
    expect(again.json()).toMatchObject({ status: 'ok', fetched: 2, new: 0, duplicates: 2 });
    expect(db().select().from(rawSignals).all()).toHaveLength(2);

    // The same job in a second category: the identity table, not the cursor, catches it.
    const other = await add('freelancer-react');
    const crossed = await call('POST', `/api/sources/${other}/run`);
    expect(crossed.json()).toMatchObject({ status: 'ok', new: 0, duplicates: 2 });
    expect(db().select().from(rawSignals).all()).toHaveLength(2);
    expect(
      db()
        .select()
        .from(jobRuns)
        .all()
        .map((r) => r.status),
    ).toEqual(['ok', 'ok', 'ok']);
  });

  it('records an explicit error per failing source and keeps the others running (AC3)', async () => {
    serve(FL, FL_ARDUINO, { status: 200, body: WWR_FEED });
    serve(HN, HN_FREELANCE, { status: 500, body: 'oops' });
    serve(FORUM, FORUM_JOBS, { status: 200, body: '<rss><channel><item></rss>' });
    serve(FL, FL_REACT, { status: 200, fail: true });
    const { call, add, sources: service, clock, db } = await setup();
    const wwr = await add('freelancer-arduino');
    await call('POST', `/api/sources/${wwr}/run`);
    clock.advance(HOUR);
    const hn = await add('hn-freelance');
    const jobs = await add('arduino-jobs');
    const broken = await add('freelancer-react');

    // The healthy source runs first, the three failing ones after it, in id order.
    const results = await service.runEnabled();
    expect(results.map((r) => r.id)).toEqual([wwr, hn, jobs, broken]);
    const reasons = results.map((r) =>
      r.outcome.kind === 'done' ? (r.outcome.result.error?.reason ?? 'ok') : r.outcome.kind,
    );
    expect(reasons).toEqual(['ok', 'http_status', 'invalid_feed', 'network']);

    const runs = db().select().from(jobRuns).all();
    expect(runs.filter((r) => r.status === 'failed')).toHaveLength(3);
    expect(runs.filter((r) => r.status === 'ok')).toHaveLength(2);
    expect(runs.find((r) => r.sourceId === hn)).toMatchObject({
      errorReason: 'http_status',
      errorStatus: 500,
    });

    const list = (await call('GET', '/api/sources')).json();
    const byId = new Map(list.items.map((s: { id: number }) => [s.id, s]));
    expect(byId.get(hn)).toMatchObject({ lastError: { reason: 'http_status', httpStatus: 500 } });
    expect(byId.get(wwr)).toMatchObject({ lastError: null });
    // Earlier signals are untouched and the empty-state status names the failures.
    const opportunities = (await call('GET', '/api/opportunities')).json();
    expect(opportunities.total).toBe(2);
    expect(opportunities.sources.checked).toBe(4);
    expect(opportunities.sources.errors.map((e: { reason: string }) => e.reason).sort()).toEqual([
      'http_status',
      'invalid_feed',
      'network',
    ]);
  });

  it('backs off on 429/503 inside a run and waits before the next one (AC4)', async () => {
    const date = (ms: number) => new Date(ms).toUTCString();
    const { call, add, clock } = await setup();
    const now = clock.now().getTime();

    serve(
      HN,
      HN_FREELANCE,
      { status: 503, headers: { 'retry-after': '5' } },
      { status: 503, headers: { 'retry-after': date(now + 3_000) } },
      { status: 200, body: HN_FEED },
    );
    const hn = await add('hn-freelance');
    expect((await call('POST', `/api/sources/${hn}/run`)).json()).toMatchObject({
      status: 'ok',
      new: 2,
    });
    expect(hits(HN, HN_FREELANCE)).toBe(3);

    // Every attempt answers 429: exactly SOURCE_MAX_ATTEMPTS requests, then the interval holds.
    serve(FORUM, FORUM_JOBS, { status: 429, headers: { 'retry-after': '10' } });
    const jobs = await add('arduino-jobs');
    const limited = await call('POST', `/api/sources/${jobs}/run`);
    expect(limited.json()).toMatchObject({
      status: 'failed',
      error: { reason: 'rate_limited', httpStatus: 429 },
      nextAllowedAt: new Date(now + HOUR).toISOString(),
    });
    expect(hits(FORUM, FORUM_JOBS)).toBe(3);

    // A long Retry-After stops at once and pushes the next attempt past the hour.
    serve(FL, FL_ARDUINO, { status: 429, headers: { 'retry-after': '7200' } });
    const wwr = await add('freelancer-arduino');
    const asked = await call('POST', `/api/sources/${wwr}/run`);
    expect(asked.json()).toMatchObject({
      error: { reason: 'rate_limited', httpStatus: 429 },
      nextAllowedAt: new Date(now + 2 * HOUR).toISOString(),
    });
    expect(hits(FL, FL_ARDUINO)).toBe(1);
    clock.advance(HOUR);
    expect((await call('POST', `/api/sources/${wwr}/run`)).statusCode).toBe(409);
    clock.advance(HOUR);
    serve(FL, FL_ARDUINO, { status: 200, body: WWR_FEED });
    expect((await call('POST', `/api/sources/${wwr}/run`)).json()).toMatchObject({ status: 'ok' });

    // A far-future Retry-After date is capped, so the run and the Sources view still answer.
    clock.advance(HOUR);
    serve(FL, FL_ARDUINO, {
      status: 429,
      headers: { 'retry-after': 'Sat, 01 Jan 12026 00:00:00 GMT' },
    });
    const capped = await call('POST', `/api/sources/${wwr}/run`);
    expect(capped.statusCode).toBe(200);
    expect(capped.json().nextAllowedAt).toBe(
      new Date(clock.now().getTime() + 7 * 24 * HOUR).toISOString(),
    );
    expect((await call('GET', '/api/sources')).statusCode).toBe(200);
  });

  it('checks health without storing signals, and a disabled source refuses runs (FR-18 AC3, D-15)', async () => {
    serve(FL, FL_ARDUINO, { status: 200, body: WWR_FEED });
    const { call, add, clock, db } = await setup();
    const id = await add('freelancer-arduino');

    const ok = await call('POST', `/api/sources/${id}/check`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, checkedAt: clock.now().toISOString() });
    expect(db().select().from(rawSignals).all()).toHaveLength(0);
    expect(db().select().from(jobRuns).all()).toHaveLength(0);
    // D-21: a check does not use up the discovery slot.
    expect((await call('POST', `/api/sources/${id}/run`)).json()).toMatchObject({ new: 2 });

    const successAt = db().select().from(sources).get()?.lastSuccessAt;
    clock.advance(HOUR);
    serve(FL, FL_ARDUINO, { status: 500 });
    const bad = await call('POST', `/api/sources/${id}/check`);
    expect(bad.json()).toMatchObject({
      ok: false,
      error: { reason: 'http_status', httpStatus: 500 },
    });
    const shown = (await call('GET', '/api/sources')).json().items[0];
    expect(shown.lastError).toMatchObject({ reason: 'http_status', httpStatus: 500 });
    expect(Date.parse(shown.lastSuccessAt)).toBe(successAt);
    expect((await call('POST', `/api/sources/${id}/check`)).statusCode).toBe(409);

    const off = await call('PATCH', `/api/sources/${id}`, { enabled: false });
    expect(off.json()).toMatchObject({ enabled: false });
    clock.advance(HOUR);
    expect((await call('POST', `/api/sources/${id}/run`)).json()).toEqual({ error: 'disabled' });
    expect((await call('POST', `/api/sources/${id}/check`)).statusCode).toBe(409);
    expect((await call('POST', '/api/sources/99/run')).statusCode).toBe(404);
    expect((await call('PATCH', '/api/sources/99', { enabled: true })).statusCode).toBe(404);
  });
  it('refuses a withdrawn preset but keeps an old source working with its access note (FR-04 AC2, AC7)', async () => {
    const { call, db, clock } = await setup();
    for (const preset of ['wwr-programming', 'hn-jobs-contract']) {
      const res = await call('POST', '/api/sources', { preset });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'unknown_preset' });
    }

    const at = clock.now().getTime();
    db()
      .insert(sources)
      .values({
        type: 'rss',
        name: 'We Work Remotely — Programming',
        configJson: JSON.stringify({ url: 'https://weworkremotely.com/categories/x.rss' }),
        configKey: 'https://weworkremotely.com/categories/x.rss',
        presetId: 'wwr-programming',
        createdAt: at,
        updatedAt: at,
      })
      .run();
    const list = (await call('GET', '/api/sources')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      presetId: 'wwr-programming',
      presetWithdrawn: true,
      termsUrl: 'https://weworkremotely.com/terms',
      filter: { enabled: false, include: [], exclude: [] },
    });
    expect(list.items[0].accessNote).toContain('We Work Remotely');
  });

  it('copies the preset filter on create and leaves a hand-added feed unfiltered (D-8)', async () => {
    const { call } = await setup();
    const hn = await call('POST', '/api/sources', { preset: 'hn-freelance' });
    expect(hn.statusCode).toBe(201);
    expect(hn.json()).toMatchObject({
      presetWithdrawn: false,
      filter: { enabled: true, include: [], exclude: ['SEEKING WORK'] },
    });
    const forum = await call('POST', '/api/sources', { preset: 'arduino-jobs' });
    expect(forum.json().filter).toEqual({
      enabled: true,
      include: [],
      exclude: ['[FOR HIRE]', 'looking for work'],
    });
    const fl = await call('POST', '/api/sources', { preset: 'freelancer-nodejs' });
    expect(fl.json().filter).toEqual({ enabled: false, include: [], exclude: [] });
    const manual = await call('POST', '/api/sources', {
      name: 'Mój kanał',
      url: 'https://feeds.example/jobs.xml',
    });
    expect(manual.json().filter).toEqual({ enabled: false, include: [], exclude: [] });
  });

  it('stores items the source filter drops as rejected and counts them (FR-31 AC1-AC3, D-4, D-5)', async () => {
    const item = (n: number, title: string, text: string) =>
      `<item><title>${title}</title><link>https://freelancer.example/p/${n}</link><guid>p${n}</guid><description>${text}</description></item>`;
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>DEMO</title>${[
      item(1, 'DEMO [FOR HIRE] Arduino dev', 'I am available'),
      item(2, 'DEMO Web shop', 'Need a shop built'),
      item(3, 'DEMO Arduino sensor hub', 'Need firmware for Arduino sensors'),
    ].join('')}</channel></rss>`;
    serve(FL, FL_ARDUINO, { status: 200, body: rss });
    serve(FL, FL_REACT, { status: 200, body: rss });
    const { call, add, clock, db, runner } = await setup();
    const id = await add('freelancer-arduino');
    expect(
      (
        await call('PATCH', `/api/sources/${id}`, {
          filter: { enabled: true, include: ['arduino'], exclude: ['[for hire]'] },
        })
      ).statusCode,
    ).toBe(200);

    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.json()).toMatchObject({ status: 'ok', fetched: 3, new: 3, filtered: 2 });

    const items = (await call('GET', '/api/opportunities')).json().items as {
      id: number;
      businessStatus: string;
      analysisStatus: string;
      prefilter: { rule: string; phrase: string | null } | null;
      source: { title: string };
    }[];
    const byTitle = (needle: string) => items.find((i) => i.source.title.includes(needle));
    expect(byTitle('[FOR HIRE]')).toMatchObject({
      businessStatus: 'REJECTED',
      analysisStatus: 'SKIPPED',
      prefilter: { rule: 'source_filter', phrase: '[for hire]' },
    });
    expect(byTitle('Web shop')).toMatchObject({
      businessStatus: 'REJECTED',
      prefilter: { rule: 'source_filter', phrase: null },
    });
    expect(byTitle('sensor hub')).toMatchObject({
      businessStatus: 'NEW',
      analysisStatus: 'PENDING',
    });

    const card = (await call('GET', `/api/opportunities/${byTitle('[FOR HIRE]')?.id}`)).json();
    expect(card.activity[0]).toMatchObject({
      actor: 'system',
      fromStatus: 'NEW',
      toStatus: 'REJECTED',
      cause: { kind: 'source_filter', phrase: '[for hire]' },
    });
    // The runner's own pre-filter runs on the item that passed; it never touches the other two.
    await runner.drain();
    const after = (await call('GET', '/api/opportunities')).json().items as typeof items;
    const rules = (needle: string) =>
      after.find((i) => i.source.title.includes(needle))?.prefilter?.rule;
    expect(rules('[FOR HIRE]')).toBe('source_filter');
    expect(rules('Web shop')).toBe('source_filter');
    expect(rules('sensor hub')).not.toBe('source_filter');
    expect(
      (await call('POST', `/api/opportunities/${byTitle('Web shop')?.id}/analysis`)).json(),
    ).toMatchObject({ error: 'prefiltered' });

    // A re-read finds everything in the cursor: nothing new, nothing filtered.
    clock.advance(2 * HOUR);
    expect((await call('POST', `/api/sources/${id}/run`)).json()).toMatchObject({
      new: 0,
      filtered: 0,
      duplicates: 3,
    });

    // Switching the filter off keeps the phrases and lets a new item through that the filter
    // would have dropped (FR-31 AC2).
    expect(
      (
        await call('PATCH', `/api/sources/${id}`, {
          filter: { enabled: false, include: ['arduino'], exclude: ['[for hire]'] },
        })
      ).statusCode,
    ).toBe(200);
    serve(FL, FL_ARDUINO, {
      status: 200,
      body: rss.replace(
        '</channel>',
        `${item(4, 'DEMO [FOR HIRE] Garden lights', 'Available for hire')}</channel>`,
      ),
    });
    clock.advance(2 * HOUR);
    expect((await call('POST', `/api/sources/${id}/run`)).json()).toMatchObject({
      new: 1,
      filtered: 0,
      duplicates: 3,
    });
    const garden = ((await call('GET', '/api/opportunities')).json().items as typeof items).find(
      (i) => i.source.title.includes('Garden lights'),
    );
    expect(garden).toMatchObject({ businessStatus: 'NEW', analysisStatus: 'PENDING' });
    expect(garden?.prefilter?.rule).not.toBe('source_filter');

    // The same feed on another source: the items already stored stay duplicates and keep their
    // status, so the first source to see a shared item decides it (D-4, D-19).
    const other = await add('freelancer-react');
    const second = await call('POST', `/api/sources/${other}/run`);
    expect(second.json()).toMatchObject({ new: 0, filtered: 0, duplicates: 3 });
    expect(db().select().from(rawSignals).all()).toHaveLength(4);
  });

  it('applies the HN default: a SEEKING WORK comment is stored as rejected by the source filter (plan-review #1)', async () => {
    serve(HN, HN_FREELANCE, { status: 200, body: HN_FEED });
    const { call, add } = await setup();
    const id = await add('hn-freelance');
    expect((await call('POST', `/api/sources/${id}/run`)).json()).toMatchObject({
      new: 2,
      filtered: 1,
    });
    const items = (await call('GET', '/api/opportunities')).json().items as {
      businessStatus: string;
      prefilter: { rule: string; phrase: string | null } | null;
    }[];
    expect(items.filter((i) => i.prefilter?.rule === 'source_filter')).toEqual([
      expect.objectContaining({
        businessStatus: 'REJECTED',
        prefilter: expect.objectContaining({ phrase: 'SEEKING WORK' }),
      }),
    ]);
  });

  it('edits the filter by PATCH: round-trips, off keeps the phrases, bad input is 400 (D-2, D-13, D-16)', async () => {
    const { call, add } = await setup();
    const id = await add('freelancer-arduino');
    const url = `/api/sources/${id}`;

    const set = { enabled: true, include: ['arduino'], exclude: ['[FOR HIRE]', 'wanted: job'] };
    const saved = await call('PATCH', url, { filter: set });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ enabled: true, filter: set });
    const listed = (await call('GET', '/api/sources')).json();
    expect(listed.items[0].filter).toEqual(set);

    const off = await call('PATCH', url, { filter: { ...set, enabled: false } });
    expect(off.json().filter).toEqual({ ...set, enabled: false });
    // `{ enabled }` alone still works and leaves the filter alone.
    const disabled = await call('PATCH', url, { enabled: false });
    expect(disabled.json()).toMatchObject({ enabled: false, filter: { ...set, enabled: false } });

    const bad: [string, object, string][] = [
      ['too long', { enabled: true, include: ['x'.repeat(101)], exclude: [] }, 'filter.include.0'],
      ['blank', { enabled: true, include: [], exclude: ['  '] }, 'filter.exclude.0'],
      ['duplicate', { enabled: true, include: ['A', 'a'], exclude: [] }, 'filter.include'],
      [
        'too many',
        { enabled: true, include: Array.from({ length: 31 }, (_, n) => `p${n}`), exclude: [] },
        'filter.include',
      ],
    ];
    for (const [, filter, path] of bad) {
      const res = await call('PATCH', url, { filter });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('validation_failed');
      expect(res.json().fields.map((f: { path: string }) => f.path)).toContain(path);
    }
    expect((await call('PATCH', url, {})).statusCode).toBe(400);
    // Nothing from the rejected bodies was stored.
    expect((await call('GET', '/api/sources')).json().items[0].filter).toEqual({
      ...set,
      enabled: false,
    });
  });
});
