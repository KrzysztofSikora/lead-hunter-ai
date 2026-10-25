import type { JobCost, JobCounters, JobErrorReason } from '@lead-hunter/contracts';

/** Who started a run (D-14, D-10). */
export type JobTrigger = 'schedule' | 'manual' | 'cli';

/** The held lock (D-1). Only its owner can heartbeat or release it. */
export interface LockHandle {
  /** `false` means the lock was lost: another process took it over (D-2). */
  heartbeat(): boolean;
  release(): void;
  /**
   * Shutdown (D-3): in one transaction, delete the lock and mark every run still `running` as
   * `interrupted`. Does nothing, and returns 0, when the lock is no longer ours.
   */
  releaseInterrupted(at: number): number;
}

/** D-1, D-2: one named lock in the database both the server and the CLI share. */
export interface JobLock {
  acquire(): { ok: true; handle: LockHandle } | { ok: false };
  /**
   * At start only (D-2): frees a lock whose owner is gone, and marks runs it left `running` as
   * `interrupted`. Returns whether a lock was freed.
   */
  releaseStale(): boolean;
}

export interface CycleSummary {
  status: 'ok' | 'partial' | 'failed';
  at: number;
  fetched: number;
  new: number;
  duplicates: number;
  failed: number;
  skipped: number;
  error?: { reason: 'internal' };
}

/** One run as the list shows it: times in UTC ms, counters already joined at read time (D-8). */
export interface JobRunRow {
  id: number;
  type: 'discovery' | 'source_run';
  trigger: JobTrigger | null;
  parentId: number | null;
  source: { id: number; name: string } | null;
  status: 'running' | 'ok' | 'partial' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  scheduledFor: number | null;
  counters: JobCounters;
  error: { reason: JobErrorReason; httpStatus?: number } | null;
  cost: JobCost | null;
}

export interface JobRunQuery {
  page: number;
  pageSize: number;
  sourceId?: number | undefined;
  /** One run by id (the answer to a started cycle). */
  id?: number | undefined;
}

export interface JobRunRepository {
  /** D-5: `'slot_taken'` when this scheduled slot already has a cycle row. */
  startCycle(trigger: JobTrigger, at: number, scheduledFor: number | null): number | 'slot_taken';
  /** Writes only a row still `running`, so an `interrupted` row is never rewritten (D-3). */
  finishCycle(id: number, summary: CycleSummary): void;
  isRunning(): boolean;
  /** Newest first. A cycle's counters are the sums over its child runs (D-8, D-11). */
  list(query: JobRunQuery): { items: JobRunRow[]; total: number };
}
