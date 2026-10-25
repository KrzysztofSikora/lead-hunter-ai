import { RssConfig } from '@lead-hunter/contracts';
import { canonicalizeUrl } from '../../../modules/signals/identity.js';
import type { Clock } from '../../../modules/shared/clock.js';
import type { AdapterOutcome, SourceAdapter } from '../../../modules/sources/ports.js';
import { HttpFetchError, type HttpClient } from '../http/client.js';
import type { RobotsCheck } from '../manual/robots.js';
import { parseFeed } from './parse-feed.js';
import { parseRetryAfter, retryDelay } from './retry.js';

export interface RssAdapterDeps {
  http: HttpClient;
  robots: RobotsCheck;
  clock: Clock;
  timeoutMs: number;
  maxAttempts: number;
  maxTextChars: number;
  /** Injected so tests count requests without waiting (D-6). */
  sleep?: (ms: number) => Promise<void>;
}

const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8';
const RETRIED_STATUSES = new Set([429, 503]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The RSS 2.0 / Atom adapter: one guarded fetch (with 429/503 backoff) and a parse (S-10). */
export function createRssAdapter({
  http,
  robots,
  clock,
  timeoutMs,
  maxAttempts,
  maxTextChars,
  sleep = defaultSleep,
}: RssAdapterDeps): SourceAdapter {
  async function fetchAndParse(config: RssConfig): Promise<AdapterOutcome> {
    for (let attempt = 1; ; attempt += 1) {
      // D-8: robots.txt, every hop and the body share this attempt's deadline.
      const signal = AbortSignal.timeout(timeoutMs);
      let response;
      try {
        response = await http.get(config.url, {
          signal,
          accept: ACCEPT,
          beforeHop: (hop) => robots.check(hop, signal),
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
        const rateLimited: AdapterOutcome = {
          ok: false,
          reason: 'rate_limited',
          httpStatus: response.status,
          ...(retryAfterMs === null ? {} : { retryAfterMs }),
        };
        if (wait === 'stop' || attempt >= maxAttempts) return rateLimited;
        await sleep(wait);
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, reason: 'http_status', httpStatus: response.status };
      }
      const parsed = parseFeed(response.body, response.url, maxTextChars);
      if (parsed === 'invalid_feed') return { ok: false, reason: 'invalid_feed' };
      return { ok: true, items: parsed.items, skipped: parsed.skipped };
    }
  }

  return {
    type: 'rss',
    validateConfig(config) {
      const parsed = RssConfig.safeParse(config);
      if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
      try {
        return { ok: true, config: parsed.data, key: canonicalizeUrl(parsed.data.url) };
      } catch {
        return { ok: false, issues: ['Podaj poprawny adres URL (http lub https).'] };
      }
    },
    discover: fetchAndParse,
    healthCheck: fetchAndParse,
  };
}
