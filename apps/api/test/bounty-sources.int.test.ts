import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { opportunities, rawSignals, sources } from '../src/infrastructure/db/schema.js';
import type {
  AdapterOutcome,
  DiscoverContext,
  FeedItem,
  SourceAdapter,
} from '../src/modules/sources/ports.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';
import { profile } from './helpers/analysis.js';

const HOUR = 3_600_000;
const GITHUB_CONFIG = { labels: ['bounty'], languages: ['TypeScript'] };

const reward = { amountMinor: 20_000, currency: 'USD', quote: '[$200]' } as const;
const facts = (n: number, withReward: boolean) => ({
  platform: 'github' as const,
  repository: 'demo/repo',
  issueNumber: n,
  labels: ['bounty'],
  reward: withReward ? reward : null,
});
const item = (n: number, over: Partial<FeedItem> = {}): FeedItem => ({
  key: `github:demo/repo#${n}`,
  url: `https://github.com/demo/repo/issues/${n}`,
  title: `DEMO issue ${n}`,
  text: `DEMO issue ${n}\nRepozytorium: demo/repo`,
  publishedAt: null,
  bounty: facts(n, true),
  ...over,
});

/** A stand-in for the real adapter (Phase 3): replays queued outcomes, records what it was given. */
function fakeAdapter(outcomes: AdapterOutcome[]): SourceAdapter & { contexts: DiscoverContext[] } {
  const contexts: DiscoverContext[] = [];
  return {
    type: 'github',
    contexts,
    validateConfig: (config) => ({ ok: true, config, key: 'github' }),
    async discover(_config, context) {
      contexts.push(context);
      return outcomes.shift() ?? { ok: true, items: [], skipped: 0 };
    },
    healthCheck: async () => ({ ok: true, items: [], skipped: 0 }),
  };
}

async function setup(adapter?: SourceAdapter) {
  const clock = new FakeClock();
  const warnings: string[] = [];
  const built = await buildTestApp({
    clock,
    env: { LLM_PROVIDER: 'mock' },
    sourceLogger: { info: () => undefined, warn: (message) => warnings.push(message) },
    ...(adapter ? { adapters: { github: adapter } } : {}),
  });
  const cookie = await loginAsOperator(built.app);
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const db = () => openTestDb(built.dir).db;
  /** Phase 3 adds the preset; until then the source is inserted as the preset will. */
  const addSource = (type: 'github' | 'opire' | 'rss', config: object, key: string): number =>
    db()
      .insert(sources)
      .values({
        type,
        name: `DEMO ${type}`,
        configJson: JSON.stringify(config),
        configKey: key,
        enabled: true,
        createdAt: clock.now().getTime(),
        updatedAt: clock.now().getTime(),
      })
      .returning({ id: sources.id })
      .get().id;
  return { ...built, clock, call, db, addSource, warnings };
}

