import type { BountyFacts } from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import { rawSignals, sources } from '../src/infrastructure/db/schema.js';
import type {
  AdapterOutcome,
  ConfigCheck,
  FeedItem,
  SourceAdapter,
} from '../src/modules/sources/ports.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const facts = (over: Partial<BountyFacts> = {}): BountyFacts => ({
  platform: 'github',
  repository: 'demo-org/demo-repo',
  issueNumber: 7,
  labels: ['bounty'],
  reward: { amountMinor: 15_000, currency: 'USD', quote: '$150' },
  ...over,
});

const item = (key: string, bounty?: BountyFacts): FeedItem => ({
  key,
  url: `https://github.com/demo-org/demo-repo/issues/${key.replace(/\D/g, '') || '1'}`,
  title: `DEMO zgłoszenie ${key}`,
  text: `DEMO zgłoszenie ${key}: napraw błąd`,
  publishedAt: null,
  ...(bounty ? { bounty } : {}),
});

/** A bounty adapter that answers from the test. */
function fakeAdapter(type: 'github' | 'opire') {
  const state = { outcome: { ok: true, items: [], skipped: 0 } as AdapterOutcome };
  const adapter: SourceAdapter = {
    type,
    validateConfig: (config): ConfigCheck => ({ ok: true, config, key: type }),
    async discover() {
      return state.outcome;
    },
    async healthCheck() {
      return state.outcome;
    },
  };
  return { adapter, state };
}

async function setup() {
  const clock = new FakeClock();
  const github = fakeAdapter('github');
  const warnings: string[] = [];
  const built = await buildTestApp({
    clock,
    env: { LLM_PROVIDER: 'mock' },
    adapters: { github: github.adapter },
    sourceLogger: { info: () => undefined, warn: (message) => void warnings.push(message) },
  });
  const cookie = await loginAsOperator(built.app);
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const db = () => openTestDb(built.dir).db;
  const addSource = (
    type: string,
    config: object,
    over: Partial<typeof sources.$inferInsert> = {},
  ): number => {
    const at = clock.now().getTime();
    return db()
      .insert(sources)
      .values({
        type,
        name: `DEMO ${type}`,
        configJson: JSON.stringify(config),
        configKey: type,
        createdAt: at,
        updatedAt: at,
        ...over,
      })
      .returning({ id: sources.id })
      .get().id;
  };
  return { ...built, clock, call, db, addSource, github, warnings };
}

const GITHUB_CONFIG = { labels: ['bounty', 'paid'], languages: ['TypeScript'] };

describe('bounty sources in the source loop (S-19 Phase 1)', () => {
  it('stores the bounty facts and sets the signal type', async () => {
    const { call, db, addSource, github } = await setup();
    const id = addSource('github', GITHUB_CONFIG);
    github.state.outcome = {
      ok: true,
      items: [item('github:demo-org/demo-repo#7', facts())],
      skipped: 0,
    };

    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.json()).toMatchObject({ status: 'ok', new: 1, failed: 0 });

    const [signal] = db().select().from(rawSignals).all();
    expect(signal).toMatchObject({ sourceType: 'github', sourceId: id });
    expect(JSON.parse(signal?.bountyJson ?? 'null')).toEqual(facts());
    expect(signal?.tenderJson).toBeNull();
  });

  it('keeps an item whose facts are invalid, with bounty_json null and a warn line', async () => {
    const { call, db, addSource, github, warnings } = await setup();
    const id = addSource('github', GITHUB_CONFIG);
    github.state.outcome = {
      ok: true,
      items: [
        item('github:a/b#1', facts({ repository: 'owner/..' })),
        item('github:a/b#2', facts({ issueNumber: 0 })),
        item('github:a/b#3'),
      ],
      skipped: 0,
    };
    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.json()).toMatchObject({ status: 'ok', new: 3, failed: 0 });
    for (const row of db().select().from(rawSignals).all()) expect(row.bountyJson).toBeNull();
    expect(warnings.filter((line) => line.includes('bounty_invalid'))).toEqual([
      expect.stringContaining('bounty_invalid repository'),
      expect.stringContaining('bounty_invalid issueNumber'),
    ]);
    // The warn line names the source and the field, never the item text.
    expect(warnings.join('\n')).not.toContain('DEMO zgłoszenie');
  });

  it('shows the API endpoint as the url of an API source', async () => {
    const { call, addSource } = await setup();
    addSource('github', GITHUB_CONFIG);
    addSource('opire', {}, { configKey: 'opire' });
    const items = (await call('GET', '/api/sources')).json().items;
    expect(items.map((s: { url: string }) => s.url)).toEqual([
      'https://api.github.com/search/issues',
      'https://api.opire.dev/rewards',
    ]);
    expect(items[0]).toMatchObject({ type: 'github', github: GITHUB_CONFIG, tender: null });
    expect(items[1]).toMatchObject({ type: 'opire', github: null });
  });

  it('edits the GitHub config and refuses bad values and other source types', async () => {
    const { call, addSource } = await setup();
    const gh = addSource('github', GITHUB_CONFIG);
    const feed = addSource('rss', { url: 'https://feeds.example/x.xml' }, { configKey: 'f' });
    const bzp = addSource('bzp', { cpvPrefixes: ['72'] }, { configKey: 'bzp' });

    const next = { labels: ['bounty'], languages: ['Go', 'Rust'] };
    const edited = await call('PATCH', `/api/sources/${gh}`, { github: next });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().github).toEqual(next);
    expect((await call('GET', '/api/sources')).json().items[0].github).toEqual(next);

    for (const bad of [
      { labels: [], languages: [] },
      { labels: ['a"b'], languages: [] },
      { labels: ['bounty'], languages: ['Brainfuck'] },
    ]) {
      expect((await call('PATCH', `/api/sources/${gh}`, { github: bad })).statusCode).toBe(400);
    }
    const tooLong = {
      labels: Array.from({ length: 10 }, (_, n) => `${n}`.padEnd(40, 'x')),
      languages: [],
    };
    const refused = await call('PATCH', `/api/sources/${gh}`, { github: tooLong });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: 'validation_failed' });

    for (const id of [feed, bzp]) {
      const res = await call('PATCH', `/api/sources/${id}`, { github: next });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'not_github_source' });
    }
    const onGithub = await call('PATCH', `/api/sources/${gh}`, { tender: { cpvPrefixes: ['72'] } });
    expect(onGithub.statusCode).toBe(400);
    expect(onGithub.json()).toEqual({ error: 'not_tender_source' });
  });

  it('shows a failing API as an explicit error (FR-04 AC3)', async () => {
    const { call, addSource, github } = await setup();
    const id = addSource('github', GITHUB_CONFIG);
    github.state.outcome = { ok: false, reason: 'rate_limited', httpStatus: 403 };
    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.json()).toMatchObject({
      status: 'failed',
      error: { reason: 'rate_limited', httpStatus: 403 },
    });
  });

  it('fails a run and a check of a stored bounty source with no adapter with `internal`', async () => {
    const { call, addSource, clock } = await setup();
    const id = addSource('opire', {}, { configKey: 'opire' });
    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.json()).toMatchObject({ status: 'failed', error: { reason: 'internal' } });
    clock.advance(2 * 3_600_000);
    const check = await call('POST', `/api/sources/${id}/check`);
    expect(check.json()).toMatchObject({ ok: false, error: { reason: 'internal' } });
  });
});
