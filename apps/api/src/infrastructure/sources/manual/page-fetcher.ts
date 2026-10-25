import type { Clock } from '../../../modules/shared/clock.js';
import type { PageFetcher } from '../../../modules/signals/ports.js';
import { HttpFetchError, type HttpClient } from '../http/client.js';
import { extractPage } from './extract.js';
import type { RobotsCheck } from './robots.js';

interface PageFetcherDeps {
  http: HttpClient;
  robots: RobotsCheck;
  timeoutMs: number;
  maxTextChars: number;
  clock: Clock;
  /** Host and reason only, never the body. */
  logger?: { info(message: string): void };
}

const ACCEPT = 'text/html,application/xhtml+xml,text/plain;q=0.8';

/** D-8: one deadline covers robots.txt, every hop, headers and body. */
export function createPageFetcher({
  http,
  robots,
  timeoutMs,
  maxTextChars,
  clock,
  logger,
}: PageFetcherDeps): PageFetcher {
  const log = (url: string, outcome: string): void => {
    const host = URL.canParse(url) ? new URL(url).host : 'unknown';
    logger?.info(`page fetch ${host}: ${outcome}`);
  };

  return {
    async fetch(url) {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await http.get(url, {
          signal,
          accept: ACCEPT,
          beforeHop: (hop) => robots.check(hop, signal),
        });
        if (response.status < 200 || response.status >= 300) {
          throw new HttpFetchError('http_status', response.status);
        }
        const contentType = response.headers['content-type'];
        const extracted = extractPage(
          response.body,
          (Array.isArray(contentType) ? contentType[0] : contentType) ?? '',
          response.url,
          maxTextChars,
        );
        if (typeof extracted === 'string') throw new HttpFetchError(extracted);
        log(url, 'ok');
        return { ok: true, ...extracted, fetchedAt: clock.now().getTime() };
      } catch (error) {
        const failure = error instanceof HttpFetchError ? error : new HttpFetchError('network');
        log(url, failure.reason);
        return {
          ok: false,
          reason: failure.reason,
          ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
        };
      }
    },
  };
}
