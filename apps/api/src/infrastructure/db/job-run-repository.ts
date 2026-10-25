import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { JobRunRepository } from '../../modules/jobs/ports.js';
import { jobRuns } from './schema.js';

/** The unique-index violation, whether drizzle wraps the driver error or not. */
function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  }
  return false;
}

export function createJobRunRepository(db: BetterSQLite3Database): JobRunRepository {
  return {
    startCycle(trigger, at, scheduledFor) {
      try {
        return db
          .insert(jobRuns)
          .values({
            jobType: 'discovery',
            status: 'running',
            startedAt: at,
            trigger,
            scheduledFor,
          })
          .returning({ id: jobRuns.id })
          .get().id;
      } catch (error) {
        if (isUniqueViolation(error)) return 'slot_taken';
        throw error;
      }
    },
    finishCycle(id, summary) {
      db.update(jobRuns)
        .set({
          status: summary.status,
          finishedAt: summary.at,
          fetched: summary.fetched,
          new: summary.new,
          duplicates: summary.duplicates,
          failed: summary.failed,
          skipped: summary.skipped,
          errorReason: summary.error?.reason ?? null,
        })
        .where(and(eq(jobRuns.id, id), eq(jobRuns.status, 'running')))
        .run();
    },
    isRunning() {
      return (
        db.select({ id: jobRuns.id }).from(jobRuns).where(eq(jobRuns.status, 'running')).get() !==
        undefined
      );
    },
  };
}
