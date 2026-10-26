import type {
  AnalysisActiveEntry,
  AnalysisHistoryEntry,
  AnalysisReasonCode,
} from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';

const TITLE_MAX = 120;

export interface ActivityStart {
  opportunityId: number;
  title: string;
  provider: AnalysisActiveEntry['provider'];
  model: string;
  maxAttempts: number;
}

export interface ActivityTracker {
  /** Begins an entry and its first attempt; a previous unfinished entry is dropped. */
  start(entry: ActivityStart): void;
  /** Begins attempt `n`, after a backoff or the first call. */
  attempt(n: number): void;
  /** The previous attempt failed with `reason`; the next starts at `nextAttemptAt`. */
  backoff(nextAttemptAt: Date, reason: AnalysisReasonCode): void;
  saving(): void;
  /** Moves the active entry to the history. */
  finish(outcome: AnalysisHistoryEntry['outcome'], reason: AnalysisReasonCode | null): void;
  /** An entry that needed no provider call (a stored result was copied). */
  recordReused(entry: Omit<ActivityStart, 'maxAttempts'>): void;
  active(): AnalysisActiveEntry | null;
  history(): AnalysisHistoryEntry[];
}

export interface TrackerOptions {
  clock: Clock;
  maxEntries: number;
  maxAgeMs: number;
}

const clip = (title: string): string => title.slice(0, TITLE_MAX);

/**
 * FR-34 AC1, AC6, D-2: what the runner does now and a bounded memory of what it did. It holds
 * ids, titles, codes and times only; the history starts empty at every app start.
 */
export function createActivityTracker({
  clock,
  maxEntries,
  maxAgeMs,
}: TrackerOptions): ActivityTracker {
  let current: AnalysisActiveEntry | null = null;
  let finished: AnalysisHistoryEntry[] = [];

  const iso = (date: Date): string => date.toISOString();

  function prune(): void {
    const oldest = clock.now().getTime() - maxAgeMs;
    finished = finished
      .filter((entry) => Date.parse(entry.finishedAt) >= oldest)
      .slice(0, maxEntries);
  }

  function remember(entry: AnalysisHistoryEntry): void {
    finished.unshift(entry);
    prune();
  }

  return {
    start(entry) {
      const now = iso(clock.now());
      current = {
        opportunityId: entry.opportunityId,
        title: clip(entry.title),
        provider: entry.provider,
        model: entry.model,
        stage: 'requesting',
        startedAt: now,
        attemptStartedAt: now,
        attempt: 1,
        maxAttempts: entry.maxAttempts,
        nextAttemptAt: null,
        lastReason: null,
      };
    },
    attempt(n) {
      if (!current) return;
      current = {
        ...current,
        stage: 'requesting',
        attempt: n,
        attemptStartedAt: iso(clock.now()),
        nextAttemptAt: null,
      };
    },
    backoff(nextAttemptAt, reason) {
      if (!current) return;
      current = {
        ...current,
        stage: 'backoff',
        nextAttemptAt: iso(nextAttemptAt),
        lastReason: reason,
      };
    },
    saving() {
      if (!current) return;
      current = { ...current, stage: 'saving', nextAttemptAt: null };
    },
    finish(outcome, reason) {
      if (!current) return;
      const { opportunityId, title, provider, model, startedAt, attempt } = current;
      current = null;
      remember({
        opportunityId,
        title,
        provider,
        model,
        outcome,
        reason,
        reused: false,
        attempts: attempt,
        startedAt,
        finishedAt: iso(clock.now()),
      });
    },
    recordReused(entry) {
      const now = iso(clock.now());
      remember({
        opportunityId: entry.opportunityId,
        title: clip(entry.title),
        provider: entry.provider,
        model: entry.model,
        outcome: 'complete',
        reason: null,
        reused: true,
        attempts: 0,
        startedAt: now,
        finishedAt: now,
      });
    },
    active: () => current,
    history() {
      prune();
      return [...finished];
    },
  };
}
