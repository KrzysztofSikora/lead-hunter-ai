import { AnalysisActivity } from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import { createAnalysisRepository } from '../src/infrastructure/db/analysis-repository.js';
import { analyses } from '../src/infrastructure/db/schema.js';
import { MockProvider } from '../src/infrastructure/llm/mock.js';
import {
  type AnalysisInput,
  type LlmProvider,
  ProviderError,
  type ProviderOutput,
} from '../src/modules/analysis/ports.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const DAY = 24 * 60 * 60 * 1000;
const BODY =
  'Szukamy programisty TypeScript do narzędzia wewnętrznego, zapłacimy za wykonanie zlecenia.';

interface Call {
  input: AnalysisInput;
  resolve(): void;
  reject(error: unknown): void;
}

/** A provider whose every call waits until the test settles it. */
class GatedProvider implements LlmProvider {
  readonly name = 'mock' as const;
  readonly model = 'gated-1';
  readonly promptVersion = 'gated-1';
  readonly demo = true;
  readonly paid = false;
  readonly timeoutMs = 90_000;
  readonly calls: Call[] = [];
  private readonly inner = new MockProvider();

  analyzeOpportunity(input: AnalysisInput): Promise<ProviderOutput> {
    return new Promise((resolve, reject) => {
      this.calls.push({
        input,
        resolve: () => resolve(this.inner.analyzeOpportunity(input)),
        reject,
      });
    });
  }
}

/** A backoff wait the test ends by hand. */
function heldSleep() {
  const waits: { ms: number; release(): void }[] = [];
  return {
    waits,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        waits.push({ ms, release: resolve });
      }),
  };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !check(); i += 1) await new Promise((r) => setImmediate(r));
  expect(check()).toBe(true);
}

