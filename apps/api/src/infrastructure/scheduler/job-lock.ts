import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { JobLock, LockHandle } from '../../modules/jobs/ports.js';
import type { Clock } from '../../modules/shared/clock.js';
import { jobLocks, jobRuns } from '../db/schema.js';

export const LOCK_NAME = 'discovery';
/** D-2: a heartbeat older than this means the owner is gone. */
export const LOCK_STALE_MS = 2 * 60_000;

export interface JobLockOptions {
  db: BetterSQLite3Database;
  clock: Clock;
  host: string;
  pid: number;
  /** Defaults to `process.kill(pid, 0)`; `EPERM` counts as alive. */
  isAlive?: (pid: number) => boolean;
  staleMs?: number;
  name?: string;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

type LockRow = typeof jobLocks.$inferSelect;

export function createJobLock({
  db,
  clock,
  host,
  pid,
  isAlive = processIsAlive,
  staleMs = LOCK_STALE_MS,
  name = LOCK_NAME,
}: JobLockOptions): JobLock {
  /** Tokens this process minted and still holds: such a lock is never stale in `acquire` (D-2). */
  const minted = new Set<string>();
  const immediate = { behavior: 'immediate' } as const;

  const stale = (row: LockRow, now: number, atStart: boolean): boolean => {
    if (now - row.heartbeatAt > staleMs) return true;
    if (row.ownerHost !== host) return false;
    // After a container restart the dead owner may have had our pid; only start-up may say so.
    if (atStart && row.ownerPid === pid) return true;
    return !isAlive(row.ownerPid);
  };

  /** Safe because nothing runs without the lock (D-4). */
  const interruptRunning = (tx: BetterSQLite3Database, now: number): number =>
    tx
      .update(jobRuns)
      .set({ status: 'failed', errorReason: 'interrupted', finishedAt: now })
      .where(eq(jobRuns.status, 'running'))
      .run().changes;

  const handleFor = (token: string): LockHandle => ({
    heartbeat() {
      const kept =
        db
          .update(jobLocks)
          .set({ heartbeatAt: clock.now().getTime() })
          .where(and(eq(jobLocks.name, name), eq(jobLocks.ownerToken, token)))
          .run().changes === 1;
      if (!kept) minted.delete(token);
      return kept;
    },
    release() {
      db.delete(jobLocks)
        .where(and(eq(jobLocks.name, name), eq(jobLocks.ownerToken, token)))
        .run();
      minted.delete(token);
    },
    releaseInterrupted(at) {
      minted.delete(token);
      return db.transaction((tx) => {
        const freed = tx
          .delete(jobLocks)
          .where(and(eq(jobLocks.name, name), eq(jobLocks.ownerToken, token)))
          .run().changes;
        return freed === 1 ? interruptRunning(tx, at) : 0;
      }, immediate);
    },
  });

  return {
    acquire() {
      return db.transaction((tx) => {
        const now = clock.now().getTime();
        const row = tx.select().from(jobLocks).where(eq(jobLocks.name, name)).get();
        if (row) {
          if (minted.has(row.ownerToken) || !stale(row, now, false)) return { ok: false };
          interruptRunning(tx, now);
          tx.delete(jobLocks).where(eq(jobLocks.name, name)).run();
        }
        const token = randomUUID();
        tx.insert(jobLocks)
          .values({
            name,
            ownerHost: host,
            ownerPid: pid,
            ownerToken: token,
            acquiredAt: now,
            heartbeatAt: now,
          })
          .run();
        minted.add(token);
        return { ok: true, handle: handleFor(token) };
      }, immediate);
    },
    isHeld() {
      const row = db.select().from(jobLocks).where(eq(jobLocks.name, name)).get();
      return (
        row !== undefined &&
        (minted.has(row.ownerToken) || !stale(row, clock.now().getTime(), false))
      );
    },
    releaseStale() {
      return db.transaction((tx) => {
        const now = clock.now().getTime();
        const row = tx.select().from(jobLocks).where(eq(jobLocks.name, name)).get();
        if (!row) {
          // A crash can leave `running` rows with no lock row at all (plan-review #2).
          interruptRunning(tx, now);
          return false;
        }
        if (!stale(row, now, true)) return false;
        interruptRunning(tx, now);
        tx.delete(jobLocks).where(eq(jobLocks.name, name)).run();
        return true;
      }, immediate);
    },
  };
}
