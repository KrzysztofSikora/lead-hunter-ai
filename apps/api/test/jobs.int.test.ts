import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createJobRunRepository } from '../src/infrastructure/db/job-run-repository.js';
import { jobLocks, jobRuns, opportunities, rawSignals } from '../src/infrastructure/db/schema.js';
import { MockProvider } from '../src/infrastructure/llm/mock.js';
import type { LlmProvider } from '../src/modules/analysis/ports.js';
import { createJobLock } from '../src/infrastructure/scheduler/job-lock.js';
import { createJobsService } from '../src/modules/jobs/service.js';
import type { SourceService } from '../src/modules/sources/service.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const feed = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/feeds/${name}`, import.meta.url)), 'utf8');
const WWR_FEED = feed('synthetic-wwr-programming.xml');

const WWR = 'https://weworkremotely.com';
const HN = 'https://hnrss.org';
const answers = new Map<string, { status: number; body?: string }>();

beforeAll(() => {
  const agent = getGlobalDispatcher() as unknown as MockAgent;
  for (const [origin, path] of [
    [WWR, '/categories/remote-programming-jobs.rss'],
    [HN, '/whoishiring/freelance'],
    [WWR, '/robots.txt'],
    [HN, '/robots.txt'],
  ] as const) {
    agent
      .get(origin)
      .intercept({ path })
      .reply(() => {
        const answer = answers.get(origin + path) ?? { status: 404 };
        return {
          statusCode: answer.status,
          data: answer.body ?? '',
          responseOptions: { headers: { 'content-type': 'application/xml' } },
        };
      })
      .persist();
  }
});

beforeEach(() => {
  answers.clear();
  answers.set(`${WWR}/robots.txt`, { status: 404 });
  answers.set(`${HN}/robots.txt`, { status: 404 });
});

const HOST = hostname();

/** A source service whose cycle waits until the test lets it go. */
function gatedSources(stop?: { sawLostLock: boolean }) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const sources = {
    async runEnabled(context?: { shouldContinue?: () => boolean }) {
      if (stop) {
        // A cycle that keeps asking whether it may go on, as `runEnabled` does between sources.
        for (let i = 0; i < 200 && context?.shouldContinue?.(); i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        stop.sawLostLock = context?.shouldContinue?.() === false;
        return [];
      }
      await gate;
      return [];
    },
    async run() {
      await gate;
      return { kind: 'not_found' };
    },
  } as unknown as SourceService;
  return { sources, release };
}

function harness(clock = new FakeClock()) {
  const opened = openTestDb();
  const lockFor = (identity: { pid: number; host?: string; isAlive?: (pid: number) => boolean }) =>
    createJobLock({
      db: opened.db,
      clock,
      host: identity.host ?? HOST,
      isAlive: identity.isAlive ?? (() => true),
      pid: identity.pid,
    });
  const runs = createJobRunRepository(opened.db);
  const rows = () => opened.db.select().from(jobRuns).all();
  const lockRows = () => opened.db.select().from(jobLocks).all();
  return { ...opened, clock, lockFor, runs, rows, lockRows };
}

