import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SignalRepository } from '../../modules/signals/ports.js';
import { moveFromNew, recordSystemMove, statusOf } from './system-move.js';
import { opportunities, opportunityEvidence, rawSignals, signalIdentities } from './schema.js';

export function createSignalRepository(db: BetterSQLite3Database): SignalRepository {
  return {
    findOwner(kind, value) {
      return db
        .select({ id: signalIdentities.opportunityId })
        .from(signalIdentities)
        .where(and(eq(signalIdentities.kind, kind), eq(signalIdentities.value, value)))
        .get()?.id;
    },
    transaction(fn) {
      return db.transaction((tx) =>
        fn({
          findOwner(kind, value) {
            return tx
              .select({ id: signalIdentities.opportunityId })
              .from(signalIdentities)
              .where(and(eq(signalIdentities.kind, kind), eq(signalIdentities.value, value)))
              .get()?.id;
          },
          primarySignalId(opportunityId) {
            const row = tx
              .select({ id: opportunities.primarySignalId })
              .from(opportunities)
              .where(eq(opportunities.id, opportunityId))
              .get();
            if (!row) throw new Error(`opportunity ${opportunityId} is missing`);
            return row.id;
          },
          evidenceKeys(opportunityId) {
            return tx
              .select({
                canonicalUrl: opportunityEvidence.canonicalUrl,
                contentHash: opportunityEvidence.contentHash,
              })
              .from(opportunityEvidence)
              .where(eq(opportunityEvidence.opportunityId, opportunityId))
              .all();
          },
          claimIdentity(kind, value, opportunityId, at) {
            tx.insert(signalIdentities)
              .values({ kind, value, opportunityId, createdAt: at })
              .onConflictDoNothing()
              .run();
          },
          insertSignal(signal) {
            return tx.insert(rawSignals).values(signal).returning({ id: rawSignals.id }).get().id;
          },
          insertOpportunity(primarySignalId, at) {
            return tx
              .insert(opportunities)
              .values({
                primarySignalId,
                businessStatus: 'NEW',
                analysisStatus: 'PENDING',
                createdAt: at,
                updatedAt: at,
              })
              .returning({ id: opportunities.id })
              .get().id;
          },
          insertEvidence(evidence) {
            tx.insert(opportunityEvidence).values(evidence).run();
          },
          rejectBySourceFilter(opportunityId, phrase, at) {
            const before = statusOf(tx, opportunityId);
            tx.update(opportunities)
              .set({
                prefilterRule: 'source_filter',
                prefilterMatches: 0,
                prefilterPhrase: phrase,
                prefilterAt: at,
                analysisStatus: 'SKIPPED',
                businessStatus: moveFromNew('REJECTED'),
                updatedAt: at,
              })
              .where(eq(opportunities.id, opportunityId))
              .run();
            recordSystemMove(
              tx,
              opportunityId,
              before,
              'REJECTED',
              { kind: 'source_filter', phrase },
              at,
            );
          },
        }),
      );
    },
  };
}
