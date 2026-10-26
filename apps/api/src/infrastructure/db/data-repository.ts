import { and, eq, getTableColumns, gte, inArray, lt, notExists, sql } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DataRepository, ExportTables } from '../../modules/data/ports.js';
import {
  activityEvents,
  analyses,
  offerDrafts,
  operatorProfile,
  opportunities,
  opportunityEvidence,
  payments,
  rawSignals,
  sources,
} from './schema.js';

/**
 * S-15 D-8, TR-12: the export reads an explicit column list per table. A column added later is not
 * exported until someone puts it in `exported` or `withheld`; `data-export.int.test.ts` fails until then.
 */
export const EXPORT_COLUMNS: Record<string, { exported: string[]; withheld: string[] }> = {
  operator_profile: {
    exported: ['schemaVersion', 'data', 'isExample', 'updatedAt'],
    withheld: ['id'],
  },
  sources: {
    exported: [
      'id',
      'type',
      'name',
      'configJson',
      'configKey',
      'presetId',
      'enabled',
      'filterJson',
      'lastAttemptAt',
      'lastSuccessAt',
      'createdAt',
      'updatedAt',
    ],
    withheld: ['cursorJson', 'nextAllowedAt', 'lastErrorReason', 'lastErrorStatus', 'lastErrorAt'],
  },
  raw_signals: {
    exported: [
      'id',
      'sourceType',
      'sourceId',
      'externalId',
      'sourceUrl',
      'canonicalUrl',
      'title',
      'snippet',
      'publishedAt',
      'fetchedAt',
      'contentHash',
      'availability',
      'lastVerifiedAt',
      'jobRunId',
      'tenderJson',
    ],
    withheld: [],
  },
  opportunities: {
    exported: [
      'id',
      'primarySignalId',
      'businessStatus',
      'analysisStatus',
      'category',
      'evidenceLevel',
      'score',
      'confidence',
      'createdAt',
      'updatedAt',
      'lastVerifiedAt',
      'prefilterRule',
      'prefilterMatches',
      'prefilterAt',
      'prefilterPhrase',
      'language',
      'analysisProvider',
      'industry',
      'workMode',
      'countries',
      'amountMaxMinor',
      'amountCurrency',
      'analysisForce',
      'followUpAt',
    ],
    withheld: [],
  },
  analyses: {
    exported: [
      'id',
      'opportunityId',
      'status',
      'provider',
      'model',
      'promptVersion',
      'schemaVersion',
      'resultJson',
      'breakdownJson',
      'guardNotesJson',
      'error',
      'inputTokens',
      'outputTokens',
      'costMicroUsd',
      'reusedFromAnalysisId',
      'createdAt',
    ],
    withheld: [],
  },
  opportunity_evidence: {
    exported: [
      'id',
      'opportunityId',
      'rawSignalId',
      'evidenceType',
      'sourceFact',
      'sourceUrl',
      'canonicalUrl',
      'contentHash',
      'extractedAt',
    ],
    withheld: [],
  },
  activity_events: {
    exported: [
      'id',
      'opportunityId',
      'type',
      'actor',
      'fromStatus',
      'toStatus',
      'reason',
      'note',
      'metadataJson',
      'occurredAt',
    ],
    withheld: [],
  },
  payments: {
    exported: ['id', 'opportunityId', 'amountMinor', 'currency', 'paidAt', 'note', 'createdAt'],
    withheld: [],
  },
  offer_drafts: {
    exported: [
      'id',
      'opportunityId',
      'status',
      'language',
      'subject',
      'messageMarkdown',
      'proposalMarkdown',
      'contentJson',
      'guardNotesJson',
      'provider',
      'model',
      'promptVersion',
      'schemaVersion',
      'analysed',
      'error',
      'inputTokens',
      'outputTokens',
      'costMicroUsd',
      'createdAt',
      'updatedAt',
      'statusChangedAt',
    ],
    withheld: [],
  },
};

/** Tables the export does not read at all (D-8): sessions, runtime state, dedup keys, spend. */
export const WITHHELD_TABLES = [
  'app_meta',
  'sessions',
  'job_runs',
  'job_locks',
  'signal_identities',
  'deleted_usage',
];

/** `select` of the allowlisted columns of `table`. */
function pick(table: SQLiteTable, name: string): Record<string, SQLiteColumn> {
  const all = getTableColumns(table) as Record<string, SQLiteColumn>;
  return Object.fromEntries(
    (EXPORT_COLUMNS[name]?.exported ?? []).map((key) => {
      const column = all[key];
      if (!column) throw new Error(`export column ${name}.${key} does not exist`);
      return [key, column];
    }),
  );
}

type Tx = Parameters<Parameters<BetterSQLite3Database['transaction']>[0]>[0];

export function createDataRepository(db: BetterSQLite3Database): DataRepository {
  /**
   * S-15 D-1: the month's billed usage is copied to `deleted_usage` first, then the opportunity
   * goes (its children cascade) and with it the one raw signal it owns. Runs inside a transaction.
   */
  function remove(tx: Tx, id: number, usageSince: number): boolean {
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
  }

  return {
    deleteOpportunity(id, usageSince) {
      return db.transaction((tx) => remove(tx, id, usageSince), { behavior: 'immediate' });
    },
    /**
     * S-15 D-4: REJECTED/EXPIRED rows unchanged since `before` and without a payment, `batch` per
     * immediate transaction so a large backlog never holds the write lock for long.
     */
    deleteClosedBefore(before, usageSince, batch) {
      let total = 0;
      for (;;) {
        const removed = db.transaction(
          (tx) => {
            const ids = tx
              .select({ id: opportunities.id })
              .from(opportunities)
              .where(
                and(
                  inArray(opportunities.businessStatus, ['REJECTED', 'EXPIRED']),
                  lt(opportunities.updatedAt, before),
                  notExists(
                    tx
                      .select({ one: sql`1` })
                      .from(payments)
                      .where(eq(payments.opportunityId, opportunities.id)),
                  ),
                  // Notes and work entries do not move `updated_at` but are the operator's own input.
                  notExists(
                    tx
                      .select({ one: sql`1` })
                      .from(activityEvents)
                      .where(
                        and(
                          eq(activityEvents.opportunityId, opportunities.id),
                          inArray(activityEvents.type, ['NOTE', 'WORK']),
                          gte(activityEvents.occurredAt, before),
                        ),
                      ),
                  ),
                ),
              )
              .orderBy(opportunities.id)
              .limit(batch)
              .all();
            return ids.filter((row) => remove(tx, row.id, usageSince)).length;
          },
          { behavior: 'immediate' },
        );
        total += removed;
        if (removed < batch) return total;
      }
    },
    /** One deferred read transaction: all tables come from the same snapshot. */
    exportAll() {
      return db.transaction((tx): ExportTables => {
        const profile = tx
          .select(pick(operatorProfile, 'operator_profile'))
          .from(operatorProfile)
          .get();
        const all = (table: SQLiteTable, name: string) =>
          tx
            .select(pick(table, name))
            .from(table)
            .orderBy(sql`id`)
            .all() as Record<string, unknown>[];
        return {
          profile: (profile as Record<string, unknown> | undefined) ?? null,
          sources: all(sources, 'sources'),
          signals: all(rawSignals, 'raw_signals'),
          opportunities: all(opportunities, 'opportunities'),
          evidence: all(opportunityEvidence, 'opportunity_evidence'),
          analyses: all(analyses, 'analyses'),
          offerDrafts: all(offerDrafts, 'offer_drafts'),
          events: all(activityEvents, 'activity_events'),
          payments: all(payments, 'payments'),
        };
      });
    },
  };
}
