import { TedConfig } from '@lead-hunter/contracts';
import type { Clock } from '../../../modules/shared/clock.js';
import type { AdapterOutcome, FeedItem, SourceAdapter } from '../../../modules/sources/ports.js';
import { HttpFetchError, type HttpClient } from '../http/client.js';
import { parseRetryAfter, retryDelay } from '../rss/retry.js';
import { mapTedNotice, TED_FIELDS } from './map-notice.js';
import { buildTedQuery } from './query.js';

export const TED_ENDPOINT = 'https://api.ted.europa.eu/v3/notices/search';
/** S-18 D-10: the same spacing as BZP; TED's fair-use limit (700 per minute) is far above it. */
export const TED_MIN_GAP_MS = 2_000;
export const TED_PAGE_SIZE = 100;
export const TED_PAGE_CAP = 5;
/** The same per-request limit as BZP (plan-review 13). */
export const TED_MAX_BYTES = 5 * 1024 * 1024;
const DAY_MS = 24 * 3_600_000;
const RETRIED_STATUSES = new Set([429, 503]);

export interface TedAdapterDeps {
  http: HttpClient;
  clock: Clock;
  timeoutMs: number;
  maxAttempts: number;
  maxTextChars: number;
  sleep?: (ms: number) => Promise<void>;
  /** Counts only, never notice text (FR-24 AC2). */
  logger?: { info(message: string): void };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type Page =
  { ok: true; notices: unknown[]; next: string | null } | Extract<AdapterOutcome, { ok: false }>;

/**
 * The TED search API v3 (S-18 D-1, D-9, D-11, D-19). Like BZP it reads the window in UTC-day
 * slices, oldest first, and pages each slice in `ITERATION` mode.
 */
export function createTedAdapter({
  http,
  clock,
  timeoutMs,
  maxAttempts,
  maxTextChars,
  sleep = defaultSleep,
  logger,
}: TedAdapterDeps): SourceAdapter<TedConfig> {
  let lastRequestAt: number | null = null;

  async function space(): Promise<void> {
    if (lastRequestAt !== null) {
      const wait = lastRequestAt + TED_MIN_GAP_MS - clock.now().getTime();
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt = clock.now().getTime();
  }

  async function fetchPage(
    config: TedConfig,
    day: number,
    token: string | null,
    limit: number,
  ): Promise<Page> {
    const body = JSON.stringify({
      query: buildTedQuery(config, day),
      fields: TED_FIELDS,
      limit,
      scope: 'ACTIVE',
      paginationMode: 'ITERATION',
      ...(token === null ? {} : { iterationNextToken: token }),
    });
    for (let attempt = 1; ; attempt += 1) {
      await space();
      let response;
      try {
        response = await http.post(TED_ENDPOINT, {
          signal: AbortSignal.timeout(timeoutMs),
          accept: 'application/json',
          contentType: 'application/json',
          body,
          maxBytes: TED_MAX_BYTES,
        });
      } catch (error) {
        const failure = error instanceof HttpFetchError ? error : new HttpFetchError('network');
        return {
          ok: false,
          reason: failure.reason,
          ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
        };
      }
      if (RETRIED_STATUSES.has(response.status)) {
        const header = response.headers['retry-after'];
        const retryAfterMs = parseRetryAfter(
          Array.isArray(header) ? header[0] : header,
          clock.now().getTime(),
        );
        const wait = retryDelay(attempt, retryAfterMs);
        if (wait === 'stop' || attempt >= maxAttempts) {
          return {
            ok: false,
            reason: 'rate_limited',
            httpStatus: response.status,
            ...(retryAfterMs === null ? {} : { retryAfterMs }),
          };
        }
        await sleep(wait);
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, reason: 'http_status', httpStatus: response.status };
      }
      try {
        const parsed: unknown = JSON.parse(Buffer.from(response.body).toString('utf8'));
        const envelope = parsed as { notices?: unknown; iterationNextToken?: unknown } | null;
        if (typeof envelope !== 'object' || envelope === null || !Array.isArray(envelope.notices)) {
          return { ok: false, reason: 'invalid_feed' };
        }
        const next =
          typeof envelope.iterationNextToken === 'string' && envelope.iterationNextToken !== ''
            ? envelope.iterationNextToken
            : null;
        return { ok: true, notices: envelope.notices, next };
      } catch {
        return { ok: false, reason: 'invalid_feed' };
      }
    }
  }

  async function discover(config: TedConfig, since: number): Promise<AdapterOutcome> {
    const now = clock.now().getTime();
    const items: FeedItem[] = [];
    let skipped = 0;
    let requests = 0;
    const dropped = { notice_type: 0, cpv: 0, cpvCodes: 0 };
    const finish = (outcome: AdapterOutcome): AdapterOutcome => {
      logger?.info(
        `ted: ignored notice_type ${dropped.notice_type} cpv ${dropped.cpv}; cpv codes cut ${dropped.cpvCodes}; requests ${requests}`,
      );
      return outcome;
    };
    for (let day = Math.floor(since / DAY_MS) * DAY_MS; day <= now; day += DAY_MS) {
      let token: string | null = null;
      for (;;) {
        if (requests >= TED_PAGE_CAP) {
          return finish({ ok: true, items, skipped, truncated: true, resumeFrom: day });
        }
        requests += 1;
        // A failure drops the pages already read: the next run repeats the window (plan-review 8).
        const result: Page = await fetchPage(config, day, token, TED_PAGE_SIZE);
        if (!result.ok) return result;
        for (const raw of result.notices) {
          const mapped = mapTedNotice(raw, config, maxTextChars);
          if (mapped.kind === 'item') {
            items.push(mapped.item);
            dropped.cpvCodes += mapped.cpvDropped;
          } else if (mapped.kind === 'ignored') dropped[mapped.reason] += 1;
          else skipped += 1;
        }
        // Stop on an empty page (third-party advice for ITERATION mode). A full page without a
        // token cannot be continued: say so with a partial run instead of dropping the rest.
        if (result.notices.length === 0) break;
        if (result.next === null) {
          if (result.notices.length >= TED_PAGE_SIZE) {
            return finish({ ok: true, items, skipped, truncated: true, resumeFrom: day });
          }
          break;
        }
        token = result.next;
      }
    }
    return finish({ ok: true, items, skipped });
  }

  return {
    type: 'ted',
    validateConfig(config) {
      const parsed = TedConfig.safeParse(config);
      if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
      return { ok: true, config: parsed.data, key: 'ted' };
    },
    discover: (config, { since }) => discover(config, since),
    async healthCheck(config) {
      const day = Math.floor(clock.now().getTime() / DAY_MS) * DAY_MS;
      const result = await fetchPage(config, day, null, 1);
      if (!result.ok) return result;
      const items = result.notices.flatMap((raw) => {
        const mapped = mapTedNotice(raw, config, maxTextChars);
        return mapped.kind === 'item' ? [mapped.item] : [];
      });
      return { ok: true, items, skipped: 0 };
    },
  };
}