describe('generic source types and bounty facts (S-19 D-1, D-2)', () => {
  it('stores a github item with its source type and validated facts', async () => {
    const adapter = fakeAdapter([
      {
        ok: true,
        items: [item(1), item(2, { bounty: facts(2, false) }), item(3, { bounty: undefined })],
        skipped: 0,
      },
    ]);
    const { call, db, addSource } = await setup(adapter);
    const id = addSource('github', GITHUB_CONFIG, 'github');

    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.json()).toMatchObject({ status: 'ok', fetched: 3, new: 3 });

    const rows = db().select().from(rawSignals).where(eq(rawSignals.sourceId, id)).all();
    expect(rows.map((row) => row.sourceType)).toEqual(['github', 'github', 'github']);
    expect(JSON.parse(rows[0]?.bountyJson ?? 'null')).toEqual(facts(1, true));
    expect(JSON.parse(rows[1]?.bountyJson ?? 'null').reward).toBeNull();
    expect(rows[2]?.bountyJson).toBeNull();
  });

  it('stores an item with invalid facts without them, and logs the source id only', async () => {
    const broken = { ...facts(1, true), reward: { ...reward, amountMinor: -5 } };
    const adapter = fakeAdapter([{ ok: true, items: [item(1, { bounty: broken })], skipped: 0 }]);
    const { call, db, addSource, warnings } = await setup(adapter);
    const id = addSource('github', GITHUB_CONFIG, 'github');

    expect((await call('POST', `/api/sources/${id}/run`)).json()).toMatchObject({
      status: 'ok',
      new: 1,
    });
    expect(db().select().from(rawSignals).get()?.bountyJson).toBeNull();
    expect(warnings).toEqual([`source ${id} api.github.com: bounty_facts_invalid`]);
  });

  it('hands the cursor keys to the adapter and remembers checked keys', async () => {
    const adapter = fakeAdapter([
      { ok: true, items: [item(1)], skipped: 0, checkedKeys: ['github:demo/closed#9'] },
      { ok: true, items: [item(1)], skipped: 0 },
    ]);
    const { call, clock, addSource } = await setup(adapter);
    const id = addSource('github', GITHUB_CONFIG, 'github');

    await call('POST', `/api/sources/${id}/run`);
    clock.advance(HOUR);
    const second = await call('POST', `/api/sources/${id}/run`);

    expect([...(adapter.contexts[0]?.seen ?? [])]).toEqual([]);
    expect([...(adapter.contexts[1]?.seen ?? [])].sort()).toEqual([
      'github:demo/closed#9',
      'github:demo/repo#1',
    ]);
    expect(second.json()).toMatchObject({ status: 'ok', new: 0, duplicates: 1 });
  });

  it('marks a truncated run partial', async () => {
    const adapter = fakeAdapter([{ ok: true, items: [item(1)], skipped: 0, truncated: true }]);
    const { call, addSource } = await setup(adapter);
    const id = addSource('github', GITHUB_CONFIG, 'github');

    expect((await call('POST', `/api/sources/${id}/run`)).json()).toMatchObject({
      status: 'partial',
      new: 1,
      failed: 0,
    });
  });

  it('fails a run explicitly when no adapter is registered for the stored type', async () => {
    const { call, addSource, db, clock } = await setup();
    const id = addSource('opire', {}, 'opire');

    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.json()).toMatchObject({ status: 'failed', error: { reason: 'internal' } });
    expect(db().select().from(rawSignals).all()).toEqual([]);
    clock.advance(HOUR + 60_000);
    expect((await call('POST', `/api/sources/${id}/check`)).json()).toMatchObject({
      ok: false,
      error: { reason: 'internal' },
    });
  });

  it('lists a github source with its settings and the API endpoint, not a feed URL', async () => {
    const { call, addSource } = await setup(fakeAdapter([]));
    addSource('github', GITHUB_CONFIG, 'github');
    addSource('rss', { url: 'https://feeds.example/x.xml' }, 'https://feeds.example/x.xml');

    const [github, rss] = (await call('GET', '/api/sources')).json().items;
    expect(github).toMatchObject({
      type: 'github',
      url: 'https://api.github.com/search/issues',
      github: GITHUB_CONFIG,
    });
    expect(rss).toMatchObject({ type: 'rss', github: null });
  });
});

describe('PATCH github settings (S-19 D-11)', () => {
  it('stores and returns a valid config on a github source', async () => {
    const { call, addSource } = await setup(fakeAdapter([]));
    const id = addSource('github', GITHUB_CONFIG, 'github');
    const next = { labels: ['bounty', '💎 Bounty'], languages: ['Go'] };

    const res = await call('PATCH', `/api/sources/${id}`, { github: next });
    expect(res.statusCode).toBe(200);
    expect(res.json().github).toEqual(next);
    expect((await call('GET', '/api/sources')).json().items[0].github).toEqual(next);
  });

  it('refuses github settings on a source of another type and for an unknown id', async () => {
    const { call, addSource } = await setup(fakeAdapter([]));
    const rss = addSource(
      'rss',
      { url: 'https://feeds.example/x.xml' },
      'https://feeds.example/x.xml',
    );

    const wrong = await call('PATCH', `/api/sources/${rss}`, { github: GITHUB_CONFIG });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toEqual({ error: 'not_github_source' });
    expect((await call('PATCH', '/api/sources/999', { github: GITHUB_CONFIG })).statusCode).toBe(
      404,
    );
  });

  it('rejects an invalid config and leaves the stored one unchanged', async () => {
    const { call, addSource } = await setup(fakeAdapter([]));
    const id = addSource('github', GITHUB_CONFIG, 'github');

    for (const github of [
      { labels: [], languages: [] },
      { labels: ['a"b'], languages: [] },
      { labels: ['a'], languages: ['Brainfuck'] },
    ]) {
      expect((await call('PATCH', `/api/sources/${id}`, { github })).statusCode).toBe(400);
    }
    expect((await call('GET', '/api/sources')).json().items[0].github).toEqual(GITHUB_CONFIG);
  });
});

