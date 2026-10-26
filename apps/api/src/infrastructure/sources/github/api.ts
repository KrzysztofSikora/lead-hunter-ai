import type { SourceFailureReason } from '@lead-hunter/contracts';
import type { Clock } from '../../../modules/shared/clock.js';
import { HttpFetchError, type HttpClient } from '../http/client.js';
import { parseRetryAfter, retryDelay } from '../rss/retry.js';

export const GITHUB_API_ORIGIN = 'https://api.github.com';
/** S-19 D-5: 10 searches a minute without a token (6 s), 30 with one (2 s), plus a margin. */
export const GITHUB_GAP_ANONYMOUS_MS = 6_100;
export const GITHUB_GAP_TOKEN_MS = 2_100;
/** S-19 D-19: the `FETCH_MAX_BYTES` ceiling, for every GitHub (and Opire) request. */
export const GITHUB_MAX_BYTES = 5 * 1024 * 1024;
/** Lesson: a reset time from a source is bounded before it is used. */
export const GITHUB_MAX_WAIT_MS = 3_600_000;

export type GithubResult =
  | { ok: true; json: unknown }
  | { ok: false; reason: SourceFailureReason; httpStatus?: number; retryAfterMs?: number };

export interface GithubApi {
  /** `path` starts with `/` and is relative to `https://api.github.com`. */
  get(path: string): Promise<GithubResult>;
}

export interface GithubApiDeps {
  http: HttpClient;
  clock: Clock;
  token?: string | undefined;
  timeoutMs: number;
  maxAttempts: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const header = (
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

const bounded = (ms: number): number => Math.min(Math.max(ms, 0), GITHUB_MAX_WAIT_MS);

/**
 * The one way to ask api.github.com (S-19 D-5, D-9, D-19). One instance per runtime, so the
 * spacing holds across the search and Opire's issue checks.
 */
export function createGithubApi({
  http,
  clock,
  token,
  timeoutMs,
  maxAttempts,
  sleep = defaultSleep,
}: GithubApiDeps): GithubApi {
  const gap = token ? GITHUB_GAP_TOKEN_MS : GITHUB_GAP_ANONYMOUS_MS;
  let lastRequestAt: number | null = null;

  async function space(): Promise<void> {
    if (lastRequestAt !== null) {
      const wait = lastRequestAt + gap - clock.now().getTime();
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt = clock.now().getTime();
  }

  async function get(path: string): Promise<GithubResult> {
    const url = `${GITHUB_API_ORIGIN}${path}`;
    // D-9: the token goes to api.github.com only, whatever the caller passes.
    const headers: Record<string, string> = {
      'x-github-api-version': '2022-11-28',
      ...(token && new URL(url).origin === GITHUB_API_ORIGIN
        ? { authorization: `Bearer ${token}` }
        : {}),
    };
    for (let attempt = 1; ; attempt += 1) {
      await space();
      let response;
      try {
        response = await http.get(url, {
          signal: AbortSignal.timeout(timeoutMs),
          accept: 'application/vnd.github+json',
          maxBytes: GITHUB_MAX_BYTES,
          headers,
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
      const { status } = response;
      if (status === 403 || status === 429) {
        // Primary limit: nothing left until the reset time.
        if (header(response.headers, 'x-ratelimit-remaining') === '0') {
          const reset = Number(header(response.headers, 'x-ratelimit-reset'));
          return {
            ok: false,
            reason: 'rate_limited',
            httpStatus: status,
            ...(Number.isFinite(reset) ? { retryAfterMs: bounded(reset * 1000 - now) } : {}),
          };
        }
        const retryAfterMs = parseRetryAfter(header(response.headers, 'retry-after'), now);
        // Secondary limit: a 403 that names a wait.
        if (status === 403) {
          if (retryAfterMs === null) return { ok: false, reason: 'http_status', httpStatus: 403 };
          return {
            ok: false,
            reason: 'rate_limited',
            httpStatus: 403,
            retryAfterMs: bounded(retryAfterMs),
          };
        }
        const wait = retryDelay(attempt, retryAfterMs);
        if (wait === 'stop' || attempt >= maxAttempts) {
          return {
            ok: false,
            reason: 'rate_limited',
            httpStatus: 429,
            ...(retryAfterMs === null ? {} : { retryAfterMs: bounded(retryAfterMs) }),
          };
        }
        await sleep(wait);
        continue;
      }
      if (status === 503) {
        const wait = retryDelay(attempt, null);
        if (attempt >= maxAttempts) {
          return { ok: false, reason: 'rate_limited', httpStatus: 503 };
        }
        await sleep(wait as number);
        continue;
      }
      if (status < 200 || status >= 300)
        return { ok: false, reason: 'http_status', httpStatus: status };
      try {
        return { ok: true, json: JSON.parse(Buffer.from(response.body).toString('utf8')) };
      } catch {
        return { ok: false, reason: 'invalid_feed' };
      }
    }
  }

  return { get };
}
