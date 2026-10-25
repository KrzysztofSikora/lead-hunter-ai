import type { JobList } from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';
import type { RunOutcome, SourceService } from '../sources/service.js';
import type {
  CycleSummary,
  JobLock,
  JobRunQuery,
  JobRunRepository,
  JobTrigger,
  LockHandle,
} from './ports.js';

/** D-2: how often a held lock proves its owner is alive. */
export const HEARTBEAT_MS = 20_000;
const MINUTE_MS = 60_000;

export type SourceReport = Awaited<ReturnType<SourceService['runEnabled']>>[number];
/** The summary stored on the cycle row, and the per-source outcomes the CLI prints. */
export interface CycleResult {
  summary: CycleSummary;
  results: SourceReport[];
}

export type CycleStart =
  | { kind: 'busy' }
  | { kind: 'slot_taken' }
  | { kind: 'started'; runId: number; done: Promise<CycleResult> };

export type SourceRunStart = { kind: 'busy' } | { kind: 'ran'; outcome: RunOutcome };

export interface JobsService {
  /** Synchronous: the refusal or the new cycle row is known at once; the cycle runs on in `done`. */
  startCycle(trigger: JobTrigger, scheduledFor?: number): CycleStart;
  /** D-4: one source through the same lock. */
  runSource(id: number): Promise<SourceRunStart>;
  /** D-10: newest first; the schedule is added by the route. */
  list(query: JobRunQuery): Omit<JobList, 'schedule'>;
  /** Resolves when no cycle or source run started by this process is in flight. */
  idle(): Promise<void>;
  /** D-3: graceful stop; touches the lock and the rows only when this process holds the lock. */
  shutdown(at: number): void;
}

export interface JobsDeps {
  lock: JobLock;
  runs: JobRunRepository;
  sources: SourceService;
  clock: Clock;
  heartbeatMs?: number;
  /** Source ids and counts only (FR-24 AC2). */
  logger?: { info(message: string): void; warn(message: string): void };
}

export function createJobsService({
  lock,
  runs,
  sources,
  clock,
  heartbeatMs = HEARTBEAT_MS,
  logger,
}: JobsDeps): JobsService {
  let held: LockHandle | null = null;
  let stopping = false;
  const inflight = new Set<Promise<unknown>>();

  /** Keeps the lock alive while it is held; `lost()` turns true when another process took it. */
  const beat = (handle: LockHandle): { lost(): boolean; stop(): void } => {
    let lost = false;
    const timer = setInterval(() => {
      if (lost || handle.heartbeat()) return;
      lost = true;
      logger?.warn('lock lost: another process took the discovery lock');
    }, heartbeatMs);
    timer.unref();
    return { lost: () => lost, stop: () => clearInterval(timer) };
  };

  const track = <T>(promise: Promise<T>): Promise<T> => {
    inflight.add(promise);
    const forget = (): void => void inflight.delete(promise);
    promise.then(forget, forget);
    return promise;
  };

  const summarise = (results: SourceReport[], at: number): CycleSummary => {
    const summary: CycleSummary = {
      status: 'ok',
      at,
      fetched: 0,
      new: 0,
      duplicates: 0,
      failed: 0,
      skipped: 0,
    };
    let attempted = 0;
    let failedRuns = 0;
    let degraded = false;
    for (const { outcome } of results) {
      if (outcome.kind !== 'done') {
        summary.skipped += 1;
        continue;
      }
      const { result } = outcome;
      attempted += 1;
      summary.fetched += result.fetched;
      summary.new += result.new;
      summary.duplicates += result.duplicates;
      summary.failed += result.failed;
      if (result.status === 'failed') failedRuns += 1;
      if (result.status !== 'ok') degraded = true;
    }
    // D-11: `failed` needs every attempted run to fail; skipped sources are not failures.
    if (attempted > 0 && failedRuns === attempted) summary.status = 'failed';
    else if (degraded) summary.status = 'partial';
    return summary;
  };

  return {
    startCycle(trigger, scheduledFor) {
      const acquired = lock.acquire();
      if (!acquired.ok) return { kind: 'busy' };
      const { handle } = acquired;
      const startedAt = clock.now().getTime();
      // D-5: a timer that fires a little early or late still names the same slot.
      const slot =
        scheduledFor === undefined ? null : Math.round(scheduledFor / MINUTE_MS) * MINUTE_MS;

      let runId: number | 'slot_taken';
      try {
        runId = runs.startCycle(trigger, startedAt, slot);
      } catch (error) {
        handle.release();
        throw error;
      }
      if (runId === 'slot_taken') {
        handle.release();
        return { kind: 'slot_taken' };
      }
      const id = runId;
      held = handle;
      const heart = beat(handle);

      const done = (async (): Promise<CycleResult> => {
        let summary: CycleSummary;
        let results: SourceReport[] = [];
        try {
          results = await sources.runEnabled({
            parentRunId: id,
            trigger,
            shouldContinue: () => !heart.lost() && !stopping,
          });
          summary = summarise(results, clock.now().getTime());
        } catch (error) {
          logger?.warn(
            `cycle ${id}: internal error ${error instanceof Error ? error.name : 'error'}`,
          );
          summary = {
            status: 'failed',
            at: clock.now().getTime(),
            fetched: 0,
            new: 0,
            duplicates: 0,
            failed: 0,
            skipped: 0,
            error: { reason: 'internal' },
          };
        } finally {
          heart.stop();
          if (held === handle) held = null;
          handle.release();
        }
        // Guarded by `status = 'running'`: a run the new owner marked `interrupted` stays so.
        runs.finishCycle(id, summary);
        logger?.info(
          `cycle ${id}: ${summary.status} fetched ${summary.fetched} new ${summary.new} duplicates ${summary.duplicates} failed ${summary.failed} skipped ${summary.skipped}`,
        );
        return { summary, results };
      })();
      return { kind: 'started', runId: id, done: track(done) };
    },

    async runSource(id) {
      const acquired = lock.acquire();
      if (!acquired.ok) return { kind: 'busy' };
      const { handle } = acquired;
      held = handle;
      const heart = beat(handle);
      const work = (async (): Promise<SourceRunStart> => {
        try {
          return {
            kind: 'ran',
            outcome: await sources.run(id, { parentRunId: null, trigger: 'manual' }),
          };
        } finally {
          heart.stop();
          if (held === handle) held = null;
          handle.release();
        }
      })();
      return track(work);
    },

    list(query) {
      const { items, total } = runs.list(query);
      const iso = (ms: number): string => new Date(ms).toISOString();
      return {
        items: items.map((row) => ({
          ...row,
          startedAt: iso(row.startedAt),
          finishedAt: row.finishedAt === null ? null : iso(row.finishedAt),
          scheduledFor: row.scheduledFor === null ? null : iso(row.scheduledFor),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
        running: lock.isHeld(),
      };
    },

    async idle() {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },

    shutdown(at) {
      stopping = true;
      if (!held) return;
      const handle = held;
      held = null;
      handle.releaseInterrupted(at);
    },
  };
}
