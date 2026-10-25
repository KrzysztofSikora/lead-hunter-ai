import { describe, expect, it } from 'vitest';
import { createHttpClient } from '../http/client.js';
import { createPageFetcher } from './page-fetcher.js';
import { createRobotsCheck } from './robots.js';

const resolveTo =
  (address: string) => (_host: string, _options: object, cb: (e: null, a: object[]) => void) =>
    cb(null, [{ address, family: 4 }]);

function fetcherWith(resolve: ReturnType<typeof resolveTo>, log: string[] = []) {
  const clock = { now: () => new Date(0) };
  const http = createHttpClient({
    userAgent: 'LeadHunterAI/test',
    maxBytes: 65_536,
    resolve: resolve as never,
  });
  return createPageFetcher({
    http,
    robots: createRobotsCheck({ http, userAgentToken: 'LeadHunterAI', clock }),
    timeoutMs: 2000,
    maxTextChars: 1000,
    clock,
    logger: { info: (message) => log.push(message) },
  });
}

describe('page fetcher with the real guarded client (FR-03 AC2)', () => {
  it('reports a host that resolves to a private address as blocked, not as robots trouble', async () => {
    const log: string[] = [];
    const result = await fetcherWith(resolveTo('10.0.0.5'), log).fetch(
      'http://internal.test/oferta',
    );
    expect(result).toEqual({ ok: false, reason: 'blocked_address' });
    expect(log).toEqual(['page fetch internal.test: blocked_address']);
  });

  it.each(['127.0.0.1', '169.254.169.254', '::1', 'fd00:ec2::254'])(
    'blocks a name that resolves to %s',
    async (address) => {
      const result = await fetcherWith(resolveTo(address)).fetch('http://metadata.test/x');
      expect(result).toEqual({ ok: false, reason: 'blocked_address' });
    },
  );

  it('blocks a literal address before any lookup', async () => {
    let lookups = 0;
    const resolve = ((...args: Parameters<ReturnType<typeof resolveTo>>) => {
      lookups += 1;
      return resolveTo('93.184.216.34')(...args);
    }) as ReturnType<typeof resolveTo>;
    const result = await fetcherWith(resolve).fetch('http://[::ffff:10.0.0.1]/x');
    expect(result).toEqual({ ok: false, reason: 'blocked_address' });
    expect(lookups).toBe(0);
  });
});
