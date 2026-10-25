import { Cron } from 'croner';
import type { Clock } from '../../modules/shared/clock.js';

const MINUTE_MS = 60_000;
/** D-7: work held back by the daily limit resumes on a later tick. */
export const ANALYSIS_TICK_MS = 10 * MINUTE_MS;
const TIMEZONE = 'Europe/Warsaw';

export interface SchedulerOptions {
  /** `HH:MM` in Europe/Warsaw, already validated by the config (D-6). */
  times: string[];
  /** D-5: the slot as UTC ms rounded to the nearest minute, so an early or late timer gives one key. */
  onSlot(slotMs: number): void;
  analysisTick(): void;
  onError?(error: unknown): void;
  tickMs?: number;
  clock?: Clock;
}

/**
 * A slot that finds the lock busy is tried again until the window ends (plan-review round 2 #1);
 * the slot index (D-5) makes a repeat after a success harmless. Returns the cancel function.
 */
export function retryWhileBusy(
  attempt: () => 'busy' | 'done',
  { retryMs = 30_000, windowMs = 30 * MINUTE_MS, onGiveUp }: RetryOptions = {},
): () => void {
  if (attempt() === 'done') return () => undefined;
  const deadline = Date.now() + windowMs;
  const timer = setInterval(() => {
    if (attempt() === 'done') clearInterval(timer);
    else if (Date.now() >= deadline) {
      clearInterval(timer);
      onGiveUp?.();
    }
  }, retryMs);
  timer.unref();
  return () => clearInterval(timer);
}

export interface RetryOptions {
  retryMs?: number;
  windowMs?: number;
  onGiveUp?(): void;
}

export interface Scheduler {
  nextRunAt(): Date | null;
  /** Permanent: a stopped scheduler is replaced by a new `startScheduler`. */
  stop(): void;
}

export function startScheduler({
  times,
  onSlot,
  analysisTick,
  onError,
  tickMs = ANALYSIS_TICK_MS,
  clock = { now: () => new Date() },
}: SchedulerOptions): Scheduler {
  const fail = (error: unknown): void => onError?.(error);
  const jobs = times.map((time) => {
    const [hour, minute] = time.split(':').map(Number);
    return new Cron(
      `${minute} ${hour} * * *`,
      { timezone: TIMEZONE, protect: true, catch: fail, unref: true },
      () => onSlot(Math.round(clock.now().getTime() / MINUTE_MS) * MINUTE_MS),
    );
  });
  const timer = setInterval(() => {
    try {
      analysisTick();
    } catch (error) {
      fail(error);
    }
  }, tickMs);
  timer.unref();

  return {
    nextRunAt() {
      const next = jobs
        .map((job) => job.nextRun())
        .filter((date): date is Date => date !== null)
        .sort((a, b) => a.getTime() - b.getTime());
      return next[0] ?? null;
    },
    stop() {
      clearInterval(timer);
      for (const job of jobs) job.stop();
    },
  };
}