describe('job lock and cycle history (FR-17)', () => {
  it('runs a cycle with one failing source as partial and links signals to their run (AC5)', async () => {
    answers.set(`${WWR}/categories/remote-programming-jobs.rss`, { status: 200, body: WWR_FEED });
    answers.set(`${HN}/whoishiring/freelance`, { status: 500, body: 'oops' });
    const clock = new FakeClock();
    const { app, jobs, dir } = await buildTestApp({ clock });
    const cookie = await loginAsOperator(app);
    for (const preset of ['wwr-programming', 'hn-freelance']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sources',
        headers: { cookie },
        payload: { preset },
      });
      expect(res.statusCode).toBe(201);
    }

    const started = jobs.startCycle('manual');
    if (started.kind !== 'started') throw new Error('cycle did not start');
    const { summary } = await started.done;
    expect(summary).toMatchObject({ status: 'partial', skipped: 0 });
    expect(summary.new).toBeGreaterThan(0);

    const { db } = openTestDb(dir);
    const all = db.select().from(jobRuns).all();
    const cycle = all.find((r) => r.jobType === 'discovery');
    expect(cycle).toMatchObject({ status: 'partial', trigger: 'manual', parentRunId: null });
    expect(cycle?.new).toBe(summary.new);
    const children = all.filter((r) => r.parentRunId === cycle?.id);
    expect(children.map((r) => r.status).sort()).toEqual(['failed', 'ok']);
    expect(children.every((r) => r.trigger === 'manual')).toBe(true);
    const okRun = children.find((r) => r.status === 'ok');
    const signals = db.select().from(rawSignals).all();
    expect(signals.length).toBe(summary.new);
    expect(signals.every((s) => s.jobRunId === okRun?.id)).toBe(true);
    // The lock is free again.
    expect(db.select().from(jobLocks).all()).toEqual([]);
  });

  it('refuses a second cycle and a source run in the same process while one is live (AC2)', async () => {
    const h = harness();
    const { sources, release } = gatedSources();
    const jobs = createJobsService({
      lock: h.lockFor({ pid: process.pid }),
      runs: h.runs,
      sources,
      clock: h.clock,
    });
    const first = jobs.startCycle('manual');
    if (first.kind !== 'started') throw new Error('cycle did not start');
    expect(jobs.startCycle('schedule', h.clock.now().getTime())).toEqual({ kind: 'busy' });
    expect(await jobs.runSource(1)).toEqual({ kind: 'busy' });
    expect(h.rows().map((r) => r.status)).toEqual(['running']);

    release();
    await first.done;
    expect(h.rows().map((r) => r.status)).toEqual(['ok']);
    expect(jobs.startCycle('manual').kind).toBe('started');
    await jobs.idle();
  });

  it('records one scheduled slot once, even when the timer fires a little late (D-5)', async () => {
    const h = harness();
    const { sources, release } = gatedSources();
    release();
    const jobs = createJobsService({
      lock: h.lockFor({ pid: process.pid }),
      runs: h.runs,
      sources,
      clock: h.clock,
    });
    const slot = Date.parse('2026-10-25T07:00:00Z');
    const first = jobs.startCycle('schedule', slot + 12);
    if (first.kind !== 'started') throw new Error('cycle did not start');
    await first.done;
    expect(jobs.startCycle('schedule', slot - 8).kind).toBe('slot_taken');
    expect(h.rows().filter((r) => r.jobType === 'discovery')).toHaveLength(1);
    expect(h.rows()[0]?.scheduledFor).toBe(slot);
    expect(h.lockRows()).toEqual([]);
  });
});

describe('stale locks (AC3)', () => {
  const cases: [
    string,
    { host?: string; pid: number; isAlive?: (pid: number) => boolean },
    number,
  ][] = [
    ['a dead pid on this host', { pid: 41_001, isAlive: () => false }, 0],
    ['our own pid after a restart', { pid: process.pid }, 0],
    ['an old heartbeat from another host', { host: 'other-container', pid: 7 }, 3 * 60_000],
  ];
  it.each(cases)(
    'releases a lock held by %s at start and marks its runs interrupted',
    (_, owner, age) => {
      const h = harness();
      const dead = h.lockFor({ ...owner, isAlive: () => true });
      expect(dead.acquire().ok).toBe(true);
      h.runs.startCycle('manual', h.clock.now().getTime(), null);
      h.clock.advance(age);

      const fresh = h.lockFor({
        pid: process.pid,
        ...(owner.isAlive ? { isAlive: owner.isAlive } : {}),
      });
      expect(fresh.releaseStale()).toBe(true);
      expect(h.lockRows()).toEqual([]);
      expect(h.rows()).toMatchObject([{ status: 'failed', errorReason: 'interrupted' }]);
      expect(h.rows()[0]?.finishedAt).toBe(h.clock.now().getTime());
      expect(fresh.acquire().ok).toBe(true);
    },
  );

  it('keeps a lock held by a live process with a fresh heartbeat', () => {
    const h = harness();
    const other = h.lockFor({ pid: process.pid + 1 });
    expect(other.acquire().ok).toBe(true);
    h.runs.startCycle('cli', h.clock.now().getTime(), null);
    h.clock.advance(30_000);

    const ours = h.lockFor({ pid: process.pid });
    expect(ours.releaseStale()).toBe(false);
    expect(ours.acquire()).toEqual({ ok: false });
    expect(h.rows()).toMatchObject([{ status: 'running' }]);
  });

  it('marks runs left running with no lock row at all as interrupted (plan-review #2)', () => {
    const h = harness();
    h.runs.startCycle('manual', h.clock.now().getTime(), null);
    expect(h.lockFor({ pid: process.pid }).releaseStale()).toBe(false);
    expect(h.rows()).toMatchObject([{ status: 'failed', errorReason: 'interrupted' }]);
  });

  it('never lets an old owner free or beat the lock a new owner took over (two steps)', () => {
    const h = harness();
    const oldOwner = h.lockFor({ pid: 100 });
    const old = oldOwner.acquire();
    if (!old.ok) throw new Error('no lock');
    h.runs.startCycle('manual', h.clock.now().getTime(), null);

    const newOwner = h.lockFor({ pid: 200, isAlive: (pid) => pid !== 100 });
    const taken = newOwner.acquire();
    expect(taken.ok).toBe(true);
    const newRun = h.runs.startCycle('manual', h.clock.now().getTime(), null);
    expect(h.rows()[0]).toMatchObject({ status: 'failed', errorReason: 'interrupted' });

    expect(old.handle.heartbeat()).toBe(false);
    old.handle.release();
    expect(old.handle.releaseInterrupted(h.clock.now().getTime())).toBe(0);
    expect(h.lockRows()).toHaveLength(1);
    expect(h.rows().find((r) => r.id === newRun)?.status).toBe('running');
    expect(h.lockFor({ pid: 300 }).acquire()).toEqual({ ok: false });
  });
});

