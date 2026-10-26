import { BzpConfig } from '@lead-hunter/contracts';
import type { Clock } from '../../../modules/shared/clock.js';
import type { AdapterOutcome, FeedItem, SourceAdapter } from '../../../modules/sources/ports.js';
import { BZP_ENDPOINT } from '../../../modules/sources/endpoints.js';
import { HttpFetchError, type HttpClient } from '../http/client.js';
import { parseRetryAfter, retryDelay } from '../rss/retry.js';
import { BZP_CONTRACT_NOTICE, mapBzpNotice } from './map-notice.js';

export { BZP_ENDPOINT };
/** S-18 D-10 and plan-review 7: 2.1 s between two requests keeps a run under 30 per minute. */
export const BZP_MIN_GAP_MS = 2_100;
export const BZP_PAGE_SIZE = 100;
export const BZP_PAGE_CAP = 10;
/** Plan-review 13: one list page may be this large (the client-wide cap is 1 MiB by default). */
export const BZP_MAX_BYTES = 5 * 1024 * 1024;
/** D-18: the documented over-limit answer; the next attempt waits at least the source interval. */
const RATE_LIMIT_WAIT_MS = 60_000;
const DAY_MS = 24 * 3_600_000;
const RETRIED_STATUSES = new Set([429, 503]);

export interface BzpAdapterDeps {
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

type Page = { ok: true; notices: unknown[] } | Extract<AdapterOutcome, { ok: false }>;

/**
 * The e-Zamówienia BZP notice API (S-18 D-1, D-9, D-10). The window is read in UTC-day slices,
 * oldest first, so a run that hits the page cap leaves a gap that starts at a known day.
 */
export function createBzpAdapter({
  http,
  clock,
  timeoutMs,
  maxAttempts,
  maxTextChars,
  sleep = defaultSleep,
  logger,
}: BzpAdapterDeps): SourceAdapter<BzpConfig> {
  let lastRequestAt: number | null = null;

  /** Waits until the gap since the last request (also one of a health check) has passed. */
  async function space(): Promise<void> {
    if (lastRequestAt !== null) {
      const wait = lastRequestAt + BZP_MIN_GAP_MS - clock.now().getTime();
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt = clock.now().getTime();
  }

  async function fetchPage(from: number, pageNumber: number, pageSize: number): Promise<Page> {
    const url = new URL(BZP_ENDPOINT);
    // `UNVERIFIED` parameter names; the CPV match is client-side because the API takes whole codes.
    url.searchParams.set('NoticeType', BZP_CONTRACT_NOTICE);
    url.searchParams.set('PublicationDateFrom', new Date(from).toISOString());
    url.searchParams.set('PublicationDateTo', new Date(from + DAY_MS).toISOString());
    url.searchParams.set('PageSize', String(pageSize));
    url.searchParams.set('PageNumber', String(pageNumber));
    for (let attempt = 1; ; attempt += 1) {
      await space();
      let response;
      try {
        response = await http.get(url.href, {
          signal: AbortSignal.timeout(timeoutMs),
          accept: 'application/json',
          maxBytes: BZP_MAX_BYTES,
        });
      } catch (error) {
        const failure = error instanceof HttpFetchError ? error : new HttpFetchError('network');
        return {
          ok: false,
          reason: failure.reason,
          ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
        };
      }
      if (response.status === 403) {
        return {
          ok: false,
          reason: 'rate_limited',
          httpStatus: 403,
          retryAfterMs: RATE_LIMIT_WAIT_MS,
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
        if (!Array.isArray(parsed)) return { ok: false, reason: 'invalid_feed' };
        return { ok: true, notices: parsed };
      } catch {
        return { ok: false, reason: 'invalid_feed' };
      }
    }
  }

  async function discover(
    config: BzpConfig,
    since: number,
    resumeAt: string | undefined,
  ): Promise<AdapterOutcome> {
    const now = clock.now().getTime();
    const items: FeedItem[] = [];
    let skipped = 0;
    let requests = 0;
    const dropped = { notice_type: 0, cpv: 0, cpvCodes: 0 };
    const finish = (outcome: AdapterOutcome): AdapterOutcome => {
      logger?.info(
        `bzp: ignored notice_type ${dropped.notice_type} cpv ${dropped.cpv}; cpv codes cut ${dropped.cpvCodes}; requests ${requests}`,
      );
      return outcome;
    };
    const firstDay = Math.floor(since / DAY_MS) * DAY_MS;
    const resumePage = Number(resumeAt);
    for (let day = firstDay; day <= now; day += DAY_MS) {
      // R1: a day larger than the cap continues on the next run where this one stopped.
      const startPage =
        day === firstDay && Number.isInteger(resumePage) && resumePage >= 1 ? resumePage : 1;
      for (let page = startPage; ; page += 1) {
        if (requests >= BZP_PAGE_CAP) {
          return finish({
            ok: true,
            items,
            skipped,
            truncated: true,
            resumeFrom: day,
            ...(page > 1 ? { resumeAt: String(page) } : {}),
          });
        }
        requests += 1;
        // A failure drops the pages already read: the next run repeats the window (plan-review 8).
        const result = await fetchPage(day, page, BZP_PAGE_SIZE);
        if (!result.ok) return result;
        for (const raw of result.notices) {
          const mapped = mapBzpNotice(raw, config, maxTextChars);
          if (mapped.kind === 'item') {
            items.push(mapped.item);
            dropped.cpvCodes += mapped.cpvDropped;
          } else if (mapped.kind === 'ignored') dropped[mapped.reason] += 1;
          else skipped += 1;
        }
        if (result.notices.length < BZP_PAGE_SIZE) break;
      }
    }
    return finish({ ok: true, items, skipped });
  }

  return {
    type: 'bzp',
    validateConfig(config) {
      const parsed = BzpConfig.safeParse(config);
      if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
      return { ok: true, config: parsed.data, key: 'bzp' };
    },
    discover: (config, { since, resumeAt }) => discover(config, since, resumeAt),
    async healthCheck(config) {
      const day = Math.floor(clock.now().getTime() / DAY_MS) * DAY_MS;
      const result = await fetchPage(day, 1, 1);
      if (!result.ok) return result;
      const items = result.notices.flatMap((raw) => {
        const mapped = mapBzpNotice(raw, config, maxTextChars);
        return mapped.kind === 'item' ? [mapped.item] : [];
      });
      return { ok: true, items, skipped: 0 };
    },
  };
}