describe('analysis of bounty signals (S-19 D-10, FR-33 AC1, FR-27 AC1)', () => {
  const stated = item(1, {
    title: 'DEMO TypeScript parser fails [$200]',
    text: 'DEMO TypeScript parser fails [$200]\nRepozytorium: demo/repo\nThe parser throws on every empty input and the stack trace points into the lexer.',
  });
  const unstated = item(2, {
    title: 'DEMO TypeScript parser fails',
    text: 'DEMO TypeScript parser fails\nRepozytorium: demo/repo\nWe have $500 of CI credit, and the parser throws on every empty input.',
    bounty: facts(2, false),
  });

  it('sets the budget from the stated reward only, and keeps the request level', async () => {
    const adapter = fakeAdapter([{ ok: true, items: [stated, unstated], skipped: 0 }]);
    const { call, addSource, runner, db } = await setup(adapter);
    const id = addSource('github', GITHUB_CONFIG, 'github');
    await call('POST', `/api/sources/${id}/run`);
    await runner.drain();

    const rows = db().select().from(opportunities).orderBy(opportunities.id).all();
    expect(rows).toHaveLength(2);
    const [withReward, withoutReward] = rows;
    const first = (await call('GET', `/api/opportunities/${withReward!.id}`)).json();
    const second = (await call('GET', `/api/opportunities/${withoutReward!.id}`)).json();

    expect(withReward).toMatchObject({ analysisStatus: 'COMPLETE', amountMaxMinor: 20_000 });
    expect(first.latestAnalysis.result.sourceBudget).toMatchObject({
      maxMinor: 20_000,
      quote: '[$200]',
    });
    expect(withoutReward).toMatchObject({ analysisStatus: 'COMPLETE', amountMaxMinor: null });
    expect(second.latestAnalysis.result.sourceBudget).toBeNull();
    expect(second.analysis.evidenceLevel).not.toBe('DIRECT_REQUEST');
  });
});

