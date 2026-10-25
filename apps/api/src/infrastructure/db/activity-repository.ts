import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { BusinessStatus } from '@lead-hunter/contracts';
import type { ActivityRepository } from '../../modules/opportunities/ports.js';
import { activityEvents, opportunities } from './schema.js';

export function createActivityRepository(db: BetterSQLite3Database): ActivityRepository {
  return {
    changeStatus(id, to, decide, event) {
      return db.transaction((tx) => {
        const current = tx
          .select({ status: opportunities.businessStatus })
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
          .set({ businessStatus: to, updatedAt: event.at })
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
            metadataJson: event.metadata(check),
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
