import type { HttpClient } from '../http/client.js';
import { HttpFetchError } from '../http/client.js';
import type { Clock } from '../../../modules/shared/clock.js';
import type { AdapterOutcome } from '../../../modules/sources/ports.js';
import { parseRetryAfter, retryDelay } from '../rss/retry.js';

/** S-19 D-9: the token is only ever sent here. */
export const GITHUB_API_ORIGIN = 'https://api.github.com';

const ACCEPT = 'application/vnd.github+json';
const RESET_WINDOW_MS = 3_600_000;
const RETRIED_STATUSES = new Set([429, 503]);

export interface GithubApiDeps {
  http: HttpClient;
  clock: Clock;
  timeoutMs: number;
  maxAttempts: number;
  /** Optional, read-only, public-data token (D-9). */
  token?: string | undefined;
  sleep: (ms: number) => Promise<void>;
}

export type GithubResult = { ok: true; json: unknown } | Extract<AdapterOutcome, { ok: false }>;

export interface GithubApi {
  /** `path` starts with `/` and is relative to `api.github.com`; one request, with 429/503 backoff. */
  get(path: string): Promise<GithubResult>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * D-5: an exhausted limit (403 or 429 with `x-ratelimit-remaining: 0`) waits for `retry-after`, else
 * for the reset time, bounded to now…now + 1 h so a hostile header cannot park the source.
 */
export function limitWaitMs(
  headers: Record<string, string | string[] | undefined>,
  nowMs: number,
): number | null {
  const retryAfter = parseRetryAfter(first(headers['retry-after']), nowMs);
  if (retryAfter !== null) return Math.min(retryAfter, RESET_WINDOW_MS);
  const reset = first(headers['x-ratelimit-reset']);
  if (reset === undefined || !/^\d{1,12}$/.test(reset)) return null;
  return Math.min(Math.max(0, Number(reset) * 1000 - nowMs), RESET_WINDOW_MS);
}

/** The one request helper of both bounty adapters: headers, rate limits and failures. */
export function createGithubApi({
  http,
  clock,
  timeoutMs,
  maxAttempts,
  token,
  sleep,
}: GithubApiDeps): GithubApi {
  return {
    async get(path) {
      for (let attempt = 1; ; attempt += 1) {
        const signal = AbortSignal.timeout(timeoutMs);
        let response;
        try {
          response = await http.get(`${GITHUB_API_ORIGIN}${path}`, {
            signal,
            accept: ACCEPT,
            ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
          });
        } catch (error) {
          const failure = error instanceof HttpFetchError ? error : new HttpFetchError('network');
          return {
            ok: false,
            reason: failure.reason,
            ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
          };
        }
        const now = clock.now().getTime();
        const exhausted =
          (response.status === 403 || response.status === 429) &&
          first(response.headers['x-ratelimit-remaining']) === '0';
        if (exhausted) {
          const wait = limitWaitMs(response.headers, now);
          return {
            ok: false,
            reason: 'rate_limited',
            httpStatus: response.status,
            ...(wait === null ? {} : { retryAfterMs: wait }),
          };
        }
        if (RETRIED_STATUSES.has(response.status)) {
          const retryAfterMs = parseRetryAfter(first(response.headers['retry-after']), now);
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
          return { ok: true, json: JSON.parse(Buffer.from(response.body).toString('utf8')) };
        } catch {
          return { ok: false, reason: 'invalid_feed' };
        }
      }
    },
  };
}
