import { ANALYSIS_SCHEMA_VERSION } from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import { analyses, opportunities, rawSignals, sources } from '../src/infrastructure/db/schema.js';
import { analysis } from './helpers/analysis.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const HOUR = 3_600_000;
// FakeClock starts at 2026-01-01T12:00Z; Warsaw midnight of that day is 2025-12-31T23:00Z.
const NOW = new Date('2026-01-01T12:00:00Z').getTime();
const TODAY = new Date('2025-12-31T23:00:00Z').getTime();

async function setup() {
  const clock = new FakeClock();
  const built = await buildTestApp({ clock });
  const cookie = await loginAsOperator(built.app);
  const { db } = openTestDb(built.dir);
  const today = (query = '') =>
    built.app.inject({ method: 'GET', url: `/api/digest/today${query}`, headers: { cookie } });

  let signal = 0;
  const seed = (
    row: {
      title: string;
      category?: string | null;
      evidenceLevel?: string | null;
      score?: number | null;
      status?: string;
      createdAt?: number;
      buyer?: string | null;
      nextAction?: string;
      followUpAt?: number;
    },
    tokens?: { input: number; output: number },
  ): number => {
    signal += 1;
    const createdAt = row.createdAt ?? NOW - HOUR;
    const raw = db
      .insert(rawSignals)
      .values({
        sourceType: 'MANUAL_IMPORT',
        title: row.title,
        snippet: 'DEMO',
        fetchedAt: createdAt,
        availability: 'UNKNOWN',
        canonicalUrl: `https://example.invalid/${signal}`,
      })
      .returning({ id: rawSignals.id })
      .get();
    const opp = db
      .insert(opportunities)
      .values({
        primarySignalId: raw.id,
        businessStatus: row.status ?? 'NEW',
        analysisStatus: 'COMPLETE',
        category: row.category === undefined ? 'DIRECT_GIG' : row.category,
        evidenceLevel: row.evidenceLevel === undefined ? 'DIRECT_REQUEST' : row.evidenceLevel,
        score: row.score === undefined ? 80 : row.score,
        createdAt,
        updatedAt: createdAt,
        analysisProvider: 'mock',
        followUpAt: row.followUpAt ?? null,
      })
      .returning({ id: opportunities.id })
      .get();
    db.insert(analyses)
      .values({
        opportunityId: opp.id,
        status: 'COMPLETE',
        provider: 'mock',
        model: 'mock',
        promptVersion: 'test',
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        resultJson: JSON.stringify(
          analysis({
            buyerOrAudience: row.buyer ?? null,
            nextAction: row.nextAction ?? 'DEMO krok',
          }),
        ),
        inputTokens: tokens?.input ?? null,
        outputTokens: tokens?.output ?? null,
        createdAt,
      })
      .run();
    return opp.id;
  };
  const addSource = (name: string, values: Partial<typeof sources.$inferInsert> = {}) =>
    db
      .insert(sources)
      .values({
        type: 'RSS',
        name,
        configJson: '{}',
        configKey: `https://example.invalid/${name}`,
        createdAt: NOW,
        updatedAt: NOW,
        ...values,
      })
      .run();
  return { today, seed, addSource, db };
}

