import { describe, expect, it } from 'vitest';
import type { Insights, OpportunityDetail } from '@lead-hunter/contracts';
import {
  activityEvents,
  opportunities,
  rawSignals,
  signalIdentities,
  sources,
} from '../src/infrastructure/db/schema.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Monday of 2026-W44 (26 Oct – 1 Nov), 11:00 in Warsaw. */
const MONDAY = new Date('2026-10-26T10:00:00Z');

async function setup() {
  const clock = new FakeClock(MONDAY);
  const built = await buildTestApp({ clock, env: { LLM_PROVIDER: 'mock' } });
  const cookie = await loginAsOperator(built.app);
  const { db } = openTestDb(built.dir);
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const insights = async (query = '') =>
    (await call('GET', `/api/insights${query}`)).json<Insights>();

  let n = 0;
  const addSource = (name: string) =>
    db
      .insert(sources)
      .values({
        type: 'rss',
        name,
        configJson: '{}',
        configKey: `https://example.invalid/${name}`,
        createdAt: MONDAY.getTime(),
        updatedAt: MONDAY.getTime(),
      })
      .returning({ id: sources.id })
      .get().id;
  const signal = (sourceId: number | null) => {
    n += 1;
    return db
      .insert(rawSignals)
      .values({
        sourceType: sourceId === null ? 'manual_text' : 'rss',
        sourceId,
        title: `DEMO ${n}`,
        snippet: 'DEMO',
        fetchedAt: MONDAY.getTime(),
        availability: 'NOT_CHECKED',
        canonicalUrl: `https://example.invalid/${n}`,
      })
      .returning({ id: rawSignals.id })
      .get().id;
  };
  /** An opportunity the operator has saved, owned by `sourceId`'s signal. */
  const seed = (sourceId: number, category: string | null, status = 'SAVED') =>
    db
      .insert(opportunities)
      .values({
        primarySignalId: signal(sourceId),
        businessStatus: status,
        category,
        createdAt: MONDAY.getTime(),
        updatedAt: MONDAY.getTime(),
      })
      .returning({ id: opportunities.id })
      .get().id;
  const move = async (id: number, status: string, extra: object = {}) => {
    clock.advance(1000);
    const res = await call('POST', `/api/opportunities/${id}/status`, { status, ...extra });
    expect(res.statusCode).toBe(200);
  };
  const pay = async (id: number, amountMinor: number, currency: string, paidOn: string) => {
    const res = await call('POST', `/api/opportunities/${id}/payments`, {
      amountMinor,
      currency,
      paidOn,
    });
    expect(res.statusCode).toBe(200);
  };
  return { ...built, clock, call, insights, db, addSource, seed, signal, move, pay, cookie };
}