describe('shutdown and a lost lock (D-3)', () => {
  it('marks our live cycle interrupted, frees the lock and keeps it so after the late finish', async () => {
    const h = harness();
    const { sources, release } = gatedSources();
    const jobs = createJobsService({
      lock: h.lockFor({ pid: process.pid }),
      runs: h.runs,
      sources,
      clock: h.clock,
    });
    const started = jobs.startCycle('manual');
    if (started.kind !== 'started') throw new Error('cycle did not start');

    jobs.shutdown(h.clock.now().getTime());
    expect(h.lockRows()).toEqual([]);
    expect(h.rows()).toMatchObject([{ status: 'failed', errorReason: 'interrupted' }]);

    release();
    await started.done;
    expect(h.rows()).toMatchObject([{ status: 'failed', errorReason: 'interrupted' }]);
    expect(h.lockRows()).toEqual([]);
  });

  it('leaves a lock held by another process and its runs alone', () => {
    const h = harness();
    const cli = h.lockFor({ pid: process.pid + 1 });
    expect(cli.acquire().ok).toBe(true);
    h.runs.startCycle('cli', h.clock.now().getTime(), null);
    const { sources } = gatedSources();
    const jobs = createJobsService({
      lock: h.lockFor({ pid: process.pid }),
      runs: h.runs,
      sources,
      clock: h.clock,
    });
    jobs.shutdown(h.clock.now().getTime());
    expect(h.lockRows()).toHaveLength(1);
    expect(h.rows()).toMatchObject([{ status: 'running' }]);
  });

  it('stops before the next source when the lock was taken over, and keeps the rows interrupted', async () => {
    const h = harness();
    const stop = { sawLostLock: false };
    const { sources } = gatedSources(stop);
    const jobs = createJobsService({
      lock: h.lockFor({ pid: process.pid }),
      runs: h.runs,
      sources,
      clock: h.clock,
      heartbeatMs: 10,
    });
    const started = jobs.startCycle('manual');
    if (started.kind !== 'started') throw new Error('cycle did not start');

    const thief = h.lockFor({ pid: 900, isAlive: (pid) => pid !== process.pid });
    expect(thief.acquire().ok).toBe(true);
    await started.done;

    expect(stop.sawLostLock).toBe(true);
    expect(h.rows()).toMatchObject([{ status: 'failed', errorReason: 'interrupted' }]);
    // The thief's lock survived the finished cycle's release.
    expect(h.lockRows()).toMatchObject([{ ownerPid: 900 }]);
  });
});

