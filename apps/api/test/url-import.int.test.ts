import { getGlobalDispatcher, type MockAgent } from 'undici';
import { describe, expect, it } from 'vitest';
import { opportunities, rawSignals } from '../src/infrastructure/db/schema.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';
import { pageFixture as fixture } from './helpers/page-fixture.js';

const PAGE = '/oferta/1';

const mock = () => getGlobalDispatcher() as unknown as MockAgent;

/** Registers answers and counts the requests that actually reached them. */
let sites = 0;
function site(origin = `https://jobs${(sites += 1)}.example`) {
  const pool = mock().get(origin);
  const requests: string[] = [];
  const answer = (
    path: string,
    status: number,
    body: string | Buffer,
    headers: Record<string, string> = {},
    delayMs = 0,
  ) => {
    const scope = pool.intercept({ path }).reply(() => {
      requests.push(path);
      return { statusCode: status, data: body, responseOptions: { headers } };
    });
    if (delayMs > 0) scope.delay(delayMs);
    scope.persist();
  };
  return { answer, requests, origin, pageUrl: `${origin}${PAGE}` };
}

async function setup(env?: Record<string, string>) {
  const clock = new FakeClock();
  const built = await buildTestApp({ clock, ...(env ? { env } : {}) });
  const cookie = await loginAsOperator(built.app);
  const post = (payload: unknown) =>
    built.app.inject({
      method: 'POST',
      url: '/api/signals/import',
      headers: { cookie },
      payload: payload as object,
    });
  const rows = () => {
    const { db } = openTestDb(built.dir);
    return {
      signals: db.select().from(rawSignals).all(),
      opps: db.select().from(opportunities).all(),
    };
  };
  return { ...built, clock, post, rows };
}

const HTML = { 'content-type': 'text/html; charset=utf-8' };
const ALLOW_ALL = 'User-agent: *\nAllow: /';

