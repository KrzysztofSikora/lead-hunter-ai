import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { opportunities, rawSignals } from '../src/infrastructure/db/schema.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const HOUR = 3_600_000;

async function setup() {
  const clock = new FakeClock();
  const built = await buildTestApp({ clock });
  const cookie = await loginAsOperator(built.app);
  const get = (url: string) => built.app.inject({ method: 'GET', url, headers: { cookie } });
  const importSignal = (payload: object) =>
    built.app.inject({ method: 'POST', url: '/api/signals/import', headers: { cookie }, payload });
  return { ...built, clock, get, importSignal };
}

describe('opportunity list (FR-11 AC1, FR-12 AC1)', () => {
  it('is honestly empty on a fresh database', async () => {
    const { get } = await setup();
    const res = await get('/api/opportunities');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      sources: { checked: 0, errors: [] },
    });
  });

  it('filters, sorts and paginates', async () => {
    const { get, importSignal, clock, dir } = await setup();
    const t0 = clock.now().getTime();
    await importSignal({ text: 'Pierwsze ogłoszenie', url: 'https://example.com/a' });
    clock.advance(HOUR);
    await importSignal({ text: 'Drugie ogłoszenie' });
    clock.advance(HOUR);
    await importSignal({ text: 'Trzecie ogłoszenie' });

    // Analysis does not exist yet (S-04): set its outputs directly.
    const { db } = openTestDb(dir);
    db.update(opportunities)
      .set({ score: 80, category: 'DIRECT_GIG', businessStatus: 'QUALIFIED' })
      .where(eq(opportunities.id, 1))
      .run();
    db.update(opportunities)
      .set({ score: 50, category: 'UNMET_NEED' })
      .where(eq(opportunities.id, 2))
      .run();

    const iso = (ms: number) => new Date(ms).toISOString();
    const matching = await get(
      `/api/opportunities?minScore=60&category=DIRECT_GIG&sourceType=manual_url&status=QUALIFIED` +
        `&from=${iso(t0 - 60_000)}&to=${iso(t0 + HOUR / 2)}`,
    );
    expect(matching.statusCode).toBe(200);
    const body = matching.json();
    expect(body.total).toBe(1);
    expect(body.items.map((i: { id: number }) => i.id)).toEqual([1]);
    expect(body.items[0].analysis).toEqual({
      category: 'DIRECT_GIG',
      evidenceLevel: null,
      score: 80,
      confidence: null,
      demo: false,
    });

    const byScore = await get('/api/opportunities?sort=score');
    expect(byScore.json().items.map((i: { id: number }) => i.id)).toEqual([1, 2, 3]);
    expect(byScore.json().items[2].analysis).toBeNull();

    const byDate = await get('/api/opportunities');
    expect(byDate.json().items.map((i: { id: number }) => i.id)).toEqual([3, 2, 1]);

    const page2 = await get('/api/opportunities?pageSize=2&page=2');
    expect(page2.json()).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page2.json().items.map((i: { id: number }) => i.id)).toEqual([1]);

    // `to` is exclusive; unscored rows never pass `minScore`.
    const exclusive = await get(`/api/opportunities?to=${iso(t0 + HOUR)}`);
    expect(exclusive.json().items.map((i: { id: number }) => i.id)).toEqual([1]);
    const scored = await get('/api/opportunities?minScore=0');
    expect(scored.json().total).toBe(2);
    // an empty value means "not given", not 0
    const empty = await get('/api/opportunities?minScore=&page=');
    expect(empty.json()).toMatchObject({ total: 3, page: 1 });

    const bad = await get('/api/opportunities?pageSize=0');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'validation_failed' });
  });
});