describe('GET /api/digest/today (FR-16)', () => {
  it('answers an empty, honest brief on a fresh database (FR-12 AC1, FR-16 AC1)', async () => {
    const t = await setup();
    const res = await t.today();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      date: '2026-01-01',
      minScore: 65,
      sources: { ok: 0, error: 0, notChecked: 0, errors: [] },
      newSignals: 0,
      newAboveThreshold: 0,
      top: [],
      bestNextStep: null,
      followUpsDue: [],
      llm: { analyses: 0, inputTokens: null, outputTokens: null },
      weakSignals: [],
    });
  });

  it('builds the brief of a seeded day (FR-16 AC1–AC3, FR-14 AC4)', async () => {
    const t = await setup();
    t.addSource('ok-feed', { lastAttemptAt: NOW - HOUR, lastSuccessAt: NOW - HOUR });
    t.addSource('broken-feed', {
      lastAttemptAt: NOW - HOUR,
      lastErrorReason: 'http_status',
      lastErrorStatus: 500,
      lastErrorAt: NOW - HOUR,
    });
    t.addSource('new-feed');
    t.addSource('off-feed', { enabled: false, lastErrorReason: 'timeout', lastErrorAt: NOW });

    const dup = 'DEMO Szukam programisty do sklepu internetowego Shopify';
    const dup1 = t.seed(
      { title: dup, score: 90, nextAction: 'DEMO napisz do klienta' },
      { input: 1000, output: 200 },
    );
    const dup2 = t.seed({ title: `${dup}!`, score: 89 }, { input: 500, output: 100 });
    const dup3 = t.seed({ title: `${dup}?`, score: 88 });
    const lower = t.seed({ title: 'DEMO Potrzebny audyt SEO dla sklepu', score: 66 });
    const problem = t.seed({
      title: 'DEMO Firma traci czas na ręczne fakturowanie',
      evidenceLevel: 'EXPLICIT_PROBLEM',
      score: 95,
    });
    const hypothesis = t.seed({
      title: 'DEMO Aplikacja dla warsztatów',
      category: 'PRODUCT_HYPOTHESIS',
      evidenceLevel: 'EXPLICIT_PROBLEM',
      score: 70,
    });
    const speculative = t.seed({
      title: 'DEMO Może ktoś potrzebuje bota',
      evidenceLevel: 'SPECULATIVE',
      score: 40,
    });
    const old = t.seed({ title: 'DEMO Stare zlecenie', createdAt: NOW - 8 * 24 * HOUR });
    const contacted = t.seed({
      title: 'DEMO Klient czeka na ofertę',
      status: 'CONTACTED',
      followUpAt: TODAY,
    });
    const insufficient = t.seed({
      title: 'DEMO Za mało danych',
      category: null,
      evidenceLevel: null,
      score: null,
      status: 'QUALIFIED',
    });

    const res = await t.today();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sources).toMatchObject({ ok: 1, error: 1, notChecked: 1 });
    expect(body.sources.errors).toHaveLength(1);
    expect(body.sources.errors[0]).toMatchObject({ source: 'broken-feed', httpStatus: 500 });
    expect(body.newSignals).toBe(9);
    // main section, today, score >= 65: 3 duplicates + lower + problem + contacted (any status); the hypothesis is weak
    expect(body.newAboveThreshold).toBe(6);

    const ids = body.top.map((item: { id: number }) => item.id);
    expect(ids).toEqual([dup1, dup2, lower, problem]);
    expect(ids).not.toContain(dup3);
    expect(body.top[0]).toMatchObject({
      nextAction: 'DEMO napisz do klienta',
      demo: true,
      score: 90,
    });
    expect(body.weakSignals.map((item: { id: number }) => item.id)).toEqual([
      hypothesis,
      speculative,
    ]);
    for (const id of [old, insufficient, contacted])
      expect([...ids, hypothesis, speculative]).not.toContain(id);

    expect(body.followUpsDue.map((item: { id: number }) => item.id)).toEqual([contacted]);
    expect(body.bestNextStep).toMatchObject({ kind: 'follow_up', opportunityId: contacted });
    expect(body.llm).toEqual({ analyses: 9, inputTokens: 1500, outputTokens: 300 });
  });

  it('survives a completed row without a score moved to QUALIFIED (plan-review 1)', async () => {
    const t = await setup();
    t.seed({
      title: 'DEMO Bez wyniku',
      category: null,
      evidenceLevel: null,
      score: null,
      status: 'SAVED',
    });
    const res = await t.today();
    expect(res.statusCode).toBe(200);
    expect(res.json().top).toEqual([]);
  });

  it('applies minScore and rejects a bad one (FR-10 AC6, minimum score only)', async () => {
    const t = await setup();
    t.seed({ title: 'DEMO alfa bravo charlie', score: 92 });
    t.seed({ title: 'DEMO delta echo foxtrot', score: 70 });

    const strict = (await t.today('?minScore=90')).json();
    expect(strict.minScore).toBe(90);
    expect(strict.top).toHaveLength(1);
    expect(strict.newAboveThreshold).toBe(1);

    expect((await t.today('?minScore=')).json().minScore).toBe(65);
    expect((await t.today('?minScore=abc')).statusCode).toBe(400);
  });
});