const FEED_WITH_BLANK = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>DEMO feed</title><link>https://weworkremotely.com/</link>
<description>DEMO synthetic</description>
<item><title>DEMO Studio: Node.js integration contractor</title>
<description>Looking for a contractor to build an integration service in Node.js and PostgreSQL. Remote.</description>
<link>https://weworkremotely.com/remote-jobs/demo-integration</link><guid>demo-integration</guid></item>
<item><title>DEMO Untitled gig</title><description></description>
<link>https://weworkremotely.com/remote-jobs/demo-blank</link><guid>demo-blank</guid></item>
</channel></rss>`;

async function addPresets(
  app: Awaited<ReturnType<typeof buildTestApp>>['app'],
  cookie: string,
): Promise<void> {
  for (const preset of ['wwr-programming', 'hn-freelance']) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: { cookie },
      payload: { preset },
    });
    expect(res.statusCode).toBe(201);
  }
}

describe('jobs API (FR-17, FR-18)', () => {
  it('lists a partial cycle with its source runs and live counters, and a retry changes them (AC5, FR-18)', async () => {
    answers.set(`${WWR}/categories/remote-programming-jobs.rss`, {
      status: 200,
      body: FEED_WITH_BLANK,
    });
    answers.set(`${HN}/whoishiring/freelance`, { status: 500, body: 'oops' });
    const clock = new FakeClock();
    const { app, jobs, runner, dir } = await buildTestApp({
      clock,
      env: { LLM_PROVIDER: 'mock' },
    });
    const cookie = await loginAsOperator(app);
    await addPresets(app, cookie);

    const started = await app.inject({
      method: 'POST',
      url: '/api/jobs/discover',
      headers: { cookie },
    });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({
      type: 'discovery',
      trigger: 'manual',
      status: 'running',
    });
    await jobs.idle();
    await runner.drain();

    const listed = await app.inject({ method: 'GET', url: '/api/jobs', headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    const body = listed.json() as {
      items: {
        id: number;
        type: string;
        status: string;
        parentId: number | null;
        source: { id: number; name: string } | null;
        counters: Record<string, number>;
        error: { reason: string } | null;
        cost: unknown;
      }[];
      running: boolean;
      total: number;
      schedule: { timezone: string; times: string[]; nextRunAt: string | null };
    };
    expect(body.running).toBe(false);
    expect(body.schedule).toEqual({
      timezone: 'Europe/Warsaw',
      times: ['08:00', '18:00'],
      nextRunAt: null,
    });
    expect(body.total).toBe(3);
    const cycle = body.items.find((r) => r.type === 'discovery');
    const okRun = body.items.find((r) => r.status === 'ok');
    const failedRun = body.items.find((r) => r.status === 'failed');
    expect(cycle).toMatchObject({ status: 'partial', parentId: null });
    expect(failedRun?.error).toMatchObject({ reason: 'http_status' });
    expect(okRun?.counters).toMatchObject({ fetched: 2, new: 2, duplicates: 0, skipped: 0 });
    // The untitled item matches nothing in the profile: the pre-filter rejects it.
    expect(okRun?.counters.rejected).toBe(1);
    expect(okRun?.counters.analysed).toBe(1);
    // The mock reports no token usage: cost is unknown, not zero (D-9).
    expect(okRun?.cost).toBeNull();
    expect(cycle?.counters).toMatchObject({
      fetched: 2,
      new: 2,
      analysed: okRun?.counters.analysed,
    });
    expect(cycle?.cost).toBeNull();

    // `no_text` waits for verification and is not a rejection (D-8, same mapping as `moveFor`).
    const { db } = openTestDb(dir);
    db.update(opportunities)
      .set({ prefilterRule: 'no_text' })
      .where(eq(opportunities.prefilterRule, 'no_profile_match'))
      .run();
    const recount = await app.inject({ method: 'GET', url: '/api/jobs', headers: { cookie } });
    const recounted = (
      recount.json() as { items: { id: number; counters: { rejected: number } }[] }
    ).items;
    expect(recounted.find((r) => r.id === okRun?.id)?.counters.rejected).toBe(0);

    const bySource = await app.inject({
      method: 'GET',
      url: `/api/jobs?sourceId=${failedRun?.source?.id}`,
      headers: { cookie },
    });
    expect(
      (bySource.json() as { items: unknown[] }).items.every(
        (i) => (i as { type: string }).type === 'source_run',
      ),
    ).toBe(true);
  });

  it('refuses a second cycle and a source run while one is live (AC2, AC4)', async () => {
    answers.set(`${WWR}/categories/remote-programming-jobs.rss`, { status: 200, body: WWR_FEED });
    const clock = new FakeClock();
    const { app, jobs } = await buildTestApp({ clock });
    const cookie = await loginAsOperator(app);
    await addPresets(app, cookie);

    const first = await app.inject({
      method: 'POST',
      url: '/api/jobs/discover',
      headers: { cookie },
    });
    expect(first.statusCode).toBe(202);
    // The cycle has not been awaited: its lock is still held.
    const second = await app.inject({
      method: 'POST',
      url: '/api/jobs/discover',
      headers: { cookie },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'busy' });
    const single = await app.inject({
      method: 'POST',
      url: '/api/sources/1/run',
      headers: { cookie },
    });
    expect(single.statusCode).toBe(409);
    expect(single.json()).toEqual({ error: 'busy' });
    const running = await app.inject({ method: 'GET', url: '/api/jobs', headers: { cookie } });
    expect((running.json() as { running: boolean }).running).toBe(true);

    await jobs.idle();
    const after = await app.inject({ method: 'GET', url: '/api/jobs', headers: { cookie } });
    expect((after.json() as { running: boolean }).running).toBe(false);
  });

  it('retries a failed source run once the feed recovers without duplicating signals (FR-18 AC2)', async () => {
    answers.set(`${WWR}/categories/remote-programming-jobs.rss`, { status: 500, body: 'oops' });
    const clock = new FakeClock();
    const { app, runner } = await buildTestApp({ clock });
    const cookie = await loginAsOperator(app);
    await app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: { cookie },
      payload: { preset: 'wwr-programming' },
    });

    const failed = await app.inject({
      method: 'POST',
      url: '/api/sources/1/run',
      headers: { cookie },
    });
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({ status: 'failed', new: 0 });

    answers.set(`${WWR}/categories/remote-programming-jobs.rss`, { status: 200, body: WWR_FEED });
    clock.advance(24 * 60 * 60_000);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const run = await app.inject({
        method: 'POST',
        url: '/api/sources/1/run',
        headers: { cookie },
      });
      expect(run.statusCode).toBe(attempt === 0 ? 200 : 409);
      if (attempt === 0) expect(run.json()).toMatchObject({ status: 'ok', new: 2 });
    }
    await runner.drain();
    const opportunities = await app.inject({
      method: 'GET',
      url: '/api/opportunities',
      headers: { cookie },
    });
    expect((opportunities.json() as { total: number }).total).toBe(2);
    const jobsList = await app.inject({ method: 'GET', url: '/api/jobs', headers: { cookie } });
    expect((jobsList.json() as { items: { status: string }[] }).items.map((i) => i.status)).toEqual(
      ['ok', 'failed'],
    );
  });

  it('retries a failed analysis into the same opportunity and updates the run counters (FR-18 AC2)', async () => {
    answers.set(`${WWR}/categories/remote-programming-jobs.rss`, { status: 200, body: WWR_FEED });
    let calls = 0;
    const real = new MockProvider();
    const flaky: LlmProvider = {
      name: real.name,
      model: real.model,
      promptVersion: real.promptVersion,
      demo: real.demo,
      analyzeOpportunity(input) {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('provider down'));
        return real.analyzeOpportunity(input);
      },
    };
    const clock = new FakeClock();
    const { app, runner } = await buildTestApp({ clock, provider: flaky });
    const cookie = await loginAsOperator(app);
    await app.inject({
      method: 'POST',
      url: '/api/sources',
      headers: { cookie },
      payload: { preset: 'wwr-programming' },
    });
    await app.inject({ method: 'POST', url: '/api/sources/1/run', headers: { cookie } });
    await runner.drain();

    const failedCount = async (): Promise<{ cycleOrRun: number }> => {
      const res = await app.inject({ method: 'GET', url: '/api/jobs', headers: { cookie } });
      const run = (res.json() as { items: { counters: { failed: number } }[] }).items[0];
      return { cycleOrRun: run?.counters.failed ?? -1 };
    };
    expect(await failedCount()).toEqual({ cycleOrRun: 1 });

    const list = await app.inject({
      method: 'GET',
      url: '/api/opportunities?status=NEW',
      headers: { cookie },
    });
    const all = await app.inject({ method: 'GET', url: '/api/opportunities', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const failedItem = (
      all.json() as { items: { id: number; analysisStatus: string }[] }
    ).items.find((i) => i.analysisStatus === 'FAILED');
    if (!failedItem) throw new Error('no failed analysis to retry');

    const retried = await app.inject({
      method: 'POST',
      url: `/api/opportunities/${failedItem.id}/analyze`,
      headers: { cookie },
    });
    expect(retried.statusCode).toBe(202);
    expect(retried.json()).toEqual({ analysisStatus: 'PENDING' });
    await runner.idle();

    expect(await failedCount()).toEqual({ cycleOrRun: 0 });
    const afterAll = await app.inject({
      method: 'GET',
      url: '/api/opportunities',
      headers: { cookie },
    });
    expect((afterAll.json() as { total: number }).total).toBe(2);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/opportunities/${failedItem.id}`,
      headers: { cookie },
    });
    expect(detail.json()).toMatchObject({ analysisStatus: 'COMPLETE' });

    // Only a failed analysis can be retried; an unknown id is a 404.
    const again = await app.inject({
      method: 'POST',
      url: `/api/opportunities/${failedItem.id}/analyze`,
      headers: { cookie },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'not_failed' });
    const missing = await app.inject({
      method: 'POST',
      url: '/api/opportunities/9999/analyze',
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
  });
});