describe('opportunity detail (FR-06 AC3)', () => {
  it('separates source facts from analysis and keeps the pasted URL', async () => {
    const { get, importSignal } = await setup();
    const pasted = 'https://example.com/job?utm_source=x#top';
    await importSignal({ text: 'Szukam kogoś do API', url: pasted });

    const res = await get('/api/opportunities/1');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toMatchObject({
      type: 'manual_url',
      url: pasted,
      canonicalUrl: 'https://example.com/job',
      title: 'Szukam kogoś do API',
      snippet: 'Szukam kogoś do API',
      publishedAt: null,
      availability: 'NOT_CHECKED',
      lastVerifiedAt: null,
    });
    expect(body.analysis).toBeNull();
    expect(body).toMatchObject({ businessStatus: 'NEW', analysisStatus: 'PENDING' });
    expect(body.evidence).toHaveLength(1);
    expect(body.evidence[0]).toMatchObject({ type: 'IMPORT', url: pasted });

    const list = await get('/api/opportunities');
    expect(list.json().items[0].source.excerpt).toBe('Szukam kogoś do API');
  });

  it('answers 404 for an unknown id', async () => {
    const { get } = await setup();
    const res = await get('/api/opportunities/99');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});

describe('FR-10 AC6 filters (D-13)', () => {
  it('excludes a row only when its value is known and fails, and validates amount + currency', async () => {
    const { get, importSignal, dir, clock } = await setup();
    for (const text of ['Ogłoszenie A', 'Ogłoszenie B', 'Ogłoszenie C'])
      await importSignal({ text });

    const { db } = openTestDb(dir);
    const set = (id: number, change: Partial<typeof opportunities.$inferInsert>) =>
      db.update(opportunities).set(change).where(eq(opportunities.id, id)).run();
    // 1: known and matching, 2: known and failing, 3: everything unknown.
    set(1, {
      language: 'pl',
      workMode: 'REMOTE',
      countries: ',PL,DE,',
      industry: 'Fintech',
      amountMaxMinor: 900_000,
      amountCurrency: 'PLN',
    });
    set(2, {
      language: 'en',
      workMode: 'ONSITE',
      countries: ',US,',
      industry: 'Gaming',
      amountMaxMinor: 100_000,
      amountCurrency: 'PLN',
    });
    const ids = async (query: string) =>
      ((await get(`/api/opportunities?${query}&sort=date`)).json().items as { id: number }[])
        .map((i) => i.id)
        .sort();

    expect(await ids('language=pl')).toEqual([1, 3]);
    expect(await ids('workMode=REMOTE')).toEqual([1, 3]);
    expect(await ids('country=DE')).toEqual([1, 3]);
    expect(await ids('excludeIndustries=gaming,medtech')).toEqual([1, 3]);
    expect(await ids('minAmount=500000&currency=PLN')).toEqual([1, 3]);
    // another currency is not comparable, so the amount is treated as unknown
    expect(await ids('minAmount=500000&currency=EUR')).toEqual([1, 2, 3]);

    // age: the row published long ago is dropped, an unpublished one counts by fetch date
    const old = clock.now().getTime() - 40 * 86_400_000;
    db.update(rawSignals).set({ publishedAt: old }).where(eq(rawSignals.id, 2)).run();
    expect(await ids('maxAgeDays=30')).toEqual([1, 3]);
    expect(await ids('maxAgeDays=60')).toEqual([1, 2, 3]);

    expect((await get('/api/opportunities?minAmount=100')).statusCode).toBe(400);
    expect((await get('/api/opportunities?currency=PLN')).statusCode).toBe(400);
  });
});

describe('analysis in the DTOs (D-12)', () => {
  it('labels mock results as demo and exposes the latest analysis and the pre-filter outcome', async () => {
    const built = await buildTestApp({ env: { LLM_PROVIDER: 'mock' } });
    const cookie = await loginAsOperator(built.app);
    const post = async (text: string) =>
      (
        await built.app.inject({
          method: 'POST',
          url: '/api/signals/import',
          headers: { cookie },
          payload: { text },
        })
      ).json<{ opportunityId: number }>().opportunityId;
    const analysed = await post(
      'DEMO: Szukamy programisty TypeScript do narzędzia wewnętrznego, budżet 5000 PLN, zapłacimy za wykonanie.',
    );
    const skipped = await post('SEEKING WORK: TypeScript developer available for hire, DEMO.');
    await built.runner.drain();

    const get = (url: string) => built.app.inject({ method: 'GET', url, headers: { cookie } });
    const list = (await get('/api/opportunities')).json();
    const byId = (id: number) => list.items.find((i: { id: number }) => i.id === id);
    expect(byId(analysed).analysis.demo).toBe(true);
    expect(byId(analysed).prefilter).toMatchObject({ rule: null });
    expect(byId(skipped)).toMatchObject({
      analysisStatus: 'SKIPPED',
      analysis: null,
      prefilter: { rule: 'seeking_work' },
    });

    const detail = (await get(`/api/opportunities/${analysed}`)).json();
    expect(detail.latestAnalysis).toMatchObject({
      status: 'COMPLETE',
      provider: 'mock',
      demo: true,
      schemaVersion: 1,
      result: { verdict: 'ANALYSED' },
    });
    expect(detail.latestAnalysis.breakdown.components).toHaveLength(5);
    expect(detail.analysis.score).toBe(detail.latestAnalysis.breakdown.total);

    const skippedDetail = (await get(`/api/opportunities/${skipped}`)).json();
    expect(skippedDetail.latestAnalysis).toBeNull();
    expect(skippedDetail.prefilter.rule).toBe('seeking_work');
  });

  it('labels an INSUFFICIENT_DATA mock result as demo although it has no score', async () => {
    const built = await buildTestApp({ env: { LLM_PROVIDER: 'mock' } });
    const cookie = await loginAsOperator(built.app);
    const { opportunityId } = (
      await built.app.inject({
        method: 'POST',
        url: '/api/signals/import',
        headers: { cookie },
        payload: { text: 'DEMO: Szukam programisty do sterownika IoT.' },
      })
    ).json<{ opportunityId: number }>();
    await built.runner.drain();
    const list = (
      await built.app.inject({ method: 'GET', url: '/api/opportunities', headers: { cookie } })
    ).json();
    expect(list.items.find((i: { id: number }) => i.id === opportunityId)).toMatchObject({
      analysisStatus: 'COMPLETE',
      analysis: { score: null, demo: true },
    });
  });
});
