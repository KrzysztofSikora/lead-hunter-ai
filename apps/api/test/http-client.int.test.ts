import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpClient, HttpFetchError } from '../src/infrastructure/sources/http/client.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let port: number;
let connections: number;
let handler: Handler;

beforeEach(async () => {
  connections = 0;
  handler = (_req, res) => res.end('hello');
  server = createServer((req, res) => handler(req, res));
  server.on('connection', () => {
    connections += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const UA = 'LeadHunterAI/test (+https://example.invalid)';
const loopbackResolver = (_h: string, _o: object, cb: (e: null, a: object[]) => void) =>
  cb(null, [{ address: '127.0.0.1', family: 4 }]);
const privateResolver = (_h: string, _o: object, cb: (e: null, a: object[]) => void) =>
  cb(null, [{ address: '10.0.0.5', family: 4 }]);

/** Resolves every name to loopback and allows it, so a real socket reaches the test server. */
function permissiveClient(extra: { maxBytes?: number; maxInFlight?: number } = {}) {
  return createHttpClient({
    userAgent: UA,
    maxBytes: extra.maxBytes ?? 1024,
    ...(extra.maxInFlight ? { maxInFlight: extra.maxInFlight } : {}),
    resolve: loopbackResolver as never,
    isAllowed: () => true,
  });
}

const get = (client: ReturnType<typeof createHttpClient>, url: string, ms = 5000, extra = {}) =>
  client.get(url, { signal: AbortSignal.timeout(ms), accept: 'text/html', ...extra });

async function reasonOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpFetchError);
    return (error as HttpFetchError).reason;
  }
  return expect.unreachable('expected a refusal');
}

describe('guarded HTTP client (TR-03, FR-03 AC2/AC4)', () => {
  it('refuses an IP-literal host without opening a connection', async () => {
    const client = createHttpClient({ userAgent: UA, maxBytes: 1024 });
    expect(await reasonOf(get(client, `http://127.0.0.1:${port}/`))).toBe('blocked_address');
    expect(await reasonOf(get(client, `http://[::1]:${port}/`))).toBe('blocked_address');
    expect(connections).toBe(0);
  });

  it('refuses a host that resolves to a private address, after consulting the resolver', async () => {
    let resolved = 0;
    const client = createHttpClient({
      userAgent: UA,
      maxBytes: 1024,
      resolve: ((h: string, o: object, cb: (e: null, a: object[]) => void) => {
        resolved += 1;
        privateResolver(h, o, cb);
      }) as never,
    });
    expect(await reasonOf(get(client, `http://internal.test:${port}/`))).toBe('blocked_address');
    expect(resolved).toBeGreaterThan(0);
    expect(connections).toBe(0);
  });

  it('refuses a host whose second DNS answer turns private (rebinding)', async () => {
    let calls = 0;
    handler = (_req, res) => res.setHeader('connection', 'close').end('first');
    const client = createHttpClient({
      userAgent: UA,
      maxBytes: 1024,
      resolve: ((_h: string, _o: object, cb: (e: null, a: object[]) => void) => {
        calls += 1;
        cb(null, [{ address: calls === 1 ? '127.0.0.1' : '10.0.0.5', family: 4 }]);
      }) as never,
      isAllowed: (ip) => ip === '127.0.0.1', // loopback stands in for the public answer
    });
    expect((await get(client, `http://rebind.test:${port}/`)).status).toBe(200);
    expect(connections).toBe(1);
    expect(await reasonOf(get(client, `http://rebind.test:${port}/`))).toBe('blocked_address');
    expect(connections).toBe(1);
  });

  it('fetches a page and sends the user agent', async () => {
    let seen: IncomingMessage | undefined;
    handler = (req, res) => {
      seen = req;
      res.setHeader('content-type', 'text/html');
      res.end('<p>ok</p>');
    };
    const response = await get(permissiveClient(), `http://ok.test:${port}/a`);
    expect(response.status).toBe(200);
    expect(Buffer.from(response.body).toString()).toBe('<p>ok</p>');
    expect(response.url).toBe(`http://ok.test:${port}/a`);
    expect(seen?.headers['user-agent']).toBe(UA);
    expect(seen?.headers['accept-encoding']).toBe('identity');
    expect(seen?.headers.accept).toBe('text/html');
  });

  it('returns a non-2xx status to the caller', async () => {
    handler = (_req, res) => res.writeHead(404).end('no');
    expect((await get(permissiveClient(), `http://ok.test:${port}/`)).status).toBe(404);
  });

  it('follows a redirect and reports the final URL', async () => {
    handler = (req, res) =>
      req.url === '/start' ? res.writeHead(302, { location: '/end' }).end() : res.end('end');
    const response = await get(permissiveClient(), `http://ok.test:${port}/start`);
    expect(response.url).toBe(`http://ok.test:${port}/end`);
    expect(Buffer.from(response.body).toString()).toBe('end');
  });

  it('refuses a redirect to a blocked literal at the second hop', async () => {
    handler = (_req, res) =>
      res.writeHead(302, { location: `http://169.254.169.254/latest` }).end();
    const client = createHttpClient({
      userAgent: UA,
      maxBytes: 1024,
      resolve: loopbackResolver as never,
      isAllowed: (ip) => ip === '127.0.0.1',
    });
    expect(await reasonOf(get(client, `http://ok.test:${port}/`))).toBe('blocked_address');
    expect(connections).toBe(1);
  });

  it('refuses a redirect to a hostname that resolves private', async () => {
    handler = (_req, res) =>
      res.writeHead(302, { location: `http://internal.test:${port}/` }).end();
    const client = createHttpClient({
      userAgent: UA,
      maxBytes: 1024,
      resolve: ((h: string, o: object, cb: (e: null, a: object[]) => void) =>
        (h === 'internal.test' ? privateResolver : loopbackResolver)(h, o, cb)) as never,
      isAllowed: (ip) => ip === '127.0.0.1',
    });
    expect(await reasonOf(get(client, `http://ok.test:${port}/`))).toBe('blocked_address');
    expect(connections).toBe(1);
  });

  it.each(['ftp://example.com/x', 'file:///etc/passwd', 'http://user:pw@example.com/'])(
    'refuses a redirect to %s',
    async (location) => {
      handler = (_req, res) => res.writeHead(302, { location }).end();
      expect(await reasonOf(get(permissiveClient(), `http://ok.test:${port}/`))).toBe(
        'blocked_url',
      );
      expect(connections).toBe(1);
    },
  );

  it('allows five redirects and stops at the sixth', async () => {
    handler = (req, res) => {
      const n = Number(req.url?.slice(1) ?? 0);
      if (n < 5) res.writeHead(302, { location: `/${n + 1}` }).end();
      else res.end('five');
    };
    const ok = await get(permissiveClient(), `http://ok.test:${port}/0`);
    expect(Buffer.from(ok.body).toString()).toBe('five');
    handler = (req, res) => {
      const n = Number(req.url?.slice(1) ?? 0);
      res.writeHead(302, { location: `/${n + 1}` }).end();
    };
    expect(await reasonOf(get(permissiveClient(), `http://ok.test:${port}/0`))).toBe(
      'too_many_redirects',
    );
  });

  it('aborts on a Content-Length above the limit before the body is sent', async () => {
    let bodySent = false;
    handler = (_req, res) => {
      res.writeHead(200, { 'content-length': '2000000' });
      res.flushHeaders();
      setTimeout(() => {
        bodySent = true;
        res.end('x');
      }, 300);
    };
    const client = permissiveClient({ maxBytes: 1_000_000 });
    expect(await reasonOf(get(client, `http://ok.test:${port}/`))).toBe('too_large');
    expect(bodySent).toBe(false);
  });

  it('aborts a chunked body that passes the limit', async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      res.write('x'.repeat(600));
      setTimeout(() => res.end('y'.repeat(600)), 20);
    };
    expect(await reasonOf(get(permissiveClient(), `http://ok.test:${port}/`))).toBe('too_large');
  });

  it('does not read an endless body behind a redirect', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: '/x' });
      res.write('x'.repeat(100));
    };
    expect(await reasonOf(get(permissiveClient(), `http://ok.test:${port}/`, 300))).not.toBe(
      'too_large',
    );
  });

  it('times out when the server never answers', async () => {
    handler = () => undefined;
    expect(await reasonOf(get(permissiveClient(), `http://ok.test:${port}/`, 200))).toBe('timeout');
  });

  it('reports a refused connection as network', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    expect(await reasonOf(get(permissiveClient(), `http://ok.test:${closedPort}/`))).toBe(
      'network',
    );
  });

  it('keeps at most two requests in flight', async () => {
    let active = 0;
    let peak = 0;
    handler = (_req, res) => {
      active += 1;
      peak = Math.max(peak, active);
      setTimeout(() => {
        active -= 1;
        res.end('done');
      }, 80);
    };
    const client = permissiveClient();
    const results = await Promise.all(
      [1, 2, 3].map((n) => get(client, `http://ok.test:${port}/${n}`)),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(peak).toBe(2);
  });

  it('ends a queued request with the deadline', async () => {
    handler = () => undefined;
    const client = permissiveClient({ maxInFlight: 1 });
    const first = get(client, `http://ok.test:${port}/1`, 400).catch(() => undefined);
    const queued = get(client, `http://ok.test:${port}/2`, 100);
    expect(await reasonOf(queued)).toBe('timeout');
    await first;
  });

  it('runs beforeHop before taking a slot, so a nested request cannot deadlock', async () => {
    handler = (_req, res) => res.end('page');
    const client = permissiveClient({ maxInFlight: 2 });
    const hooks: string[] = [];
    const withRobots = (n: number) =>
      get(client, `http://ok.test:${port}/page${n}`, 3000, {
        beforeHop: async (url: URL) => {
          hooks.push(url.pathname);
          await get(client, `http://ok.test:${port}/robots${n}`, 3000);
        },
      });
    const [a, b, c] = await Promise.all([withRobots(1), withRobots(2), withRobots(3)]);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(hooks.sort()).toEqual(['/page1', '/page2', '/page3']);
  });

  it('lets beforeHop refuse a hop', async () => {
    const refuse = async () => {
      throw new HttpFetchError('robots_disallowed');
    };
    expect(
      await reasonOf(
        get(permissiveClient(), `http://ok.test:${port}/`, 1000, { beforeHop: refuse }),
      ),
    ).toBe('robots_disallowed');
    expect(connections).toBe(0);
  });
});
