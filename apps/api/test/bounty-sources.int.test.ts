import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { opportunities, rawSignals, sources } from '../src/infrastructure/db/schema.js';
import type {
  AdapterOutcome,
  DiscoverContext,
  FeedItem,
  SourceAdapter,
} from '../src/modules/sources/ports.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

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
