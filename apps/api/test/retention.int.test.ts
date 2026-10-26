import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDataRepository } from '../src/infrastructure/db/data-repository.js';
import {
  activityEvents,
  analyses,
  opportunities,
  opportunityEvidence,
  payments,
  rawSignals,
  signalIdentities,
} from '../src/infrastructure/db/schema.js';
import { createDataService } from '../src/modules/data/service.js';
import type { BackupStore } from '../src/modules/data/ports.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const DAY = 86_400_000;
const texts = (n: number) =>
  `DEMO: Szukamy programisty nr ${n} do narzędzia wewnętrznego, zapłacimy za wykonanie. Budżet ${n}000 PLN, kontakt przez portal.`;

const goodStore: BackupStore = {
  write: () => Promise.resolve({ file: '/backups/x.db', bytes: 1 }),
  prune: () => [],
};

async function setup() {
  const clock = new FakeClock();
  const built = await buildTestApp({ clock, env: { LLM_PROVIDER: 'mock' } });
  const cookie = await loginAsOperator(built.app);
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const importText = async (n: number) =>
    (await call('POST', '/api/signals/import', { text: texts(n) })).json<{
      opportunityId: number;
    }>().opportunityId;
  const { db } = openTestDb(built.dir);
  const logs: string[] = [];
  const service = (over: { retentionDays?: number; backups?: BackupStore } = {}) =>
    createDataService({
      repository: createDataRepository(db),
      clock,
      backups: over.backups ?? goodStore,
      backupKeep: 14,
      ...(over.retentionDays ? { retentionDays: over.retentionDays } : {}),
      logger: { info: (m) => logs.push(`info ${m}`), error: (m) => logs.push(`error ${m}`) },
    });
  const set = (id: number, status: string, daysAgo: number) =>
    db
      .update(opportunities)
      .set({ businessStatus: status, updatedAt: clock.now().getTime() - daysAgo * DAY })
      .where(eq(opportunities.id, id))
      .run();
  const ids = () =>
    db
      .select({ id: opportunities.id })
      .from(opportunities)
      .all()
      .map((o) => o.id);
  return { clock, call, importText, db, logs, service, set, ids };
}

