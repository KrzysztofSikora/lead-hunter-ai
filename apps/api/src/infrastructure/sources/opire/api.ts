import type { AdapterOutcome } from '../../../modules/sources/ports.js';
import type { Clock } from '../../../modules/shared/clock.js';
import { HttpFetchError, type HttpClient } from '../http/client.js';
import { GITHUB_MAX_BYTES, GITHUB_MAX_WAIT_MS } from '../github/api.js';
import { parseRetryAfter } from '../rss/retry.js';

export const OPIRE_REWARDS_URL = 'https://api.opire.dev/rewards';

export interface OpireApiDeps {
  http: HttpClient;
  clock: Clock;
  timeoutMs: number;
}

/**
 * One GET of Opire's list (S-19 D-1, D-9, D-19). It sends no credentials of its own and never the
 * GitHub token: no `headers` are passed to the client.
 */
export function createOpireList({ http, clock, timeoutMs }: OpireApiDeps) {
  return async function fetchList(): Promise<
    { ok: true; json: unknown } | Extract<AdapterOutcome, { ok: false }>
  > {
    let response;
    try {
      response = await http.get(OPIRE_REWARDS_URL, {
        signal: AbortSignal.timeout(timeoutMs),
        accept: 'application/json',
        maxBytes: GITHUB_MAX_BYTES,
      });
    } catch (error) {
      const failure = error instanceof HttpFetchError ? error : new HttpFetchError('network');
      return {
        ok: false,
        reason: failure.reason,
        ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
      };
    }
    const { status } = response;
    if (status === 429 || status === 503) {
      const header = response.headers['retry-after'];
      const wait = parseRetryAfter(
        Array.isArray(header) ? header[0] : header,
        clock.now().getTime(),
      );
      return {
        ok: false,
        reason: 'rate_limited',
        httpStatus: status,
        ...(wait === null ? {} : { retryAfterMs: Math.min(Math.max(wait, 0), GITHUB_MAX_WAIT_MS) }),
      };
    }
    if (status < 200 || status >= 300)
      return { ok: false, reason: 'http_status', httpStatus: status };
    try {
      return { ok: true, json: JSON.parse(Buffer.from(response.body).toString('utf8')) };
    } catch {
      return { ok: false, reason: 'invalid_feed' };
    }
  };
}
