import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { opportunities } from '../src/infrastructure/db/schema.js';
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
