import type { BountyFacts } from '@lead-hunter/contracts';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLE_PROFILE } from '../src/modules/profile/example.js';
import {
  opportunities,
  opportunityEvidence,
  rawSignals,
  sources,
} from '../src/infrastructure/db/schema.js';
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

  it('fails a run and a check of a stored bounty source with an invalid config with `internal`', async () => {
    const { call, addSource, clock } = await setup();
    const id = addSource('opire', { unexpected: true }, { configKey: 'opire' });
    const run = await call('POST', `/api/sources/${id}/run`);
    expect(run.json()).toMatchObject({ status: 'failed', error: { reason: 'internal' } });
    clock.advance(2 * 3_600_000);
    const check = await call('POST', `/api/sources/${id}/check`);
    expect(check.json()).toMatchObject({ ok: false, error: { reason: 'internal' } });
  });
});

describe('analysis of bounty signals (S-19 Phase 2)', () => {
  it('sets the budget from the stated reward only, and keeps none otherwise', async () => {
    const { call, db, addSource, github, runner } = await setup();
    const id = addSource('github', GITHUB_CONFIG);
    const text = (key: string, line: string) =>
      `DEMO ${key}: TypeScript parser crashes on empty input. Szukam programisty, zapłacę za poprawkę. ${line}`;
    github.state.outcome = {
      ok: true,
      items: [
        { ...item('github:demo-org/demo-repo#7', facts()), text: text('with', 'Bounty: $150') },
        {
          ...item('github:demo-org/demo-repo#8', facts({ issueNumber: 8, reward: null })),
          text: text('without', 'Mówią o $500 gdzieś indziej.'),
        },
      ],
      skipped: 0,
    };
    expect((await call('POST', `/api/sources/${id}/run`)).json()).toMatchObject({ new: 2 });
    await runner.drain();

    const rows = db()
      .select({
        key: rawSignals.externalId,
        max: opportunities.amountMaxMinor,
        currency: opportunities.amountCurrency,
      })
      .from(opportunityEvidence)
      .innerJoin(rawSignals, eq(rawSignals.id, opportunityEvidence.rawSignalId))
      .innerJoin(opportunities, eq(opportunities.id, opportunityEvidence.opportunityId))
      .all();
    const by = (n: number) => rows.find((r) => r.key?.endsWith(`#${n}`));
    expect(by(7)).toMatchObject({ max: 15_000, currency: 'USD' });
    expect(by(8)).toMatchObject({ max: null, currency: null });
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 3: the real GitHub adapter through the mocked network (synthetic fixtures, D-14).

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/bounties/${name}.json`, import.meta.url)), 'utf8');
const TYPESCRIPT = fixture('github-search-typescript');
const JAVASCRIPT = fixture('github-search-javascript');
const LINKS = fixture('github-search-links');
const GITHUB = 'https://api.github.com';
const HOUR = 3_600_000;
const CANARY = 'ghp_TOKEN-LEAK-CANARY';

type Answer = { status?: number; body?: string; headers?: Record<string, string> };
/** The GitHub request log and the scripted answer per request (1-based request number). */
const asked: { q: string; sort: string | null; perPage: string | null; authorization?: string }[] =
  [];
let answer: (n: number, language: string | null) => Answer = () => ({ body: '{"items":[]}' });
const byLanguage = (language: string | null): Answer => ({
  body: language === 'JavaScript' ? JAVASCRIPT : TYPESCRIPT,
});

beforeAll(() => {
  const agent = getGlobalDispatcher() as unknown as MockAgent;
  agent
    .get(GITHUB)
    .intercept({ path: (path) => path.startsWith('/search/issues?') })
    .reply((options) => {
      const params = new URL(options.path, GITHUB).searchParams;
      const q = params.get('q') ?? '';
      const headers = options.headers as Record<string, string> | undefined;
      const authorization = headers?.authorization ?? headers?.Authorization;
      asked.push({
        q,
        sort: params.get('sort'),
        perPage: params.get('per_page'),
        ...(authorization === undefined ? {} : { authorization }),
      });
      const language = /language:"([^"]+)"/.exec(q)?.[1] ?? null;
      const reply = answer(asked.length, language);
      return {
        statusCode: reply.status ?? 200,
        data: reply.body ?? '',
        responseOptions: { headers: { 'content-type': 'application/json', ...reply.headers } },
      };
    })
    .persist();
});

beforeEach(() => {
  asked.length = 0;
  answer = (_n, language) => byLanguage(language);
});

async function setupGithub(env: Record<string, string> = {}) {
  const clock = new FakeClock();
  const sleeps: number[] = [];
  const logs: string[] = [];
  const built = await buildTestApp({
    clock,
    env: { LLM_PROVIDER: 'mock', ...env },
    sourceSleep: async (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
    },
    sourceLogger: {
      info: (message) => void logs.push(message),
      warn: (message) => void logs.push(message),
    },
  });
  const cookie = await loginAsOperator(built.app);
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
    built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const db = () => openTestDb(built.dir).db;
  const profile = await call('PUT', '/api/profile', {
    ...EXAMPLE_PROFILE,
    skills: ['TypeScript', 'Node.js', 'Arduino'],
    preferredTechnologies: [],
  });
  expect(profile.statusCode).toBe(200);
  const add = async () => {
    const created = await call('POST', '/api/sources', { preset: 'github-bounties' });
    expect(created.statusCode).toBe(201);
    return created.json().id as number;
  };
  return { ...built, clock, sleeps, logs, call, db, add };
}

const run = async (call: Awaited<ReturnType<typeof setupGithub>>['call'], id: number) =>
  (await call('POST', `/api/sources/${id}/run`)).json();

describe('GitHub bounty search through the source loop (S-19 Phase 3, FR-33 AC1)', () => {
  it('adds the preset with the profile languages that GitHub knows', async () => {
    const { call, add } = await setupGithub();
    const id = await add();
    const list = (await call('GET', '/api/sources')).json();
    const source = list.items.find((s: { id: number }) => s.id === id);
    expect(source).toMatchObject({
      type: 'github',
      presetId: 'github-bounties',
      url: 'https://api.github.com/search/issues',
      github: { labels: ['bounty', 'paid', '💎 Bounty'], languages: ['TypeScript', 'JavaScript'] },
    });
    expect(list.presets.map((p: { id: string }) => p.id)).toContain('github-bounties');
    // Each preset can be added once.
    expect((await call('POST', '/api/sources', { preset: 'github-bounties' })).statusCode).toBe(
      409,
    );
  });

  it('sends one request per language with the expected query, without a token', async () => {
    const { call, add, sleeps } = await setupGithub();
    const id = await add();
    expect(await run(call, id)).toMatchObject({ status: 'ok', failed: 0 });
    expect(asked.map((r) => r.q)).toEqual([
      'is:issue is:open archived:false label:bounty,paid,"💎 Bounty" language:"TypeScript"',
      'is:issue is:open archived:false label:bounty,paid,"💎 Bounty" language:"JavaScript"',
    ]);
    for (const request of asked) {
      expect(request).toMatchObject({ sort: 'updated', perPage: '30' });
      expect(request.authorization).toBeUndefined();
    }
    expect(sleeps).toEqual([6_100]);
  });

  it('spaces requests by 2 100 ms and sends the token when GITHUB_TOKEN is set', async () => {
    const { call, add, sleeps } = await setupGithub({ GITHUB_TOKEN: CANARY });
    const id = await add();
    expect(await run(call, id)).toMatchObject({ status: 'ok' });
    expect(asked).toHaveLength(2);
    for (const request of asked) expect(request.authorization).toBe(`Bearer ${CANARY}`);
    expect(sleeps).toEqual([2_100]);
  });

  it('stores signals that link to the issue, skip pull requests and set rewards only when stated', async () => {
    const { call, add, db, runner } = await setupGithub();
    const id = await add();
    const result = await run(call, id);
    // 6 issues from TypeScript (a pull request is skipped) + 1 new from JavaScript; #1 repeats.
    expect(result).toMatchObject({ status: 'ok', fetched: 7, new: 7, duplicates: 0, failed: 0 });

    const rows = db().select().from(rawSignals).all();
    const by = (key: string) => rows.find((r) => r.externalId === key);
    expect(rows.map((r) => r.externalId)).not.toContain('github:demo-org/demo-repo#6');
    expect(by('github:demo-org/demo-repo#1')).toMatchObject({
      sourceType: 'github',
      sourceUrl: 'https://github.com/demo-org/demo-repo/issues/1',
    });
    const reward = (n: number) =>
      JSON.parse(by(`github:demo-org/demo-repo#${n}`)?.bountyJson ?? 'null')?.reward;
    expect(reward(1)).toMatchObject({ amountMinor: 15_000, currency: 'USD' });
    expect(reward(2)).toMatchObject({ amountMinor: 20_000, quote: '$200' });
    expect(reward(3)).toMatchObject({ amountMinor: 25_000 });
    expect(reward(7)).toMatchObject({ amountMinor: 7_500 });
    expect(reward(4)).toBeNull();
    expect(reward(5)).toBeNull();
    expect(JSON.parse(by('github:demo-org/demo-js#11')?.bountyJson ?? 'null')).toMatchObject({
      repository: 'demo-org/demo-js',
      reward: { amountMinor: 6_000 },
    });

    // An old issue has no date, so `too_old` does not drop it.
    expect(by('github:demo-org/demo-repo#7')?.publishedAt).toBeNull();
    await runner.drain();
    const items = (await call('GET', '/api/opportunities')).json().items as {
      source: { title: string };
      prefilter: { rule: string } | null;
    }[];
    const old = items.find((i) => i.source.title.includes('old issue'));
    expect(old).toBeDefined();
    expect(old?.prefilter?.rule).not.toBe('too_old');
  });

  it('is a duplicate-only run the second time', async () => {
    const { call, add, clock } = await setupGithub();
    const id = await add();
    await run(call, id);
    clock.advance(2 * HOUR);
    expect(await run(call, id)).toMatchObject({ status: 'ok', new: 0, duplicates: 7, failed: 0 });
  });

  it('fails a primary rate limit on the first query with one request and a wait', async () => {
    const { call, add, clock } = await setupGithub();
    const id = await add();
    const reset = Math.floor(clock.now().getTime() / 1000) + 300;
    answer = () => ({
      status: 403,
      body: '{"message":"rate limit"}',
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    });
    const result = await run(call, id);
    expect(result).toMatchObject({
      status: 'failed',
      error: { reason: 'rate_limited', httpStatus: 403 },
    });
    expect(asked).toHaveLength(1);
    // The wait is at least the source interval (`max(reset, interval)`).
    const waitMs = Date.parse(result.nextAllowedAt) - clock.now().getTime();
    expect(waitMs).toBeGreaterThanOrEqual(HOUR);
  });

  it("keeps the first query's items when the second fails: partial, with a log line", async () => {
    const { call, add, logs, db } = await setupGithub();
    const id = await add();
    answer = (n, language) => (n === 2 ? { status: 500, body: 'boom' } : byLanguage(language));
    const result = await run(call, id);
    expect(result).toMatchObject({ status: 'partial', new: 6, failed: 0 });
    expect(db().select().from(rawSignals).all()).toHaveLength(6);
    expect(logs).toContain('github search: query 2 failed http_status 500');
    expect(logs.join('\n')).not.toContain('label:');
  });

  it('shows a body that is not JSON as invalid_feed', async () => {
    const { call, add } = await setupGithub();
    const id = await add();
    answer = () => ({ body: '<html>not json</html>' });
    expect(await run(call, id)).toMatchObject({
      status: 'failed',
      error: { reason: 'invalid_feed' },
    });
  });

  it('lets through with the source filter off what the filter on rejects', async () => {
    const off = await setupGithub();
    const offId = await off.add();
    expect(await run(off.call, offId)).toMatchObject({ new: 7, filtered: 0 });
    const on = await setupGithub();
    const onId = await on.add();
    const patched = await on.call('PATCH', `/api/sources/${onId}`, {
      filter: { enabled: true, include: ['no-such-phrase'], exclude: [] },
    });
    expect(patched.statusCode).toBe(200);
    expect(await run(on.call, onId)).toMatchObject({ new: 7, filtered: 7 });
  });

  it('never leaks the token into logs, the sources list or stored rows', async () => {
    const { call, add, logs, db } = await setupGithub({ GITHUB_TOKEN: CANARY });
    const id = await add();
    await run(call, id);
    answer = () => ({ status: 500, body: 'boom' });
    await run(call, id);
    const list = (await call('GET', '/api/sources')).json();
    const rows = db().select().from(rawSignals).all();
    const tables = db().select().from(sources).all();
    for (const text of [
      logs.join('\n'),
      JSON.stringify(list),
      JSON.stringify(rows),
      JSON.stringify(tables),
    ]) {
      expect(text).not.toContain('LEAK-CANARY');
    }
  });

  it('stores an issue with more than 10 links and rejects it as spam (known risk)', async () => {
    const { call, add, runner } = await setupGithub();
    const id = await add();
    answer = () => ({ body: LINKS });
    expect(await run(call, id)).toMatchObject({ status: 'ok', new: 1 });
    await runner.drain();
    const items = (await call('GET', '/api/opportunities')).json().items as {
      businessStatus: string;
      prefilter: { rule: string } | null;
    }[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ businessStatus: 'REJECTED', prefilter: { rule: 'spam' } });
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 4: the real Opire adapter and its GitHub issue checks through the mocked network (D-14).

const OPIRE_REWARDS = fixture('opire-rewards');
const ISSUE_OPEN = JSON.parse(fixture('github-issue-open')) as Record<string, unknown>;
const ISSUE_CLOSED = fixture('github-issue-closed');
const ISSUE_MOVED = fixture('github-issue-transferred');
const OPIRE = 'https://api.opire.dev';

/** Every request to Opire and the GitHub issue checks, in order. */
const opireAsked: { authorization?: string }[] = [];
const checked: string[] = [];
let opireAnswer: Answer = {};
let issueAnswer: (path: string) => Answer = () => ({});

/** An open copy of the open fixture for another issue number. */
const openIssue = (n: number): string =>
  JSON.stringify({
    ...ISSUE_OPEN,
    number: n,
    html_url: `https://github.com/demo-org/demo-repo/issues/${n}`,
    title: `DEMO open issue ${n}`,
  });

const rewardFor = (n: number, url = `https://github.com/demo-org/demo-repo/issues/${n}`) => ({
  url,
  pendingPrice: { value: 15_000, unit: 'USD_CENT' },
});

beforeAll(() => {
  const agent = getGlobalDispatcher() as unknown as MockAgent;
  agent
    .get(OPIRE)
    .intercept({ path: '/rewards' })
    .reply((options) => {
      const headers = options.headers as Record<string, string> | undefined;
      const authorization = headers?.authorization ?? headers?.Authorization;
      opireAsked.push(authorization === undefined ? {} : { authorization });
      return {
        statusCode: opireAnswer.status ?? 200,
        data: opireAnswer.body ?? OPIRE_REWARDS,
        responseOptions: {
          headers: { 'content-type': 'application/json', ...opireAnswer.headers },
        },
      };
    })
    .persist();
  agent
    .get(GITHUB)
    .intercept({ path: (path) => /^\/(repos|repositories)\//.test(path) })
    .reply((options) => {
      checked.push(options.path);
      const reply = issueAnswer(options.path);
      return {
        statusCode: reply.status ?? 200,
        data: reply.body ?? '',
        responseOptions: { headers: { 'content-type': 'application/json', ...reply.headers } },
      };
    })
    .persist();
});

beforeEach(() => {
  opireAsked.length = 0;
  checked.length = 0;
  opireAnswer = {};
  issueAnswer = (path) => {
    const n = Number(/issues\/(\d+)/.exec(path)?.[1]);
    if (n === 23) return { body: ISSUE_CLOSED };
    if (n === 24) return { status: 404, body: '{"message":"Not Found"}' };
    if (n === 26) {
      return path.startsWith('/repositories/')
        ? { body: ISSUE_MOVED }
        : { status: 301, headers: { location: `${GITHUB}/repositories/99/issues/26` } };
    }
    return { body: openIssue(n) };
  };
});

async function setupOpire(env: Record<string, string> = {}) {
  const setup = await setupGithub(env);
  const add = async () => {
    const created = await setup.call('POST', '/api/sources', { preset: 'opire-rewards' });
    expect(created.statusCode).toBe(201);
    return created.json().id as number;
  };
  return { ...setup, addOpire: add };
}

const set = (rewards: object[]) => {
  opireAnswer = { body: JSON.stringify(rewards) };
};

describe('Opire rewards through the source loop (S-19 Phase 4, FR-33 AC2)', () => {
  it('adds the preset once, with no config', async () => {
    const { call, addOpire } = await setupOpire();
    const id = await addOpire();
    const list = (await call('GET', '/api/sources')).json();
    expect(list.items.find((s: { id: number }) => s.id === id)).toMatchObject({
      type: 'opire',
      presetId: 'opire-rewards',
      url: 'https://api.opire.dev/rewards',
      github: null,
    });
    expect(list.presets.map((p: { id: string }) => p.id)).toContain('opire-rewards');
    expect((await call('POST', '/api/sources', { preset: 'opire-rewards' })).statusCode).toBe(409);
  });

  it('stores open issues linked to GitHub with the reward, and drops closed, missing and bad URLs', async () => {
    const { call, addOpire, db, runner } = await setupOpire();
    const id = await addOpire();
    const result = await run(call, id);
    // Open: 21, 22 (unknown unit), moved 26. Closed 23, missing 24. Skipped: not an issue, `..` owner.
    expect(result).toMatchObject({ status: 'partial', new: 3, failed: 2 });
    expect(checked.sort()).toEqual(
      [21, 22, 23, 24, 26]
        .map((n) => `/repos/demo-org/demo-repo/issues/${n}`)
        .concat('/repositories/99/issues/26')
        .sort(),
    );

    const rows = db().select().from(rawSignals).all();
    const by = (key: string) => rows.find((r) => r.externalId === key);
    expect(rows.map((r) => r.sourceType)).toEqual(['opire', 'opire', 'opire']);
    expect(by('github:demo-org/demo-repo#21')).toMatchObject({
      sourceUrl: 'https://github.com/demo-org/demo-repo/issues/21',
    });
    expect(JSON.parse(by('github:demo-org/demo-repo#21')?.bountyJson ?? 'null')).toMatchObject({
      platform: 'opire',
      reward: { amountMinor: 15_000, currency: 'USD', quote: '150.00 USD' },
    });
    expect(by('github:demo-org/demo-repo#21')?.snippet).toContain('Nagroda (Opire): 150.00 USD');
    // The unit is unknown, so the amount stays unknown.
    expect(JSON.parse(by('github:demo-org/demo-repo#22')?.bountyJson ?? 'null').reward).toBeNull();
    expect(rows.map((r) => r.externalId)).not.toContain('github:demo-org/demo-repo#23');
    // A transferred issue is the issue that GitHub names.
    expect(by('github:demo-org/demo-moved#26')?.sourceUrl).toBe(
      'https://github.com/demo-org/demo-moved/issues/26',
    );

    await runner.drain();
    const budget = db()
      .select({ max: opportunities.amountMaxMinor, currency: opportunities.amountCurrency })
      .from(opportunities)
      .innerJoin(rawSignals, eq(rawSignals.id, opportunities.primarySignalId))
      .where(eq(rawSignals.externalId, 'github:demo-org/demo-repo#21'))
      .all();
    expect(budget).toEqual([{ max: 15_000, currency: 'USD' }]);
  });

  it('is ok when every reward is closed', async () => {
    const { call, addOpire, db } = await setupOpire();
    const id = await addOpire();
    set([rewardFor(23), rewardFor(24)]);
    expect(await run(call, id)).toMatchObject({ status: 'ok', new: 0, failed: 0 });
    expect(db().select().from(rawSignals).all()).toHaveLength(0);
  });

  it('makes no GitHub request for a non-issue URL or a dotted owner', async () => {
    const { call, addOpire } = await setupOpire();
    const id = await addOpire();
    set([rewardFor(1, 'https://example.com/x'), rewardFor(1, 'https://github.com/../r/issues/1')]);
    expect(await run(call, id)).toMatchObject({ status: 'partial', failed: 2 });
    expect(checked).toEqual([]);
  });

  it('checks known rewards no more: the second run asks GitHub only about new ones', async () => {
    const { call, addOpire, clock } = await setupOpire();
    const id = await addOpire();
    await run(call, id);
    const first = checked.length;
    expect(first).toBe(6);
    clock.advance(2 * HOUR);
    checked.length = 0;
    // 21, 22, 26 were stored, 23 and 24 were remembered as checked; only 30 is new.
    set([...JSON.parse(OPIRE_REWARDS).slice(0, 4), rewardFor(26), rewardFor(30)]);
    await run(call, id);
    expect(checked).toEqual(['/repos/demo-org/demo-repo/issues/30']);
  });

  it('reaches an open reward behind 25 closed ones on the second run (cap of 20)', async () => {
    const { call, addOpire, clock, db } = await setupOpire();
    const id = await addOpire();
    issueAnswer = (path) => {
      const n = Number(/issues\/(\d+)/.exec(path)?.[1]);
      return n <= 25 ? { body: ISSUE_CLOSED } : { body: openIssue(n) };
    };
    set([...Array.from({ length: 25 }, (_, i) => rewardFor(i + 1)), rewardFor(100)]);
    // Issue 100 is the 26th: beyond the cap of 20 in the first run.
    const first = await run(call, id);
    expect(first).toMatchObject({ status: 'partial', new: 0 });
    expect(checked).toHaveLength(20);
    clock.advance(2 * HOUR);
    checked.length = 0;
    expect(await run(call, id)).toMatchObject({ status: 'ok', new: 1 });
    // The 20 known closed ones are not asked again: 5 closed + the open one.
    expect(checked).toHaveLength(6);
    expect(db().select().from(rawSignals).all()).toHaveLength(1);
  });

  it('does not check a transferred issue again', async () => {
    const { call, addOpire, clock } = await setupOpire();
    const id = await addOpire();
    set([rewardFor(26)]);
    await run(call, id);
    expect(checked).toHaveLength(2);
    clock.advance(2 * HOUR);
    checked.length = 0;
    await run(call, id);
    expect(checked).toEqual([]);
  });

  it('fails a rate-limited check as rate_limited', async () => {
    const { call, addOpire } = await setupOpire();
    const id = await addOpire();
    issueAnswer = () => ({ status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    expect(await run(call, id)).toMatchObject({
      status: 'failed',
      error: { reason: 'rate_limited', httpStatus: 403 },
    });
  });

  it('shows an Opire HTTP error and a non-list body as explicit errors', async () => {
    const { call, addOpire, clock } = await setupOpire();
    const id = await addOpire();
    opireAnswer = { status: 500, body: 'boom' };
    expect(await run(call, id)).toMatchObject({
      status: 'failed',
      error: { reason: 'http_status', httpStatus: 500 },
    });
    clock.advance(2 * HOUR);
    opireAnswer = { body: '"no list"' };
    expect(await run(call, id)).toMatchObject({
      status: 'failed',
      error: { reason: 'invalid_feed' },
    });
  });

  it('never sends the GitHub token to Opire', async () => {
    const { call, addOpire, logs } = await setupOpire({ GITHUB_TOKEN: CANARY });
    const id = await addOpire();
    await run(call, id);
    expect(opireAsked).toHaveLength(1);
    expect(opireAsked[0]?.authorization).toBeUndefined();
    expect(logs.join('\n')).not.toContain('LEAK-CANARY');
  });

  it('keeps the first source to store an issue, in both orders (D-12)', async () => {
    // Opire's own issue 21 is also found by GitHub search? Use #1, present in the search fixture.
    const one = [rewardFor(1)];
    const githubFirst = await setupOpire();
    const gh = await githubFirst.add();
    await run(githubFirst.call, gh);
    const op = await githubFirst.addOpire();
    set(one);
    await run(githubFirst.call, op);
    const rows = githubFirst.db().select().from(rawSignals).all();
    const stored = rows.filter((r) => r.externalId === 'github:demo-org/demo-repo#1');
    expect(stored.map((r) => r.sourceType)).toEqual(['github']);
    const evidence = githubFirst.db().select().from(opportunityEvidence).all();
    expect(
      evidence
        .filter((e) => e.rawSignalId === stored[0]?.id)
        .map((e) => e.evidenceType)
        .sort(),
    ).toEqual(['IMPORT', 'REPEAT_IMPORT']);
    expect(stored[0]?.bountyJson).toContain('"reward":{"amountMinor":15000');
  });

  it('keeps the Opire reward when Opire stores the issue first (D-12)', async () => {
    const { call, addOpire, add, db } = await setupOpire();
    const op = await addOpire();
    set([rewardFor(1)]);
    await run(call, op);
    await run(call, await add());
    const stored = db()
      .select()
      .from(rawSignals)
      .all()
      .filter((r) => r.externalId === 'github:demo-org/demo-repo#1');
    expect(stored.map((r) => r.sourceType)).toEqual(['opire']);
    expect(JSON.parse(stored[0]?.bountyJson ?? 'null')).toMatchObject({
      platform: 'opire',
      reward: { amountMinor: 15_000 },
    });
  });
});