describe('retention in the daily job (FR-21 AC3)', () => {
  it('deletes only closed rows unchanged for more than 90 days and without payment', async () => {
    const t = await setup();
    const rejected91 = await t.importText(1);
    const expired91 = await t.importText(2);
    const rejected89 = await t.importText(3);
    const fresh200 = await t.importText(4);
    const paid = await t.importText(5);
    t.db
      .insert(payments)
      .values({ opportunityId: paid, amountMinor: 100, currency: 'PLN', paidAt: 1, createdAt: 1 })
      .run();

    // Created 200 days ago, rejected 10 days ago through the real status route.
    t.clock.advance(-200 * DAY);
    const lateReject = await t.importText(6);
    t.clock.advance(190 * DAY);
    expect(
      (
        await t.call('POST', `/api/opportunities/${lateReject}/status`, {
          status: 'REJECTED',
          reason: 'NO_BUDGET',
        })
      ).statusCode,
    ).toBe(200);
    t.clock.advance(10 * DAY);

    // Stamp the five rows relative to the final "now".
    const now = t.clock.now().getTime();
    for (const [id, status, days] of [
      [rejected91, 'REJECTED', 91],
      [expired91, 'EXPIRED', 91],
      [rejected89, 'REJECTED', 89],
      [fresh200, 'NEW', 200],
      [paid, 'REJECTED', 91],
    ] as const) {
      t.db
        .update(opportunities)
        .set({ businessStatus: status, updatedAt: now - days * DAY })
        .where(eq(opportunities.id, id))
        .run();
    }
    const rowsOf = (id: number) => ({
      evidence: t.db
        .select()
        .from(opportunityEvidence)
        .where(eq(opportunityEvidence.opportunityId, id))
        .all().length,
      identities: t.db
        .select()
        .from(signalIdentities)
        .where(eq(signalIdentities.opportunityId, id))
        .all().length,
      events: t.db.select().from(activityEvents).where(eq(activityEvents.opportunityId, id)).all()
        .length,
    });
    expect(rowsOf(rejected91).evidence).toBeGreaterThan(0);

    await t.service().runDaily();

    expect(t.ids().sort((a, b) => a - b)).toEqual([rejected89, fresh200, paid, lateReject]);
    expect(rowsOf(rejected91)).toEqual({ evidence: 0, identities: 0, events: 0 });
    expect(rowsOf(expired91)).toEqual({ evidence: 0, identities: 0, events: 0 });
    expect(t.db.select().from(rawSignals).all()).toHaveLength(4);
    expect(t.logs.at(-1)).toBe(
      'info retention: removed 2 opportunities (REJECTED/EXPIRED, unchanged for 90 days)',
    );
  });

  it('keeps a closed row the operator added a note to within the period', async () => {
    const t = await setup();
    const noted = await t.importText(1);
    const stale = await t.importText(2);
    t.set(noted, 'REJECTED', 100);
    t.set(stale, 'REJECTED', 100);
    t.clock.advance(-DAY);
    expect(
      (await t.call('POST', `/api/opportunities/${noted}/notes`, { text: 'Klient wróci' }))
        .statusCode,
    ).toBe(200);
    t.clock.advance(DAY);
    await t.service().runDaily();
    expect(t.ids()).toEqual([noted]);
  });

  it('keeps a closed row an offer draft was generated for within the period', async () => {
    const t = await setup();
    const drafted = await t.importText(1);
    const stale = await t.importText(2);
    t.set(drafted, 'REJECTED', 100);
    t.set(stale, 'REJECTED', 100);
    t.clock.advance(-DAY);
    expect((await t.call('POST', `/api/opportunities/${drafted}/offer-drafts`)).statusCode).toBe(
      201,
    );
    t.clock.advance(DAY);
    await t.service().runDaily();
    expect(t.ids()).toEqual([drafted]);
  });

  it('deletes a backlog larger than one batch and counts it', async () => {
    const t = await setup();
    const old = t.clock.now().getTime() - 100 * DAY;
    t.db.transaction((tx) => {
      for (let n = 0; n < 1201; n++) {
        const raw = tx
          .insert(rawSignals)
          .values({
            sourceType: 'MANUAL_IMPORT',
            title: `DEMO ${n}`,
            snippet: 'DEMO',
            fetchedAt: old,
            availability: 'UNKNOWN',
          })
          .returning({ id: rawSignals.id })
          .get();
        tx.insert(opportunities)
          .values({
            primarySignalId: raw.id,
            businessStatus: n % 2 ? 'REJECTED' : 'EXPIRED',
            analysisStatus: 'PENDING',
            createdAt: old,
            updatedAt: old,
          })
          .run();
      }
    });
    await t.service().runDaily();
    expect(t.ids()).toEqual([]);
    expect(t.db.select().from(rawSignals).all()).toEqual([]);
    expect(t.logs.at(-1)).toContain('retention: removed 1201 opportunities');
  });

  it('keeps this month’s billed usage of a deleted row', async () => {
    const t = await setup();
    const id = await t.importText(1);
    await t.service().runDaily(); // nothing closed yet
    t.set(id, 'REJECTED', 100);
    t.db
      .insert(analyses)
      .values({
        opportunityId: id,
        status: 'COMPLETE',
        provider: 'anthropic',
        model: 'm',
        promptVersion: 'x',
        schemaVersion: 1,
        costMicroUsd: 500,
        createdAt: t.clock.now().getTime(),
      })
      .run();
    await t.service().runDaily();
    expect(t.ids()).toEqual([]);
    expect(t.db.all(sql`SELECT cost_micro_usd AS c FROM deleted_usage`)).toEqual([{ c: 500 }]);
  });

  it('deletes nothing and logs an error when the backup failed', async () => {
    const t = await setup();
    const id = await t.importText(1);
    t.set(id, 'REJECTED', 200);
    const failing: BackupStore = {
      write: () => Promise.reject(new Error('disk full')),
      prune: () => [],
    };
    await t.service({ backups: failing }).runDaily();
    expect(t.ids()).toEqual([id]);
    expect(t.logs).toEqual(['error backup failed: disk full']);
  });

  it('moves the boundary with RETENTION_DAYS', async () => {
    const t = await setup();
    const a = await t.importText(1);
    const b = await t.importText(2);
    t.set(a, 'REJECTED', 31);
    t.set(b, 'EXPIRED', 29);
    await t.service({ retentionDays: 30 }).runDaily();
    expect(t.ids()).toEqual([b]);
    expect(t.logs.at(-1)).toBe(
      'info retention: removed 1 opportunities (REJECTED/EXPIRED, unchanged for 30 days)',
    );
  });
});
