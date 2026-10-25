import type { RssConfig, SourceFailureReason } from '@lead-hunter/contracts';
import type { JobTrigger } from '../jobs/ports.js';

/** One entry of a feed, mapped to the fields of a raw signal (S-10 Design). */
export interface FeedItem {
  /** `guid`/`id`, else the link: the item's identity inside its source (D-3, D-4). */
  key: string | null;
  url: string | null;
  title: string;
  text: string;
  publishedAt: number | null;
}

export type AdapterOutcome =
  | { ok: true; items: FeedItem[]; skipped: number }
  | {
      ok: false;
      reason: SourceFailureReason;
      httpStatus?: number;
      /** The wait the source asked for (`Retry-After`), when it did. */
      retryAfterMs?: number;
    };

export type ConfigCheck =
  { ok: true; config: RssConfig; key: string } | { ok: false; issues: string[] };

/** Brief §5.2. The cursor is applied by the service (D-3), so an adapter is fetch-and-map only. */
export interface SourceAdapter {
  type: 'rss';
  validateConfig(config: unknown): ConfigCheck;
  discover(config: RssConfig): Promise<AdapterOutcome>;
  /** The same guarded fetch and parse; the caller stores nothing from it (D-9). */
  healthCheck(config: RssConfig): Promise<AdapterOutcome>;
}

export interface SourceRecord {
  id: number;
  type: 'rss';
  name: string;
  configJson: string;
  configKey: string;
  presetId: string | null;
  enabled: boolean;
  cursorJson: string | null;
  /** UTC epoch ms */
  nextAllowedAt: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: { reason: SourceFailureReason; httpStatus?: number; at: number } | null;
}

export interface NewSource {
  name: string;
  configJson: string;
  configKey: string;
  presetId: string | null;
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
  setEnabled(id: number, enabled: boolean, at: number): SourceRecord | undefined;
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
