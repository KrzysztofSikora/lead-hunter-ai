import type { TenderFacts } from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import { rawSignals, sources } from '../src/infrastructure/db/schema.js';
import type {
  AdapterOutcome,
  ConfigCheck,
  DiscoverContext,
  FeedItem,
  SourceAdapter,
} from '../src/modules/sources/ports.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const facts = (over: Partial<TenderFacts> = {}): TenderFacts => ({
  noticeId: 'DEMO-2026/001',
  buyer: 'DEMO Urząd Miasta',
  deadlineAt: '2026-11-20T09:00:00.000Z',
  estimatedValue: {
    amountMinor: 12_300_000,
    currency: 'PLN',
    quote: 'Wartość szacunkowa: 123000 PLN',
  },
  cpvCodes: ['72200000-7'],
  procedure: 'Przetarg nieograniczony',
  country: 'PL',
  ...over,
});

const item = (key: string, tender?: TenderFacts): FeedItem => ({
  key,
  url: `https://tenders.example/${key}`,
  title: `DEMO przetarg ${key}`,
  text: `DEMO przetarg ${key}: dostawa systemu`,
  publishedAt: Date.parse('2026-10-20T08:00:00Z'),
  ...(tender ? { tender } : {}),
});

/** A tender adapter that answers from the test and remembers the windows it was asked for. */
function fakeTenderAdapter(type: 'bzp' | 'ted') {
  const state = {
    outcome: { ok: true, items: [], skipped: 0 } as AdapterOutcome,
    since: [] as number[],
  };
  const adapter: SourceAdapter = {
    type,
    validateConfig: (config): ConfigCheck => ({ ok: true, config, key: type }),
    async discover(_config: unknown, context: DiscoverContext) {
      state.since.push(context.since);
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
  const bzp = fakeTenderAdapter('bzp');
  const ted = fakeTenderAdapter('ted');
  const built = await buildTestApp({
    clock,
    env: { LLM_PROVIDER: 'mock' },
    adapters: { bzp: bzp.adapter, ted: ted.adapter },
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
  return { ...built, clock, call, db, addSource, bzp, ted };
}

describe('tender sources in the source loop (S-18 Phase 1)', () => {
  it('stores the tender facts, returns them on the card and sets the signal type', async () => {
    const { call, db, addSource, bzp } = await setup();
    const id = addSource('bzp', { cpvPrefixes: ['72', '48'] });
    bzp.state.outcome = { ok: true, items: [item('a', facts())], skipped: 0 };

    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.json()).toMatchObject({ status: 'ok', new: 1, failed: 0 });

    const [signal] = db().select().from(rawSignals).all();
    expect(signal).toMatchObject({ sourceType: 'bzp', sourceId: id });
    expect(JSON.parse(signal?.tenderJson ?? 'null')).toEqual(facts());

    const list = (await call('GET', '/api/opportunities')).json();
    const card = (await call('GET', `/api/opportunities/${list.items[0].id}`)).json();
    expect(card.source).toMatchObject({ type: 'bzp', name: 'DEMO bzp', tender: facts() });
    expect(list.items[0].source.tender).toEqual(facts());
  });

  it('keeps an item whose tender facts are invalid, with tender null (D-2)', async () => {
    const { call, db, addSource, ted } = await setup();
    const id = addSource('ted', { cpvPrefixes: ['72'], countries: ['PL'] });
    ted.state.outcome = {
      ok: true,
      items: [
        item('bad', facts({ cpvCodes: ['72'] })),
        item('range', facts({ noticeId: 'DEMO-2', deadlineAt: '1999-12-31T00:00:00.000Z' })),
        item('plain'),
      ],
      skipped: 0,
    };
    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.json()).toMatchObject({ status: 'ok', new: 3, failed: 0 });

    const rows = db().select().from(rawSignals).all();
    const byKey = (key: string) => rows.find((row) => row.externalId === key);
    expect(byKey('bad')?.tenderJson).toBeNull();
    expect(byKey('plain')?.tenderJson).toBeNull();
    // A deadline outside 2000-2100 is dropped; the rest of the facts survive.
    expect(JSON.parse(byKey('range')?.tenderJson ?? 'null')).toMatchObject({
      noticeId: 'DEMO-2',
      deadlineAt: null,
    });
    const list = (await call('GET', '/api/opportunities')).json();
    const bad = list.items.find((i: { source: { url: string } }) => i.source.url.endsWith('/bad'));
    expect(bad.source.tender).toBeNull();
  });

  it('reads stored facts that no longer validate as absent', async () => {
    const { call, db, addSource, bzp } = await setup();
    const id = addSource('bzp', { cpvPrefixes: ['72'] });
    bzp.state.outcome = { ok: true, items: [item('a', facts())], skipped: 0 };
    await call('POST', `/api/sources/${id}/run`);
    db().update(rawSignals).set({ tenderJson: '{"noticeId":""}' }).run();
    const list = (await call('GET', '/api/opportunities')).json();
    expect(list.items[0].source.tender).toBeNull();
  });

  it('asks for lastSuccessAt - 24 h, and for the last 3 days on the first run (D-9)', async () => {
    const { call, clock, addSource, bzp } = await setup();
    const id = addSource('bzp', { cpvPrefixes: ['72'] });
    const first = clock.now().getTime();
    await call('POST', `/api/sources/${id}/run`);
    clock.advance(2 * HOUR);
    await call('POST', `/api/sources/${id}/run`);
    expect(bzp.state.since).toEqual([first - 3 * DAY, first - DAY]);
  });

  it('does not repeat a notice the cursor has seen', async () => {
    const { call, clock, addSource, bzp } = await setup();
    const id = addSource('bzp', { cpvPrefixes: ['72'] });
    bzp.state.outcome = { ok: true, items: [item('a', facts())], skipped: 0 };
    expect((await call('POST', `/api/sources/${id}/run`)).json()).toMatchObject({ new: 1 });
    clock.advance(2 * HOUR);
    expect((await call('POST', `/api/sources/${id}/run`)).json()).toMatchObject({
      new: 0,
      duplicates: 1,
    });
  });

  it('turns a page cap into a partial run, never a complete one', async () => {
    const { call, addSource, bzp } = await setup();
    const id = addSource('bzp', { cpvPrefixes: ['72'] });
    bzp.state.outcome = { ok: true, items: [item('a', facts())], skipped: 0, truncated: true };
    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.json()).toMatchObject({ status: 'partial', new: 1, failed: 0 });
  });

  it('shows a failing tender API as an explicit error with reason and status (FR-04 AC3)', async () => {
    const { call, addSource, ted } = await setup();
    const id = addSource('ted', { cpvPrefixes: ['72'], countries: ['PL'] });
    ted.state.outcome = { ok: false, reason: 'http_status', httpStatus: 500 };
    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.json()).toMatchObject({
      status: 'failed',
      error: { reason: 'http_status', httpStatus: 500 },
    });
    const listed = (await call('GET', '/api/sources')).json().items[0];
    expect(listed.lastError).toMatchObject({ reason: 'http_status', httpStatus: 500 });
  });

  it('fails a run of a source type without an adapter with `internal`', async () => {
    const built = await buildTestApp({ clock: new FakeClock(), env: { LLM_PROVIDER: 'mock' } });
    const cookie = await loginAsOperator(built.app);
    const at = Date.now();
    const id = openTestDb(built.dir)
      .db.insert(sources)
      .values({
        type: 'nope',
        name: 'DEMO nope',
        configJson: '{}',
        configKey: 'nope',
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: sources.id })
      .get().id;
    const run = await built.app.inject({
      method: 'POST',
      url: `/api/sources/${id}/run`,
      headers: { cookie },
    });
    expect(run.json()).toMatchObject({ status: 'failed', error: { reason: 'internal' } });
  });

  it('lists the tender config of a tender source and null for a feed', async () => {
    const { call, addSource } = await setup();
    addSource('bzp', { cpvPrefixes: ['72', '48'] });
    addSource('ted', { cpvPrefixes: ['72'], countries: ['PL'] }, { configKey: 'ted' });
    addSource(
      'rss',
      { url: 'https://feeds.example/x.xml' },
      { configKey: 'https://feeds.example/x.xml' },
    );
    const items = (await call('GET', '/api/sources')).json().items;
    expect(items.map((i: { type: string; tender: unknown }) => [i.type, i.tender])).toEqual([
      ['bzp', { cpvPrefixes: ['72', '48'], countries: null }],
      ['ted', { cpvPrefixes: ['72'], countries: ['PL'] }],
      ['rss', null],
    ]);
  });

  it('edits the tender config by PATCH; a feed, bad input and a BZP country are 400 (D-7)', async () => {
    const { call, addSource } = await setup();
    const bzp = addSource('bzp', { cpvPrefixes: ['72'] });
    const ted = addSource('ted', { cpvPrefixes: ['72'], countries: ['PL'] }, { configKey: 'ted' });
    const feed = addSource('rss', { url: 'https://feeds.example/x.xml' }, { configKey: 'rss-x' });

    const edited = await call('PATCH', `/api/sources/${bzp}`, {
      tender: { cpvPrefixes: ['48', '7322'] },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().tender).toEqual({ cpvPrefixes: ['48', '7322'], countries: null });

    // TED keeps its countries when the patch gives none, and replaces them when it does.
    const kept = await call('PATCH', `/api/sources/${ted}`, { tender: { cpvPrefixes: ['73'] } });
    expect(kept.json().tender).toEqual({ cpvPrefixes: ['73'], countries: ['PL'] });
    const moved = await call('PATCH', `/api/sources/${ted}`, {
      tender: { cpvPrefixes: ['73'], countries: ['PL', 'DE'] },
    });
    expect(moved.json().tender).toEqual({ cpvPrefixes: ['73'], countries: ['PL', 'DE'] });

    const onFeed = await call('PATCH', `/api/sources/${feed}`, { tender: { cpvPrefixes: ['72'] } });
    expect(onFeed.statusCode).toBe(400);
    expect(onFeed.json()).toEqual({ error: 'not_tender_source' });

    for (const [id, tender] of [
      [bzp, { cpvPrefixes: ['7'] }],
      [bzp, { cpvPrefixes: ['72', '72'] }],
      [bzp, { cpvPrefixes: ['72'], countries: ['PL'] }],
      [ted, { cpvPrefixes: ['72'], countries: ['pl'] }],
    ] as const) {
      expect((await call('PATCH', `/api/sources/${id}`, { tender })).statusCode).toBe(400);
    }
    // Nothing from the rejected bodies was stored.
    const items = (await call('GET', '/api/sources')).json().items;
    expect(items[0].tender).toEqual({ cpvPrefixes: ['48', '7322'], countries: null });
    expect(items[1].tender).toEqual({ cpvPrefixes: ['73'], countries: ['PL', 'DE'] });
    expect(
      (await call('PATCH', '/api/sources/999', { tender: { cpvPrefixes: ['72'] } })).statusCode,
    ).toBe(404);
  });
});