// ---- GitHub search adapter (Phase 3) --------------------------------------------------------

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/bounties/${name}`, import.meta.url)), 'utf8');
const TS_PAGE = fixture('github-search-typescript.json');
const JS_PAGE = fixture('github-search-javascript.json');
const GITHUB = 'https://api.github.com';
const TOKEN = 'ghp_DEMOcanary0123456789';

type Answer = { status: number; body?: string; headers?: Record<string, string> };
interface Seen {
  q: string;
  perPage: string | null;
  authorization: string | undefined;
}
let githubSeen: Seen[] = [];
let githubAnswer: (q: string, index: number) => Answer = () => ({ status: 200, body: TS_PAGE });

beforeAll(() => {
  const agent = getGlobalDispatcher() as unknown as MockAgent;
  agent
    .get(GITHUB)
    .intercept({ path: (path: string) => path.startsWith('/search/issues') })
    .reply((opts) => {
      const url = new URL(opts.path, GITHUB);
      const headers = opts.headers as Record<string, string> | undefined;
      githubSeen.push({
        q: url.searchParams.get('q') ?? '',
        perPage: url.searchParams.get('per_page'),
        authorization: headers?.authorization ?? headers?.Authorization,
      });
      const answer = githubAnswer(url.searchParams.get('q') ?? '', githubSeen.length - 1);
      return {
        statusCode: answer.status,
        data: answer.body ?? '',
        responseOptions: { headers: answer.headers ?? { 'content-type': 'application/json' } },
      };
    })
    .persist();
});

beforeEach(() => {
  githubSeen = [];
  githubAnswer = (q) => ({
    status: 200,
    body: q.includes('language:JavaScript') ? JS_PAGE : TS_PAGE,
  });
});

describe('GitHub search source (S-19 D-3, D-4, D-5, FR-33 AC1)', () => {
  async function github(options: { env?: Record<string, string>; languages?: boolean } = {}) {
    const sleeps: number[] = [];
    const clock = new FakeClock();
    const warnings: string[] = [];
    const lines: string[] = [];
    const built = await buildTestApp({
      clock,
      env: { LLM_PROVIDER: 'mock', ...options.env },
      sourceSleep: async (ms) => {
        sleeps.push(ms);
      },
      sourceLogger: {
        info: (message) => lines.push(message),
        warn: (message) => {
          warnings.push(message);
          lines.push(message);
        },
      },
    });
    const cookie = await loginAsOperator(built.app);
    const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object) =>
      built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
    await call(
      'PUT',
      '/api/profile',
      profile({
        skills: ['TypeScript', 'Node.js', 'Arduino'],
        preferredTechnologies: [],
      }),
    );
    const db = () => openTestDb(built.dir).db;
    const add = async () => {
      const created = await call('POST', '/api/sources', { preset: 'github-bounties' });
      return { created, id: created.json().id as number };
    };
    return { ...built, clock, call, db, add, sleeps, lines, warnings };
  }

  it('adds the preset once, with languages from the profile', async () => {
    const { add, call } = await github();
    const { created } = await add();
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      type: 'github',
      name: 'GitHub — płatne zgłoszenia (bounty)',
      presetId: 'github-bounties',
      github: { labels: ['bounty', 'paid', '💎 Bounty'], languages: ['TypeScript', 'JavaScript'] },
    });
    expect((await call('POST', '/api/sources', { preset: 'github-bounties' })).statusCode).toBe(
      409,
    );
    expect(
      (await call('GET', '/api/sources')).json().presets.map((p: { id: string }) => p.id),
    ).toContain('github-bounties');
  });

  it('sends one query per language with the fixed qualifiers and spaces them (anonymous)', async () => {
    const { add, call, db, sleeps } = await github();
    const { id } = await add();

    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.json()).toMatchObject({ status: 'partial', fetched: 7, new: 6, failed: 1 });

    expect(githubSeen.map((r) => r.q)).toEqual([
      'is:issue is:open archived:false label:bounty,paid,"💎 Bounty" language:TypeScript',
      'is:issue is:open archived:false label:bounty,paid,"💎 Bounty" language:JavaScript',
    ]);
    expect(githubSeen.map((r) => r.perPage)).toEqual(['30', '30']);
    expect(githubSeen.map((r) => r.authorization)).toEqual([undefined, undefined]);
    expect(sleeps).toEqual([6_100]);

    const rows = db().select().from(rawSignals).where(eq(rawSignals.sourceId, id)).all();
    const urls = rows.map((row) => row.sourceUrl).sort();
    expect(urls).toContain('https://github.com/demo-org/demo-api/issues/11');
    expect(urls).not.toContain('https://github.com/demo-org/demo-ui/pull/15');
    expect(urls.every((url) => url?.startsWith('https://github.com/'))).toBe(true);
    const rewards = Object.fromEntries(
      rows.map((row) => [
        row.sourceUrl,
        JSON.parse(row.bountyJson ?? 'null')?.reward?.amountMinor ?? null,
      ]),
    );
    expect(rewards).toMatchObject({
      'https://github.com/demo-org/demo-api/issues/11': 25_000,
      'https://github.com/demo-org/demo-api/issues/12': 20_000,
      'https://github.com/demo-org/demo-ui/issues/13': null,
      'https://github.com/demo-org/demo-ui/issues/14': null,
      'https://github.com/demo-org/demo-api/issues/17': null,
      'https://github.com/demo-org/demo-js/issues/21': null,
    });
    // An open bounty does not go stale with the age of its issue (plan-review 2).
    expect(rows.every((row) => row.publishedAt === null)).toBe(true);
  });

  it('uses the token for the header and the closer spacing; both states', async () => {
    const withToken = await github({ env: { GITHUB_TOKEN: TOKEN } });
    const { id } = await withToken.add();
    await withToken.call('POST', `/api/sources/${id}/run`);
    expect(githubSeen.map((r) => r.authorization)).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
    expect(withToken.sleeps).toEqual([2_100]);

    // The token never shows in what the operator and the logs can see.
    const listed = JSON.stringify((await withToken.call('GET', '/api/sources')).json());
    const rows = JSON.stringify(withToken.db().select().from(rawSignals).all());
    const sourceRows = JSON.stringify(withToken.db().select().from(sources).all());
    for (const place of [listed, rows, sourceRows, withToken.lines.join('\n')]) {
      expect(place).not.toContain(TOKEN);
    }
  });

  it('keeps the earlier page when a later query fails, and marks the run partial', async () => {
    githubAnswer = (q) =>
      q.includes('language:JavaScript')
        ? { status: 500, body: '{}' }
        : { status: 200, body: TS_PAGE };
    const { add, call, db } = await github();
    const { id } = await add();

    expect((await call('POST', `/api/sources/${id}/run`)).json()).toMatchObject({
      status: 'partial',
      new: 5,
    });
    expect(githubSeen).toHaveLength(2);
    expect(db().select().from(rawSignals).all()).toHaveLength(5);
  });

  it('fails explicitly: 500, bad JSON, wrong shape, and stores nothing', async () => {
    const { add, call, db, clock } = await github();
    const { id } = await add();
    const cases: [Answer, object][] = [
      [
        { status: 500, body: '{}' },
        { reason: 'http_status', httpStatus: 500 },
      ],
      [{ status: 200, body: '<html>' }, { reason: 'invalid_feed' }],
      [{ status: 200, body: '{"items": 3}' }, { reason: 'invalid_feed' }],
      [
        { status: 403, body: '{}' },
        { reason: 'http_status', httpStatus: 403 },
      ],
    ];
    for (const [answer, error] of cases) {
      githubAnswer = () => answer;
      expect((await call('POST', `/api/sources/${id}/run`)).json()).toMatchObject({
        status: 'failed',
        error,
      });
      clock.advance(HOUR + 60_000);
    }
    expect(db().select().from(rawSignals).all()).toEqual([]);
  });

  it('stops at an exhausted rate limit with the wait the reset time gives, in one request', async () => {
    const { add, call, clock } = await github();
    const { id } = await add();
    const resetIn = 20 * 60_000;
    githubAnswer = () => ({
      status: 403,
      body: '{"message":"rate limit"}',
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.floor((clock.now().getTime() + resetIn) / 1000)),
      },
    });

    const run = (await call('POST', `/api/sources/${id}/run`)).json();
    expect(run).toMatchObject({
      status: 'failed',
      error: { reason: 'rate_limited', httpStatus: 403 },
    });
    expect(githubSeen).toHaveLength(1);
    const wait = new Date(run.nextAllowedAt).getTime() - clock.now().getTime();
    expect(wait).toBeGreaterThanOrEqual(HOUR);
  });

  it('bounds a hostile reset time to an hour and treats 429 the same way', async () => {
    const { add, call, clock } = await github();
    const { id } = await add();
    githubAnswer = () => ({
      status: 429,
      body: '{}',
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '99999999999' },
    });
    const run = (await call('POST', `/api/sources/${id}/run`)).json();
    expect(run).toMatchObject({
      status: 'failed',
      error: { reason: 'rate_limited', httpStatus: 429 },
    });
    expect(new Date(run.nextAllowedAt).getTime() - clock.now().getTime()).toBeLessThanOrEqual(
      HOUR + 60_000,
    );
    expect(githubSeen).toHaveLength(1);
  });

  it('a second run stores nothing new', async () => {
    const { add, call, clock } = await github();
    const { id } = await add();
    await call('POST', `/api/sources/${id}/run`);
    clock.advance(HOUR + 60_000);
    expect((await call('POST', `/api/sources/${id}/run`)).json()).toMatchObject({
      new: 0,
      duplicates: 6,
    });
  });

  it('lets an issue through when the source filter is off that the filter rejects when on', async () => {
    const off = await github();
    const { id } = await off.add();
    await off.call('PATCH', `/api/sources/${id}`, {
      filter: { enabled: false, include: [], exclude: ['retry'] },
    });
    expect((await off.call('POST', `/api/sources/${id}/run`)).json()).toMatchObject({
      new: 6,
      filtered: 0,
    });

    githubSeen = [];
    const on = await github();
    const created = await on.add();
    await on.call('PATCH', `/api/sources/${created.id}`, {
      filter: { enabled: true, include: [], exclude: ['retry'] },
    });
    expect((await on.call('POST', `/api/sources/${created.id}/run`)).json()).toMatchObject({
      new: 6,
      filtered: 1,
    });
  });

  it('checks the connection with one request and stores nothing', async () => {
    const { add, call, db } = await github();
    const { id } = await add();
    expect((await call('POST', `/api/sources/${id}/check`)).json()).toMatchObject({ ok: true });
    expect(githubSeen).toHaveLength(1);
    expect(db().select().from(rawSignals).all()).toEqual([]);
  });
});