describe('GET /api/insights (FR-19)', () => {
  it('answers an empty week with true zeros and nulls, and refuses bad periods (AC2)', async () => {
    const t = await setup();
    const empty = await t.insights();
    expect(empty.period).toEqual({
      kind: 'week',
      key: '2026-W44',
      from: '2026-10-26',
      to: '2026-11-01',
      previous: '2026-W43',
      next: '2026-W45',
      current: true,
    });
    expect(empty.totals).toEqual({
      transitions: 0,
      offersSent: 0,
      contacted: 0,
      replies: { replied: 0, noReply: 0, awaiting: 0, rate: null },
      meetings: 0,
      wins: 0,
      payments: { count: 0, sums: [] },
    });
    expect(empty).toMatchObject({
      transitionsTo: [],
      bySource: [],
      byCategory: [],
      work: { minutes: null, costs: [], net: [] },
    });

    const past = await t.insights('?week=2026-W53');
    expect(past.period).toMatchObject({ from: '2026-12-28', to: '2027-01-03', next: '2027-W01' });
    expect((await t.insights('?month=2026-12')).period).toMatchObject({
      to: '2026-12-31',
      next: '2027-01',
      previous: '2026-11',
      current: false,
    });
    expect((await t.insights('?week=2000-W01')).period.previous).toBeNull();

    for (const query of ['?week=2026-W54', '?week=2027-W53', '?week=2026-W44&month=2026-10']) {
      expect((await t.call('GET', `/api/insights${query}`)).statusCode).toBe(400);
    }
    expect((await t.call('GET', '/api/insights?month=2026-13')).statusCode).toBe(400);
    expect((await t.call('GET', '/api/insights?week=1999-W10')).statusCode).toBe(400);
  });

  it('counts the funnel of a week per source and category, and sums money per currency (AC1, AC3)', async () => {
    const t = await setup();
    const feedA = t.addSource('Feed A');
    const feedB = t.addSource('Feed B');
    const won = t.seed(feedA, 'DIRECT_GIG');
    const lost = t.seed(feedB, 'HARDWARE_IOT');
    const waiting = t.seed(feedB, null);

    await t.move(won, 'CONTACTED');
    await t.move(won, 'REPLIED');
    await t.move(won, 'MEETING');
    await t.move(won, 'WON');
    await t.move(lost, 'CONTACTED');
    await t.move(lost, 'LOST');
    await t.move(waiting, 'CONTACTED');

    // A pre-filter rejection is the system's move, not a sales step (D-2).
    const rejected = t.seed(feedA, null, 'REJECTED');
    t.db
      .insert(activityEvents)
      .values({
        opportunityId: rejected,
        type: 'STATUS_CHANGE',
        actor: 'system',
        fromStatus: 'NEW',
        toStatus: 'REJECTED',
        occurredAt: t.clock.now().getTime(),
      })
      .run();

    // A manual import whose draft is sent by hand: both an offer sent and a contact (D-3).
    const imported = await t.call('POST', '/api/signals/import', {
      text: 'DEMO: Szukamy programisty TypeScript. Budżet 6000-9000 PLN.',
    });
    const manual = imported.json<{ opportunityId: number }>().opportunityId;
    const draft = (
      await t.call('POST', `/api/opportunities/${manual}/offer-drafts`)
    ).json<OpportunityDetail>().offerDraft!;
    await t.call('PATCH', `/api/offer-drafts/${draft.id}`, {
      action: 'save',
      subject: draft.subject,
      message: 'Treść.',
      proposal: draft.proposal,
    });
    await t.call('PATCH', `/api/offer-drafts/${draft.id}`, { action: 'copied' });
    expect(
      (await t.call('PATCH', `/api/offer-drafts/${draft.id}`, { action: 'sent' })).statusCode,
    ).toBe(200);

    await t.pay(won, 100_000, 'PLN', '2026-10-26');
    t.clock.advance(5 * DAY); // payments cannot be dated in the future: Saturday 31 October
    await t.pay(won, 50_000, 'PLN', '2026-10-31');
    t.clock.advance(DAY); // Sunday 1 November
    await t.pay(manual, 20_000, 'EUR', '2026-11-01');

    const week = await t.insights();
    expect(week.totals).toEqual({
      transitions: 9,
      offersSent: 1,
      contacted: 4,
      replies: { replied: 1, noReply: 1, awaiting: 2, rate: 0.5 },
      meetings: 1,
      wins: 1,
      payments: {
        count: 3,
        sums: [
          { currency: 'EUR', totalMinor: 20_000 },
          { currency: 'PLN', totalMinor: 150_000 },
        ],
      },
    });
    expect(week.transitionsTo).toEqual([
      { status: 'OFFER_DRAFTED', count: 1 },
      { status: 'CONTACTED', count: 4 },
      { status: 'REPLIED', count: 1 },
      { status: 'MEETING', count: 1 },
      { status: 'WON', count: 1 },
      { status: 'LOST', count: 1 },
    ]);

    expect(week.bySource.map((g) => g.source)).toEqual([
      { kind: 'source', id: feedA, name: 'Feed A', type: 'rss' },
      { kind: 'source', id: feedB, name: 'Feed B', type: 'rss' },
      { kind: 'manual' },
    ]);
    const [a, b, m] = week.bySource.map((g) => g.metrics);
    expect(a).toMatchObject({
      transitions: 4,
      contacted: 1,
      replies: { replied: 1, noReply: 0, awaiting: 0, rate: 1 },
      wins: 1,
      payments: { count: 2, sums: [{ currency: 'PLN', totalMinor: 150_000 }] },
    });
    expect(b).toMatchObject({
      transitions: 3,
      contacted: 2,
      replies: { replied: 0, noReply: 1, awaiting: 1, rate: 0 },
    });
    expect(m).toMatchObject({
      transitions: 2,
      offersSent: 1,
      contacted: 1,
      replies: { replied: 0, noReply: 0, awaiting: 1, rate: null },
      payments: { count: 1, sums: [{ currency: 'EUR', totalMinor: 20_000 }] },
    });
    expect(week.byCategory.map((g) => g.category)).toEqual(['DIRECT_GIG', 'HARDWARE_IOT', null]);
    // Every opportunity is in exactly one group, so the groups add up to the totals (D-8, D-9).
    for (const groups of [week.bySource, week.byCategory]) {
      const sum = (pick: (m: Insights['totals']) => number) =>
        groups.reduce((total, g) => total + pick(g.metrics), 0);
      expect(sum((x) => x.transitions)).toBe(week.totals.transitions);
      expect(sum((x) => x.contacted)).toBe(week.totals.contacted);
      expect(sum((x) => x.payments.count)).toBe(week.totals.payments.count);
    }

    // The week spans two months: each month sums only its own payments.
    const october = await t.insights('?month=2026-10');
    expect(october.period).toMatchObject({ key: '2026-10', from: '2026-10-01', to: '2026-10-31' });
    expect(october.totals.payments).toEqual({
      count: 2,
      sums: [{ currency: 'PLN', totalMinor: 150_000 }],
    });
    expect(october.totals.transitions).toBe(9);
    const november = await t.insights('?month=2026-11');
    expect(november.totals.payments).toEqual({
      count: 1,
      sums: [{ currency: 'EUR', totalMinor: 20_000 }],
    });
    expect(november.totals.transitions).toBe(0);
    expect(november.period.current).toBe(true);
    expect((await t.insights('?week=2026-W43')).totals.payments.sums).toEqual([]);
  });

  it('attributes an opportunity to its primary source only and drops a corrected win (D-5, D-8)', async () => {
    const t = await setup();
    const feedA = t.addSource('Feed A');
    const feedB = t.addSource('Feed B');
    const id = t.seed(feedA, 'DIRECT_GIG');
    // Feed B saw the same item later; it attaches to the opportunity of Feed A.
    t.db
      .insert(signalIdentities)
      .values({
        kind: 'canonical_url',
        value: 'https://example.invalid/b',
        opportunityId: id,
        createdAt: 1,
      })
      .run();
    t.signal(feedB);

    await t.move(id, 'CONTACTED');
    await t.move(id, 'WON');
    expect((await t.insights()).totals.wins).toBe(1);

    const corrected = await t.insights();
    expect(corrected.bySource.map((g) => g.source)).toEqual([
      { kind: 'source', id: feedA, name: 'Feed A', type: 'rss' },
    ]);

    await t.move(id, 'LOST', { note: 'klient się wycofał' });
    const after = await t.insights();
    expect(after.totals.wins).toBe(0);
    expect(after.totals.transitions).toBe(3);
    expect(after.bySource).toHaveLength(1);
  });
});
