import { getTableName, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { LlmProvider, AnalysisInput } from '../src/modules/analysis/ports.js';
import { ProviderError } from '../src/modules/analysis/ports.js';
import { createAnalysisRepository } from '../src/infrastructure/db/analysis-repository.js';
import { createDataRepository } from '../src/infrastructure/db/data-repository.js';
import { createOfferDraftRepository } from '../src/infrastructure/db/offer-draft-repository.js';
import { MockProvider } from '../src/infrastructure/llm/mock.js';
import {
  activityEvents,
  analyses,
  deletedUsage,
  offerDrafts,
  opportunities,
  opportunityEvidence,
  payments,
  rawSignals,
  signalIdentities,
} from '../src/infrastructure/db/schema.js';
import type { OfferDrafter, OfferInput } from '../src/modules/offers/ports.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const POST =
  'DEMO: Szukamy programisty TypeScript do narzędzia wewnętrznego, zapłacimy za wykonanie. Budżet 6000-9000 PLN, kontakt przez portal.';
const OTHER =
  'DEMO: Potrzebujemy automatyzacji arkuszy księgowych w Pythonie, budżet 3000 PLN, zapytanie przez formularz.';
const URL_A = 'https://example.com/ogloszenie/1';

async function setup(options: Parameters<typeof buildTestApp>[0] = {}) {
  const clock = (options.clock as FakeClock | undefined) ?? new FakeClock();
  const built = await buildTestApp({ clock, env: { LLM_PROVIDER: 'mock' }, ...options });
  const cookie = await loginAsOperator(built.app);
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const importText = async (text: string, url?: string) => {
    const res = await call('POST', '/api/signals/import', { text, ...(url ? { url } : {}) });
    return res.json<{ opportunityId: number; result: string }>();
  };
  const db = () => openTestDb(built.dir).db;
  const remove = (id: number) => call('DELETE', `/api/opportunities/${id}`);
  return { ...built, clock, call, importText, db, remove };
}

describe('deleting an opportunity (FR-21 AC1)', () => {
  it('removes the opportunity with everything it owns and nothing else', async () => {
    const t = await setup();
    const first = (await t.importText(POST, URL_A)).opportunityId;
    // A real duplicate adds the second evidence row, as production does.
    const dup = await t.importText('Inna treść tego samego ogłoszenia', URL_A);
    expect(dup.result).toBe('duplicate');
    const other = (await t.importText(OTHER)).opportunityId;
    await t.runner.drain();
    await t.call('POST', `/api/opportunities/${first}/status`, { status: 'SAVED' });
    await t.call('POST', `/api/opportunities/${first}/status`, { status: 'CONTACTED' });
    await t.call('POST', `/api/opportunities/${first}/notes`, { note: 'DEMO notatka' });
    await t.call('PUT', `/api/opportunities/${first}/follow-up`, { on: '2026-01-05' });
    expect(
      (
        await t.call('POST', `/api/opportunities/${first}/payments`, {
          amountMinor: 10_000,
          currency: 'PLN',
          paidOn: '2026-01-01',
        })
      ).statusCode,
    ).toBe(200);
    expect((await t.call('POST', `/api/opportunities/${first}/offer-drafts`)).statusCode).toBe(201);
    const db = t.db();
    // A failed analysis next to the completed one.
    db.insert(analyses)
      .values({
        opportunityId: first,
        status: 'FAILED',
        provider: 'mock',
        model: 'mock',
        promptVersion: 'x',
        schemaVersion: 1,
        error: 'DEMO',
        createdAt: 1,
      })
      .run();

    const owned = (id: number) => ({
      analyses: db
        .select()
        .from(analyses)
        .where(sql`opportunity_id = ${id}`)
        .all().length,
      drafts: db
        .select()
        .from(offerDrafts)
        .where(sql`opportunity_id = ${id}`)
        .all().length,
      events: db
        .select()
        .from(activityEvents)
        .where(sql`opportunity_id = ${id}`)
        .all().length,
      evidence: db
        .select()
        .from(opportunityEvidence)
        .where(sql`opportunity_id = ${id}`)
        .all().length,
      identities: db
        .select()
        .from(signalIdentities)
        .where(sql`opportunity_id = ${id}`)
        .all().length,
      payments: db
        .select()
        .from(payments)
        .where(sql`opportunity_id = ${id}`)
        .all().length,
    });
    const before = owned(first);
    for (const [name, value] of Object.entries(before)) {
      expect(value, name).toBeGreaterThan(0);
    }
    expect(before.evidence).toBe(2);
    const otherBefore = owned(other);
    expect(db.select().from(rawSignals).all()).toHaveLength(2);

    const res = await t.remove(first);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');

    expect(owned(first)).toEqual({
      analyses: 0,
      drafts: 0,
      events: 0,
      evidence: 0,
      identities: 0,
      payments: 0,
    });
    expect(owned(other)).toEqual(otherBefore);
    expect(
      db
        .select()
        .from(opportunities)
        .all()
        .map((o) => o.id),
    ).toEqual([other]);
    expect(db.select().from(rawSignals).all()).toHaveLength(1);
    expect((await t.call('GET', `/api/opportunities/${first}`)).statusCode).toBe(404);
    expect((await t.remove(first)).statusCode).toBe(404);
    expect((await t.remove(999)).statusCode).toBe(404);
    expect((await t.call('DELETE', '/api/opportunities/abc')).statusCode).toBe(400);
  });

  it('brings the same text back as a new opportunity (D-3)', async () => {
    const t = await setup();
    const first = (await t.importText(POST)).opportunityId;
    expect((await t.remove(first)).statusCode).toBe(204);
    const again = await t.importText(POST);
    expect(again.result).toBe('created');
    expect(again.opportunityId).not.toBe(first);
  });

  it('needs a session', async () => {
    const t = await setup();
    const res = await t.app.inject({ method: 'DELETE', url: '/api/opportunities/1' });
    expect(res.statusCode).toBe(401);
  });
});

describe('deleting keeps the month spend and the daily counts (D-1)', () => {
  const MONTH_START = Date.UTC(2025, 11, 31, 23); // Warsaw 2026-01-01
  const THIS_MONTH = Date.UTC(2026, 0, 10);
  const LAST_MONTH = Date.UTC(2025, 11, 10);

  it('copies only this month and leaves limits and spend as they were', () => {
    const { db } = openTestDb();
    const raw = db
      .insert(rawSignals)
      .values({
        sourceType: 'MANUAL_IMPORT',
        title: 'DEMO',
        snippet: 'DEMO',
        fetchedAt: 1,
        availability: 'UNKNOWN',
      })
      .returning({ id: rawSignals.id })
      .get();
    const opp = db
      .insert(opportunities)
      .values({
        primarySignalId: raw.id,
        businessStatus: 'NEW',
        analysisStatus: 'COMPLETE',
        createdAt: 1,
        updatedAt: 1,
      })
      .returning({ id: opportunities.id })
      .get();
    const analysis = (over: Partial<typeof analyses.$inferInsert>) =>
      db
        .insert(analyses)
        .values({
          opportunityId: opp.id,
          status: 'COMPLETE',
          provider: 'anthropic',
          model: 'm',
          promptVersion: 'p',
          schemaVersion: 1,
          createdAt: THIS_MONTH,
          ...over,
        })
        .returning({ id: analyses.id })
        .get().id;
    const source = analysis({ costMicroUsd: 1000 });
    analysis({ costMicroUsd: null }); // billed, cost unknown
    analysis({ costMicroUsd: 0, reusedFromAnalysisId: source }); // reuse: not a provider call
    analysis({ status: 'FAILED', costMicroUsd: 500 });
    analysis({ costMicroUsd: 9999, createdAt: LAST_MONTH });
    const draft = (over: Partial<typeof offerDrafts.$inferInsert>) =>
      db
        .insert(offerDrafts)
        .values({
          opportunityId: opp.id,
          status: 'DRAFT',
          language: 'pl',
          subject: 'DEMO',
          messageMarkdown: 'DEMO',
          proposalMarkdown: 'DEMO',
          provider: 'anthropic',
          model: 'm',
          promptVersion: 'o',
          schemaVersion: 1,
          costMicroUsd: 2000,
          createdAt: THIS_MONTH,
          updatedAt: THIS_MONTH,
          statusChangedAt: THIS_MONTH,
          ...over,
        })
        .run();
    draft({});
    draft({ costMicroUsd: null }); // unknown cost
    draft({ status: 'FAILED', costMicroUsd: null }); // failed: never "unknown"
    draft({ costMicroUsd: 7777, createdAt: LAST_MONTH, updatedAt: LAST_MONTH });

    const analysisRepo = createAnalysisRepository(db);
    const draftRepo = createOfferDraftRepository(db);
    const read = () => ({
      spent: analysisRepo.spentSince(MONTH_START),
      analysesToday: analysisRepo.countSince(MONTH_START),
      draftsToday: draftRepo.countSince(MONTH_START),
    });
    const before = read();
    expect(before).toEqual({
      spent: { microUsd: 1000 + 0 + 500 + 2000, unknownCount: 2 },
      analysesToday: 3,
      draftsToday: 3,
    });

    expect(createDataRepository(db).deleteOpportunity(opp.id, MONTH_START)).toBe(true);

    expect(db.select().from(analyses).all()).toHaveLength(0);
    expect(db.select().from(offerDrafts).all()).toHaveLength(0);
    expect(read()).toEqual(before);
    // 4 analyses + 3 drafts of this month; last month's rows are not copied.
    expect(db.select().from(deletedUsage).all()).toHaveLength(7);
    // A window that starts later than the copied rows sees none of them.
    expect(analysisRepo.spentSince(THIS_MONTH + 1)).toEqual({ microUsd: 0, unknownCount: 0 });
  });
});

describe('a provider call that ends after the delete (D-2)', () => {
  it('stores no analysis, does not throw, and still counts the billed answer', async () => {
    let remove: () => Promise<unknown> = async () => undefined;
    const mock = new MockProvider();
    const provider: LlmProvider = {
      name: 'mock',
      model: 'holding',
      promptVersion: 'holding-1',
      demo: true,
      paid: false,
      timeoutMs: 0,
      async analyzeOpportunity(input: AnalysisInput, ...rest) {
        await remove();
        return mock.analyzeOpportunity(input, ...rest);
      },
    } as LlmProvider;
    const t = await setup({ provider });
    const id = (await t.importText(POST)).opportunityId;
    remove = () => t.remove(id);

    await expect(t.runner.drain()).resolves.toBeUndefined();

    const db = t.db();
    expect(db.select().from(opportunities).all()).toHaveLength(0);
    expect(db.select().from(analyses).all()).toHaveLength(0);
    expect(db.select().from(deletedUsage).all()).toMatchObject([
      { kind: 'analysis', counted: 1, unknownCost: 0 },
    ]);
    expect(createAnalysisRepository(db).countSince(0)).toBe(1);
  });

  const drafterThatDeletes = (
    remove: () => Promise<unknown>,
    outcome: 'draft' | 'error',
  ): OfferDrafter => {
    const mock = new MockProvider();
    return {
      name: 'mock',
      paid: false,
      model: 'holding',
      offerPromptVersion: 'offer-1',
      demo: true,
      async draftOffer(input: OfferInput) {
        await remove();
        if (outcome === 'error')
          throw new ProviderError('refusal', undefined, {
            inputTokens: 10,
            outputTokens: 5,
          });
        return mock.draftOffer(input);
      },
    };
  };

  it.each(['draft', 'error'] as const)(
    'answers 404, stores no draft and keeps the usage (%s)',
    async (outcome) => {
      let remove: () => Promise<unknown> = async () => undefined;
      const t = await setup({ drafter: drafterThatDeletes(() => remove(), outcome) });
      const id = (await t.importText(POST)).opportunityId;
      await t.runner.drain();
      remove = () => t.remove(id);

      const res = await t.call('POST', `/api/opportunities/${id}/offer-drafts`);
      expect(res.statusCode).toBe(404);

      const db = t.db();
      expect(db.select().from(offerDrafts).all()).toHaveLength(0);
      expect(
        db
          .select()
          .from(deletedUsage)
          .all()
          .filter((row) => row.kind === 'offer_draft'),
      ).toMatchObject([{ counted: 1 }]);
      expect(createOfferDraftRepository(db).countSince(0)).toBe(1);
    },
  );
});

describe('schema', () => {
  it('deleted_usage is the table the queries read', () => {
    expect(getTableName(deletedUsage)).toBe('deleted_usage');
  });
});
