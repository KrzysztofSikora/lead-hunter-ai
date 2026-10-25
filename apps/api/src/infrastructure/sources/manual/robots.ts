import robotsModule from 'robots-parser';
import type { Clock } from '../../../modules/shared/clock.js';
import { HttpFetchError, type HttpClient } from '../http/client.js';

// The package is CommonJS: at runtime the import is the function, NodeNext types it as the module.
const robotsParser = robotsModule as unknown as typeof robotsModule.default;

export const ROBOTS_CACHE_MS = 24 * 60 * 60 * 1000;

export interface RobotsCheck {
  /** Resolves when `url` may be fetched; throws `robots_disallowed` or `robots_unavailable`. */
  check(url: URL, signal: AbortSignal): Promise<void>;
}

interface RobotsDeps {
  http: HttpClient;
  /** The product token robots.txt groups address, without the version. */
  userAgentToken: string;
  clock: Clock;
}

type Rules = { isAllowed(url: string, userAgent?: string): boolean | undefined } | 'allow-all';

/** Guard and deadline errors tell the operator more than "robots unavailable", so they pass. */
const PASS_THROUGH = new Set(['blocked_address', 'blocked_url', 'timeout']);

/**
 * D-7, RFC 9309 §2.3.1: 2xx is parsed, 4xx means no restrictions, 5xx or an unreachable file is a
 * complete disallow. Parsed and 4xx outcomes are cached per origin for 24 h; failures are not.
 */
export function createRobotsCheck({ http, userAgentToken, clock }: RobotsDeps): RobotsCheck {
  const cache = new Map<string, { rules: Rules; expiresAt: number }>();

  async function load(origin: string, signal: AbortSignal): Promise<Rules> {
    const robotsUrl = `${origin}/robots.txt`;
    let response;
    try {
      response = await http.get(robotsUrl, { signal, accept: 'text/plain' });
    } catch (error) {
      if (error instanceof HttpFetchError && PASS_THROUGH.has(error.reason)) throw error;
      throw new HttpFetchError('robots_unavailable');
    }
    if (response.status >= 200 && response.status < 300) {
      return robotsParser(robotsUrl, new TextDecoder().decode(response.body));
    }
    if (response.status >= 400 && response.status < 500) return 'allow-all';
    throw new HttpFetchError('robots_unavailable');
  }

  return {
    async check(url, signal) {
      const now = clock.now().getTime();
      let entry = cache.get(url.origin);
      if (!entry || entry.expiresAt <= now) {
        entry = { rules: await load(url.origin, signal), expiresAt: now + ROBOTS_CACHE_MS };
        cache.set(url.origin, entry);
      }
      if (
        entry.rules !== 'allow-all' &&
        entry.rules.isAllowed(url.href, userAgentToken) === false
      ) {
        throw new HttpFetchError('robots_disallowed');
      }
    },
  };
}