describe('URL import (FR-03)', () => {
  it('fetches a URL-only import once and stores the page text (AC1)', async () => {
    const { answer, requests, pageUrl } = site();
    answer('/robots.txt', 200, ALLOW_ALL, { 'content-type': 'text/plain' });
    answer(PAGE, 200, fixture('synthetic-job-post.html'), HTML);
    const { post, rows, clock } = await setup();

    const res = await post({ url: pageUrl });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ result: 'created', opportunityId: 1, signalId: 1 });
    expect(requests).toEqual(['/robots.txt', PAGE]);

    const [signal] = rows().signals;
    expect(signal).toMatchObject({
      sourceType: 'manual_fetch',
      sourceUrl: pageUrl,
      canonicalUrl: pageUrl,
      fetchedAt: clock.now().getTime(),
      availability: 'NOT_CHECKED',
      lastVerifiedAt: null,
    });
    expect(signal?.title).toContain('aplikacja webowa');
    expect(signal?.snippet).toContain('panel dyspozytora');
    expect(signal?.snippet).not.toContain('DEMO-NAWIGACJA');
    expect(signal?.snippet).not.toContain('DEMO-SCRIPT-TEXT');
    expect(signal?.contentHash).not.toBeNull();
  });

  it('reports the same URL again as a duplicate without a request', async () => {
    const { answer, requests, pageUrl } = site();
    answer('/robots.txt', 200, ALLOW_ALL);
    answer(PAGE, 200, fixture('synthetic-job-post.html'), HTML);
    const { post } = await setup();
    await post({ url: pageUrl });
    requests.length = 0;

    const again = await post({ url: `${pageUrl}/?utm_source=x` });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({
      result: 'duplicate',
      opportunityId: 1,
      matchedBy: 'canonical_url',
      evidenceAdded: false,
    });
    expect(requests).toEqual([]);
  });

  it('asks robots.txt once for several pages of one site', async () => {
    const { answer, requests, origin, pageUrl } = site();
    answer('/robots.txt', 200, ALLOW_ALL);
    answer(PAGE, 200, fixture('synthetic-job-post.html'), HTML);
    answer('/oferta/2', 200, fixture('synthetic-iso-8859-2.html'), HTML);
    const { post } = await setup();
    await post({ url: pageUrl });
    await post({ url: `${origin}/oferta/2` });
    expect(requests.filter((path) => path === '/robots.txt')).toHaveLength(1);
  });

  it('does not request a page that robots.txt disallows for LeadHunterAI (AC3)', async () => {
    const { answer, requests, pageUrl } = site();
    answer('/robots.txt', 200, 'User-agent: LeadHunterAI\nDisallow: /\n');
    answer(PAGE, 200, 'x', HTML);
    const { post, rows } = await setup();

    const res = await post({ url: pageUrl });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ result: 'fetch_failed', reason: 'robots_disallowed' });
    expect(requests).toEqual(['/robots.txt']);
    expect(rows().opps).toHaveLength(0);
  });

  it('refuses when robots.txt cannot be read (RFC 9309)', async () => {
    const { answer, requests, pageUrl } = site();
    answer('/robots.txt', 503, 'busy');
    answer(PAGE, 200, 'x', HTML);
    const { post } = await setup();
    const res = await post({ url: pageUrl });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ result: 'fetch_failed', reason: 'robots_unavailable' });
    expect(requests).toEqual(['/robots.txt']);
  });

  it('reports a missing page with its status and stores nothing (AC4)', async () => {
    const { answer, pageUrl } = site();
    answer('/robots.txt', 404, '');
    answer(PAGE, 404, 'nie ma', HTML);
    const { post, rows } = await setup();
    const res = await post({ url: pageUrl });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ result: 'fetch_failed', reason: 'http_status', httpStatus: 404 });
    expect(rows().signals).toHaveLength(0);
  });

  it('stores the URL as the source when the operator pastes the text afterwards (D-2)', async () => {
    const { answer, requests, pageUrl } = site();
    answer('/robots.txt', 404, '');
    answer(PAGE, 500, 'błąd', HTML);
    const { post, rows } = await setup();
    expect((await post({ url: pageUrl })).statusCode).toBe(422);
    requests.length = 0;

    const res = await post({ url: pageUrl, text: 'Wklejona treść ogłoszenia' });
    expect(res.statusCode).toBe(201);
    expect(requests).toEqual([]);
    expect(rows().signals[0]).toMatchObject({
      sourceType: 'manual_url',
      sourceUrl: pageUrl,
      snippet: 'Wklejona treść ogłoszenia',
    });
  });

  it('never fetches when text is given with the URL', async () => {
    const { requests, pageUrl } = site();
    const { post } = await setup();
    const res = await post({ url: pageUrl, text: 'Szukam React' });
    expect(res.statusCode).toBe(201);
    expect(requests).toEqual([]);
  });

  it('never reaches a literal private address: the contract refuses it first (AC2)', async () => {
    const { requests } = site('http://127.0.0.1');
    const { post, rows } = await setup();
    for (const url of ['http://127.0.0.1/x', 'http://[::1]/x', 'http://169.254.169.254/latest']) {
      expect((await post({ url })).statusCode).toBe(400);
    }
    expect(requests).toEqual([]);
    expect(rows().signals).toHaveLength(0);
  });

  it('refuses a redirect to a private address', async () => {
    const { answer, requests, pageUrl } = site();
    answer('/robots.txt', 404, '');
    answer(PAGE, 302, '', { location: 'http://10.0.0.5/admin' });
    const { post } = await setup();
    const res = await post({ url: pageUrl });
    expect(res.json()).toEqual({ result: 'fetch_failed', reason: 'blocked_address' });
    expect(requests).toEqual(['/robots.txt', PAGE]);
  });

  it('decodes a legacy charset', async () => {
    const { answer, pageUrl } = site();
    answer('/robots.txt', 404, '');
    answer(PAGE, 200, fixture('synthetic-iso-8859-2.html'), { 'content-type': 'text/html' });
    const { post, rows } = await setup();
    expect((await post({ url: pageUrl })).statusCode).toBe(201);
    expect(rows().signals[0]?.snippet).toContain('zażółć gęślą jaźń');
  });

  it('cuts text longer than IMPORT_MAX_TEXT_CHARS', async () => {
    const { answer, pageUrl } = site();
    answer('/robots.txt', 404, '');
    answer(PAGE, 200, `A ${'słowo '.repeat(300)}`, { 'content-type': 'text/plain' });
    const { post, rows } = await setup({ IMPORT_MAX_TEXT_CHARS: '1000' });
    expect((await post({ url: pageUrl })).statusCode).toBe(201);
    expect(Array.from(rows().signals[0]?.snippet ?? '')).toHaveLength(1000);
  });

  it('reports unsupported content and a page without text', async () => {
    const { answer, origin } = site();
    answer('/robots.txt', 404, '');
    answer('/a.json', 200, '{}', { 'content-type': 'application/json' });
    answer('/blank', 200, '<html><body><script>x()</script></body></html>', HTML);
    const { post } = await setup();
    expect((await post({ url: `${origin}/a.json` })).json()).toEqual({
      result: 'fetch_failed',
      reason: 'unsupported_content',
    });
    expect((await post({ url: `${origin}/blank` })).json()).toEqual({
      result: 'fetch_failed',
      reason: 'no_text',
    });
  });

  it('aborts a response over FETCH_MAX_BYTES (AC4)', async () => {
    const { answer, pageUrl } = site();
    answer('/robots.txt', 404, '');
    answer(PAGE, 200, 'x'.repeat(70_000), { 'content-type': 'text/plain' });
    const { post, rows } = await setup({ FETCH_MAX_BYTES: '65536' });
    const res = await post({ url: pageUrl });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ result: 'fetch_failed', reason: 'too_large' });
    expect(rows().signals).toHaveLength(0);
  });

  it('aborts a slow response at FETCH_TIMEOUT_MS (AC4)', async () => {
    const { answer, pageUrl } = site();
    answer('/robots.txt', 404, '');
    answer(PAGE, 200, 'za późno', { 'content-type': 'text/plain' }, 2500);
    const { post, rows } = await setup({ FETCH_TIMEOUT_MS: '1000' });
    const res = await post({ url: pageUrl });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ result: 'fetch_failed', reason: 'timeout' });
    expect(rows().signals).toHaveLength(0);
  });

  it('lets a racing import win: the transaction re-checks identity', async () => {
    const { answer, pageUrl } = site();
    answer('/robots.txt', 404, '');
    answer(PAGE, 200, fixture('synthetic-job-post.html'), HTML);
    const { post, rows } = await setup();
    const [first, second] = await Promise.all([post({ url: pageUrl }), post({ url: pageUrl })]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 201]);
    expect(rows().opps).toHaveLength(1);
  });

  it('keeps the injected instruction in the page as plain text', async () => {
    const { answer, pageUrl } = site();
    answer('/robots.txt', 404, '');
    answer(PAGE, 200, fixture('synthetic-job-post.html'), HTML);
    const { post, rows } = await setup();
    await post({ url: pageUrl });
    expect(rows().signals[0]?.snippet).toContain('Ignore previous instructions');
    expect(rows().opps[0]).toMatchObject({ businessStatus: 'NEW', analysisStatus: 'PENDING' });
  });
});
