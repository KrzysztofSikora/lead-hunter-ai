import { and, asc, count, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { FOLLOW_UP_STATUSES, type BusinessStatus, type Currency } from '@lead-hunter/contracts';
import type { PipelineItemRow, PipelineRepository } from '../../modules/pipeline/ports.js';
import { opportunities, payments, rawSignals } from './schema.js';

/** Statuses an opportunity can only have reached through `CONTACTED` (plan-review 3). */
const CONTACT_REACHED = ['CONTACTED', 'REPLIED', 'MEETING', 'WON', 'LOST'] as const;

export function createPipelineRepository(db: BetterSQLite3Database): PipelineRepository {
  const withPaid = (rows: Omit<PipelineItemRow, 'paid'>[]): PipelineItemRow[] => {
    if (rows.length === 0) return [];
    const sums = db
      .select({
        opportunityId: payments.opportunityId,
        currency: payments.currency,
        totalMinor: sql<number>`sum(${payments.amountMinor})`,
      })
      .from(payments)
      .where(
        inArray(
          payments.opportunityId,
          rows.map((row) => row.id),
        ),
      )
      .groupBy(payments.opportunityId, payments.currency)
      .orderBy(asc(payments.currency))
      .all();
    return rows.map((row) => ({
      ...row,
      paid: sums
        .filter((sum) => sum.opportunityId === row.id)
        .map((sum) => ({ currency: sum.currency as Currency, totalMinor: sum.totalMinor })),
    }));
  };

  const itemColumns = {
    id: opportunities.id,
    title: rawSignals.title,
    businessStatus: opportunities.businessStatus,
    score: opportunities.score,
    followUpAt: opportunities.followUpAt,
    updatedAt: opportunities.updatedAt,
  };
  const items = () =>
    db
      .select(itemColumns)
      .from(opportunities)
      .innerJoin(rawSignals, eq(opportunities.primarySignalId, rawSignals.id));

  return {
    countByStatus() {
      return db
        .select({ status: opportunities.businessStatus, count: count() })
        .from(opportunities)
        .groupBy(opportunities.businessStatus)
        .all() as { status: BusinessStatus; count: number }[];
    },
    itemsInStatus(status, limit) {
      return withPaid(
        items()
          .where(eq(opportunities.businessStatus, status))
          .orderBy(desc(opportunities.updatedAt), desc(opportunities.id))
          .limit(limit)
          .all() as Omit<PipelineItemRow, 'paid'>[],
      );
    },
    followUpsDue(until) {
      return withPaid(
        items()
          .where(
            and(
              isNotNull(opportunities.followUpAt),
              lte(opportunities.followUpAt, until),
              inArray(opportunities.businessStatus, [...FOLLOW_UP_STATUSES]),
            ),
          )
          .orderBy(asc(opportunities.followUpAt), asc(opportunities.id))
          .all() as Omit<PipelineItemRow, 'paid'>[],
      );
    },
    totals() {
      // Operator events carry `{ skipped?, contract?, on? }`; system events an ActivityCause.
      // `json_valid` guards the `json_each` against any stored text that is not JSON.
      const contacted = db.get<{ n: number }>(sql`
        SELECT count(DISTINCT opportunity_id) AS n FROM activity_events
        WHERE type = 'STATUS_CHANGE' AND actor = 'operator' AND (
          to_status IN (${sql.join(
            CONTACT_REACHED.map((s) => sql`${s}`),
            sql`, `,
          )})
          OR (json_valid(metadata_json) AND EXISTS (
            SELECT 1 FROM json_each(metadata_json, '$.skipped') WHERE value = 'CONTACTED'
          ))
        )`);
      const won = db
        .select({ n: count() })
        .from(opportunities)
        .where(eq(opportunities.businessStatus, 'WON'))
        .get();
      const paid = db
        .select({ n: sql<number>`count(DISTINCT ${payments.opportunityId})` })
        .from(payments)
        .get();
      const paidSums = db
        .select({
          currency: payments.currency,
          totalMinor: sql<number>`sum(${payments.amountMinor})`,
          count: count(),
        })
        .from(payments)
        .groupBy(payments.currency)
        .orderBy(asc(payments.currency))
        .all();
      return {
        contacted: contacted?.n ?? 0,
        won: won?.n ?? 0,
        paid: paid?.n ?? 0,
        paidSums: paidSums.map((sum) => ({ ...sum, currency: sum.currency as Currency })),
      };
    },
  };
}
