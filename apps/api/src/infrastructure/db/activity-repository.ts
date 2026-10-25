import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { FOLLOW_UP_STATUSES, type BusinessStatus } from '@lead-hunter/contracts';
import type { ActivityRepository } from '../../modules/opportunities/ports.js';
import { activityEvents, opportunities } from './schema.js';

export function createActivityRepository(db: BetterSQLite3Database): ActivityRepository {
  return {
    changeStatus(id, to, decide, event) {
      return db.transaction((tx) => {
        const current = tx
          .select({ status: opportunities.businessStatus, followUpAt: opportunities.followUpAt })
          .from(opportunities)
          .where(eq(opportunities.id, id))
          .get();
        if (!current) return 'not_found';
        const from = current.status as BusinessStatus;
        const check = decide(from);
        if (!check.allowed) return 'not_allowed';
        if (check.noteRequired && event.note === null) return 'note_required';
        const updated = tx
          .update(opportunities)
          .set({
            businessStatus: to,
            updatedAt: event.at,
            // Plan-review 4: a follow-up only lives while the opportunity is in contact.
            ...(FOLLOW_UP_STATUSES.includes(to) ? {} : { followUpAt: null }),
          })
          .where(and(eq(opportunities.id, id), eq(opportunities.businessStatus, from)))
          .run();
        if (updated.changes === 0) return 'not_allowed';
        tx.insert(activityEvents)
          .values({
            opportunityId: id,
            type: 'STATUS_CHANGE',
            actor: 'operator',
            fromStatus: from,
            toStatus: to,
            reason: event.reason,
            note: event.note,
            metadataJson: event.metadata(
              check,
              current.followUpAt !== null && !FOLLOW_UP_STATUSES.includes(to),
            ),
            occurredAt: event.at,
          })
          .run();
        return 'changed';
      });
    },
    setFollowUp(id, followUpAt, event) {
      return db.transaction((tx) => {
        const current = tx
          .select({ status: opportunities.businessStatus })
          .from(opportunities)
          .where(eq(opportunities.id, id))
          .get();
        if (!current) return 'not_found';
        if (!FOLLOW_UP_STATUSES.includes(current.status as BusinessStatus)) return 'not_allowed';
        tx.update(opportunities)
          .set({ followUpAt, updatedAt: event.at })
          .where(eq(opportunities.id, id))
          .run();
        tx.insert(activityEvents)
          .values({
            opportunityId: id,
            type: 'FOLLOW_UP',
            actor: 'operator',
            metadataJson: event.metadata,
            occurredAt: event.at,
          })
          .run();
        return 'changed';
      });
    },
    addNote(id, text, at) {
      return db.transaction((tx) => {
        const exists = tx
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(eq(opportunities.id, id))
          .get();
        if (!exists) return false;
        tx.insert(activityEvents)
          .values({
            opportunityId: id,
            type: 'NOTE',
            actor: 'operator',
            note: text,
            occurredAt: at,
          })
          .run();
        return true;
      });
    },
  };
}
