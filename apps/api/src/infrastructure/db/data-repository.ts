import { eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DataRepository } from '../../modules/data/ports.js';
import { analyses, offerDrafts, opportunities, rawSignals } from './schema.js';

export function createDataRepository(db: BetterSQLite3Database): DataRepository {
  return {
    /**
     * S-15 D-1: one immediate transaction. The month's billed usage is copied to `deleted_usage`
     * first, then the opportunity goes (its children cascade) and with it the one raw signal it owns.
     */
    deleteOpportunity(id, usageSince) {
      return db.transaction(
        (tx) => {
          const row = tx
            .select({ signalId: opportunities.primarySignalId })
            .from(opportunities)
            .where(eq(opportunities.id, id))
            .get();
          if (!row) return false;
          tx.run(sql`INSERT INTO deleted_usage (kind, created_at, cost_micro_usd, counted, unknown_cost)
            SELECT 'analysis', ${analyses.createdAt}, ${analyses.costMicroUsd},
              CASE WHEN ${analyses.reusedFromAnalysisId} IS NULL THEN 1 ELSE 0 END,
              CASE WHEN ${analyses.status} = 'COMPLETE' AND ${analyses.costMicroUsd} IS NULL AND ${analyses.provider} <> 'mock' AND ${analyses.reusedFromAnalysisId} IS NULL THEN 1 ELSE 0 END
            FROM ${analyses}
            WHERE ${analyses.opportunityId} = ${id} AND ${analyses.createdAt} >= ${usageSince}`);
          tx.run(sql`INSERT INTO deleted_usage (kind, created_at, cost_micro_usd, counted, unknown_cost)
            SELECT 'offer_draft', ${offerDrafts.createdAt}, ${offerDrafts.costMicroUsd}, 1,
              CASE WHEN ${offerDrafts.status} <> 'FAILED' AND ${offerDrafts.costMicroUsd} IS NULL AND ${offerDrafts.provider} <> 'mock' THEN 1 ELSE 0 END
            FROM ${offerDrafts}
            WHERE ${offerDrafts.opportunityId} = ${id} AND ${offerDrafts.createdAt} >= ${usageSince}`);
          tx.delete(opportunities).where(eq(opportunities.id, id)).run();
          tx.delete(rawSignals).where(eq(rawSignals.id, row.signalId)).run();
          return true;
        },
        { behavior: 'immediate' },
      );
    },
  };
}
