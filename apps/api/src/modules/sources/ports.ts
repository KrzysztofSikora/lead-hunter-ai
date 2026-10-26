import type { SourceFailureReason, SourceKind, TenderFacts } from '@lead-hunter/contracts';
import type { JobTrigger } from '../jobs/ports.js';

/** One entry of a feed, mapped to the fields of a raw signal (S-10 Design). */
export interface FeedItem {
  /** `guid`/`id`, else the link: the item's identity inside its source (D-3, D-4). */
  key: string | null;
  url: string | null;
  title: string;
  text: string;
  publishedAt: number | null;
  /** S-18 D-2: set by the tender adapters only; validated by the service before it is stored. */
  tender?: TenderFacts;
}

/** S-18 D-9: what the service tells an adapter about the run. */
export interface DiscoverContext {
  /** UTC epoch ms: notices published since then are wanted. */
  since: number;
  /**
   * R1: with `since` = a stored `resumeFrom`, the position inside that day where the last run
   * stopped (opaque to the service); absent means the start of the day.
   */
  resumeAt?: string;
}

export type AdapterOutcome =
  | {
      ok: true;
      items: FeedItem[];
      skipped: number;
      /** S-18 D-9: the adapter stopped at its page cap; the run is `partial`. */
      truncated?: true;
      /**
       * Plan-review 1, D-21: with `truncated`, the start (UTC epoch ms) of the first part of the
       * window that was not fetched completely; the next run asks from there, not from
       * `lastSuccessAt`.
       */
      resumeFrom?: number;
      /** R1: with `resumeFrom`, where inside that day to continue, so a large day still advances. */
      resumeAt?: string;
    }
  | {
      ok: false;
      reason: SourceFailureReason;
      httpStatus?: number;
      /** The wait the source asked for (`Retry-After`), when it did. */
      retryAfterMs?: number;
    };

export type ConfigCheck<C = unknown> =
  { ok: true; config: C; key: string } | { ok: false; issues: string[] };

/**
 * Brief §5.2. The cursor is applied by the service (D-3), so an adapter is fetch-and-map only.
 * S-18 D-1: generic over its config; the service picks the adapter by the source's type.
 */
export interface SourceAdapter<C = unknown> {
  type: SourceKind;
  validateConfig(config: unknown): ConfigCheck<C>;
  discover(config: C, context: DiscoverContext): Promise<AdapterOutcome>;
  /** The same guarded fetch and parse (one page); the caller stores nothing from it (D-9). */
  healthCheck(config: C): Promise<AdapterOutcome>;
}

/** The service holds one adapter per type. Method bivariance lets `SourceAdapter<RssConfig>` in. */
export type SourceAdapters = Record<SourceKind, SourceAdapter>;

export interface SourceRecord {
  id: number;
  type: SourceKind;
  name: string;
  configJson: string;
  configKey: string;
  presetId: string | null;
  enabled: boolean;
  /** S-17 D-1: `SourceFilter` JSON, `null` = off and empty. */
  filterJson: string | null;
  cursorJson: string | null;
  /** UTC epoch ms */
  nextAllowedAt: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: { reason: SourceFailureReason; httpStatus?: number; at: number } | null;
}

export interface NewSource {
  type: SourceKind;
  name: string;
  configJson: string;
  configKey: string;
  presetId: string | null;
  filterJson: string | null;
  at: number;
}

export type ClaimResult =
  | { ok: true; nextAllowedAt: number | null }
  | { ok: false; reason: 'not_found' | 'disabled' | 'too_soon'; nextAllowedAt?: number };

export interface RunSummary {
  status: 'ok' | 'partial' | 'failed';
  at: number;
  fetched: number;
  new: number;
  duplicates: number;
  failed: number;
  error?: { reason: SourceFailureReason; httpStatus?: number };
}

export type AttemptOutcome =
  { ok: true } | { ok: false; reason: SourceFailureReason; httpStatus?: number };

/** S-12: who started a run, and the cycle it belongs to. */
export interface RunContext {
  parentRunId: number | null;
  trigger: JobTrigger;
}

export interface SourceRepository {
  list(): SourceRecord[];
  get(id: number): SourceRecord | undefined;
  /** `undefined` when the config key is already taken. */
  insert(source: NewSource): SourceRecord | undefined;
  update(
    id: number,
    patch: { enabled?: boolean; filterJson?: string; configJson?: string },
    at: number,
  ): SourceRecord | undefined;
  /** D-5: one atomic step; a run also pushes `next_allowed_at` forward by `intervalMs`. */
  claimRun(id: number, now: number, intervalMs: number): ClaimResult;
  /** D-21: a check waits for a pending `next_allowed_at` and for its own short cooldown only. */
  claimCheck(id: number, now: number, cooldownMs: number): ClaimResult;
  /** Stores the outcome of the attempt; a failure may also move `next_allowed_at` forward. */
  finishAttempt(id: number, outcome: AttemptOutcome, at: number, nextAllowedAt?: number): void;
  saveCursor(id: number, cursorJson: string): void;
  startRun(sourceId: number, at: number, context?: RunContext): number;
  finishRun(runId: number, summary: RunSummary): void;
}
