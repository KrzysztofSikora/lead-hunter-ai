import {
  ActivityMetadata,
  type BusinessStatus,
  type Category,
  type Currency,
} from '@lead-hunter/contracts';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Attribution, InsightsRepository } from '../../modules/insights/ports.js';
import {
  activityEvents,
  offerDrafts,
  opportunities,
  payments,
  rawSignals,
  sources,
} from './schema.js';

const attributionColumns = {
  opportunityId: opportunities.id,
  businessStatus: opportunities.businessStatus,
  category: opportunities.category,
  sourceId: sources.id,
  sourceName: sources.name,
  sourceType: sources.type,
};

interface AttributionRow {
  category: string | null;
  sourceId: number | null;
  sourceName: string | null;
  sourceType: string | null;
}

const attributionOf = (row: AttributionRow): Attribution => ({
  source:
    row.sourceId === null
      ? null
      : { id: row.sourceId, name: row.sourceName ?? '', type: row.sourceType ?? '' },
  category: row.category as Category | null,
});

/** `skipped` of an operator event; unreadable metadata counts as no skipped stages. */
function skippedOf(metadataJson: string | null): BusinessStatus[] {
  if (metadataJson === null) return [];
  try {
    const parsed = ActivityMetadata.safeParse(JSON.parse(metadataJson));
    return parsed.success ? (parsed.data.skipped ?? []) : [];
  } catch {
    return [];
  }
}

export function createInsightsRepository(db: BetterSQLite3Database): InsightsRepository {
  return {
    operatorStatusEvents() {
      return db
        .select({
          ...attributionColumns,
          toStatus: activityEvents.toStatus,
          metadataJson: activityEvents.metadataJson,
          occurredAt: activityEvents.occurredAt,
        })
        .from(activityEvents)
        .innerJoin(opportunities, eq(activityEvents.opportunityId, opportunities.id))
        .innerJoin(rawSignals, eq(opportunities.primarySignalId, rawSignals.id))
        .leftJoin(sources, eq(rawSignals.sourceId, sources.id))
        .where(and(eq(activityEvents.type, 'STATUS_CHANGE'), eq(activityEvents.actor, 'operator')))
        .orderBy(asc(activityEvents.occurredAt), asc(activityEvents.id))
        .all()
        .flatMap((row) =>
          row.toStatus === null
            ? []
            : [
                {
                  ...attributionOf(row),
                  opportunityId: row.opportunityId,
                  businessStatus: row.businessStatus as BusinessStatus,
                  toStatus: row.toStatus as BusinessStatus,
                  skipped: skippedOf(row.metadataJson),
                  occurredAt: row.occurredAt,
                },
              ],
        );
    },
    sentDrafts(from, to) {
      return db
        .select(attributionColumns)
        .from(offerDrafts)
        .innerJoin(opportunities, eq(offerDrafts.opportunityId, opportunities.id))
        .innerJoin(rawSignals, eq(opportunities.primarySignalId, rawSignals.id))
        .leftJoin(sources, eq(rawSignals.sourceId, sources.id))
        .where(
          and(
            eq(offerDrafts.status, 'SENT_MANUALLY'),
            gte(offerDrafts.statusChangedAt, from),
            lt(offerDrafts.statusChangedAt, to),
          ),
        )
        .all()
        .map((row) => ({ ...attributionOf(row), opportunityId: row.opportunityId }));
    },
    payments(from, to) {
      return db
        .select({
          ...attributionColumns,
          currency: payments.currency,
          amountMinor: payments.amountMinor,
        })
        .from(payments)
        .innerJoin(opportunities, eq(payments.opportunityId, opportunities.id))
        .innerJoin(rawSignals, eq(opportunities.primarySignalId, rawSignals.id))
        .leftJoin(sources, eq(rawSignals.sourceId, sources.id))
        .where(and(gte(payments.paidAt, from), lt(payments.paidAt, to)))
        .all()
        .map((row) => ({
          ...attributionOf(row),
          opportunityId: row.opportunityId,
          currency: row.currency as Currency,
          amountMinor: row.amountMinor,
        }));
    },
  };
}
