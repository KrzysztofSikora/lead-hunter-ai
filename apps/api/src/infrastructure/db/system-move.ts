import { eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { ActivityCause } from '@lead-hunter/contracts';
import { activityEvents, opportunities } from './schema.js';

/** S-17 D-17: the system status move shared by the pre-filter and the source filter. */

/** Moves the business status only while it is still `NEW` (D-17). */
export const moveFromNew = (status: string | null) =>
  sql`CASE WHEN ${opportunities.businessStatus} = 'NEW' AND ${status} IS NOT NULL THEN ${status} ELSE ${opportunities.businessStatus} END`;

export type Tx = Parameters<Parameters<BetterSQLite3Database['transaction']>[0]>[0];

/** The status before an update; the system event is written only when it was `NEW` (D-8). */
export const statusOf = (tx: Tx, id: number): string | undefined =>
  tx
    .select({ status: opportunities.businessStatus })
    .from(opportunities)
    .where(eq(opportunities.id, id))
    .get()?.status;

export function recordSystemMove(
  tx: Tx,
  id: number,
  before: string | undefined,
  to: string | null,
  cause: ActivityCause,
  at: number,
): void {
  if (before !== 'NEW' || to === null) return;
  tx.insert(activityEvents)
    .values({
      opportunityId: id,
      type: 'STATUS_CHANGE',
      actor: 'system',
      fromStatus: before,
      toStatus: to,
      metadataJson: JSON.stringify(ActivityCause.parse(cause)),
      occurredAt: at,
    })
    .run();
}