async function setup(options: Parameters<typeof buildTestApp>[0] = {}) {
  const clock = new FakeClock();
  const built = await buildTestApp({
    clock,
    env: { LLM_PROVIDER: 'mock', ANALYSIS_DAILY_LIMIT: '1000' },
    ...options,
  });
  const cookie = await loginAsOperator(built.app);
  const post = async (text: string) => {
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/signals/import',
      headers: { cookie },
      payload: { text },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ opportunityId: number }>().opportunityId;
  };
  const activity = async () => {
    const res = await built.app.inject({
      method: 'GET',
      url: '/api/analysis/activity',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return { raw: res.body, view: AnalysisActivity.parse(res.json()) };
  };
  const rowCount = () => openTestDb(built.dir).db.select().from(analyses).all().length;
  return { ...built, clock, cookie, post, activity, rowCount };
}

describe('analysis activity (FR-34 AC1, AC2, AC6)', () => {
  it('needs an operator session (AC6)', async () => {
    const t = await setup();
    const res = await t.app.inject({ method: 'GET', url: '/api/analysis/activity' });
    expect(res.statusCode).toBe(401);
  });

  it('shows queued, requesting, backoff, retry and the finished entry (AC1)', async () => {
    const provider = new GatedProvider();
    const held = heldSleep();
    const t = await setup({ provider, sleep: held.sleep });
    const first = await t.post(`DEMO pierwsze. ${BODY}`);
    const second = await t.post(`DEMO drugie. ${BODY}`);

    t.runner.kick();
    await until(() => provider.calls.length === 1);
    let { view } = await t.activity();
    expect(view.active).toMatchObject({
      opportunityId: first,
      provider: 'mock',
      model: 'gated-1',
      stage: 'requesting',
      attempt: 1,
      maxAttempts: 3,
      nextAttemptAt: null,
      lastReason: null,
      startedAt: t.clock.now().toISOString(),
    });
    expect(view.queued.total).toBe(1);
    expect(view.queued.items.map((item) => item.opportunityId)).toEqual([second]);
    expect(view.timeoutMs).toBe(90_000);
    expect(view.now).toBe(t.clock.now().toISOString());

    t.clock.advance(5000);
    provider.calls[0]!.reject(new ProviderError('unavailable', 503));
    await until(() => held.waits.length === 1);
    ({ view } = await t.activity());
    expect(held.waits[0]!.ms).toBe(2000);
    expect(view.active).toMatchObject({
      stage: 'backoff',
      attempt: 1,
      lastReason: 'provider_unavailable',
      nextAttemptAt: new Date(t.clock.now().getTime() + 2000).toISOString(),
    });

    held.waits[0]!.release();
    await until(() => provider.calls.length === 2);
    ({ view } = await t.activity());
    expect(view.active).toMatchObject({
      stage: 'requesting',
      attempt: 2,
      lastReason: 'provider_unavailable',
      nextAttemptAt: null,
      attemptStartedAt: t.clock.now().toISOString(),
    });

    provider.calls[1]!.reject(new ProviderError('rate_limited', 429, undefined, 7000));
    await until(() => held.waits.length === 2);
    expect(held.waits[1]!.ms).toBe(7000);
    held.waits[1]!.release();
    await until(() => provider.calls.length === 3);
    provider.calls[2]!.resolve();
    await until(() => provider.calls.length === 4);
    // The second opportunity is now in flight; the first is in the history after two retries.
    ({ view } = await t.activity());
    expect(view.history).toHaveLength(1);
    expect(view.history[0]).toMatchObject({
      opportunityId: first,
      outcome: 'complete',
      reason: null,
      attempts: 3,
      reused: false,
    });
    expect(view.active?.opportunityId).toBe(second);
    // Only the final outcome of an opportunity is stored, not each attempt (plan-review 2).
    expect(t.rowCount()).toBe(1);

    provider.calls[3]!.resolve();
    await t.runner.idle();
    ({ view } = await t.activity());
    expect(view.active).toBeNull();
    expect(view.queued).toEqual({ total: 0, items: [] });
    expect(view.history.map((entry) => entry.opportunityId)).toEqual([second, first]);
  });

  it('gives up on a long Retry-After and on a non-retryable error', async () => {
    const provider = new GatedProvider();
    const held = heldSleep();
    const t = await setup({ provider, sleep: held.sleep });
    await t.post(`DEMO jedno. ${BODY}`);
    t.runner.kick();
    await until(() => provider.calls.length === 1);
    provider.calls[0]!.reject(new ProviderError('rate_limited', 429, undefined, 31_000));
    await t.runner.idle();
    expect(held.waits).toHaveLength(0);
    const { view } = await t.activity();
    expect(view.history[0]).toMatchObject({
      outcome: 'failed',
      reason: 'rate_limited',
      attempts: 1,
    });
  });

  it('shows only reason codes, never raw errors, answers or source text (AC2)', async () => {
    const provider = new GatedProvider();
    const t = await setup({ provider });
    const longTitle = `DEMO ${'T'.repeat(195)}`;
    const canarySource = 'CANARY-SOURCE-BODY';
    await t.post(`${longTitle}\n${BODY}\n${canarySource}`);
    await t.post(`DEMO bad json. ${BODY}\n${canarySource}`);
    await t.post(`DEMO boom. ${BODY}\n${canarySource}`);
    t.runner.kick();

    await until(() => provider.calls.length === 1);
    provider.calls[0]!.reject(new Error('CANARY-ERROR-MESSAGE'));
    await until(() => provider.calls.length === 2);
    provider.calls[1]!.reject(new SyntaxError('Unexpected token CANARY-MODEL-TEXT'));
    await until(() => provider.calls.length === 3);
    provider.calls[2]!.reject(new ProviderError('refusal'));
    await t.runner.idle();

    const { raw, view } = await t.activity();
    expect(view.history.map((entry) => entry.reason)).toEqual([
      'refusal',
      'invalid_json',
      'provider_unavailable',
    ]);
    expect(raw).not.toContain('CANARY');
    const titled = view.history.find((entry) => entry.title.startsWith('DEMO TTT'));
    expect(titled!.title).toHaveLength(120);
  });

  it('bounds the history by count and by age (AC6)', async () => {
    const t = await setup();
    const repository = createAnalysisRepository(openTestDb(t.dir).db);
    expect(repository.waitingCount()).toBe(0);
    for (let i = 0; i < 101; i += 1) await t.post(`DEMO ${i}. ${BODY} nr ${i}`);
    await t.runner.drain();
    let { view } = await t.activity();
    expect(view.history).toHaveLength(100);
    // Newest first: the first imported opportunity is the one that fell out.
    expect(view.history.at(-1)!.title).toContain('DEMO 1.');

    t.clock.advance(7 * DAY + 1000);
    ({ view } = await t.activity());
    expect(view.history).toEqual([]);
  });
});
