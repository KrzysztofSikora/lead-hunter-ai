import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAnalysisRepository } from '../src/infrastructure/db/analysis-repository.js';
import { analyses, opportunities, rawSignals } from '../src/infrastructure/db/schema.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/llm/${name}`, import.meta.url)), 'utf8');
const json = (name: string): Record<string, unknown> =>
  JSON.parse(read(name)) as Record<string, unknown>;

const KEY = 'sk-LEAK-CANARY';
const agent = getGlobalDispatcher() as MockAgent;
const JSON_HEADERS = { 'content-type': 'application/json' };

let sequence = 0;
let ANTHROPIC = '';
let COMPAT = '';
let outbound = 0;

beforeEach(() => {
  sequence += 1;
  ANTHROPIC = `https://llm-${sequence}.anthropic.test`;
  COMPAT = `http://llm-${sequence}.compat.test:11434`;
  outbound = 0;
});

/** Every request to the origin gets this answer and is counted in `outbound`. */
function answer(origin: string, path: string, status: number, body: unknown): void {
  agent
    .get(origin)
    .intercept({ path, method: 'POST' })
    .reply(() => {
      outbound += 1;
      return {
        statusCode: status,
        data: typeof body === 'string' ? body : JSON.stringify(body),
        responseOptions: { headers: JSON_HEADERS },
      };
    })
    .persist();
}

/** The Anthropic fixture with its text block replaced by a (changed) analysis. */
function anthropicWith(change: (analysis: Record<string, unknown>) => void): unknown {
  const message = json('anthropic-valid.json') as { content: { type: string; text?: string }[] };
  const block = message.content.find((b) => b.type === 'text')!;
  const analysis = JSON.parse(block.text!) as Record<string, unknown>;
  change(analysis);
  block.text = JSON.stringify(analysis);
  return message;
}

const MESSAGES = '/v1/messages';
const CHAT = '/v1/chat/completions';
const anthropicEnv = (extra: Record<string, string> = {}) => ({
  LLM_PROVIDER: 'anthropic',
  LLM_API_KEY: KEY,
  LLM_BASE_URL: ANTHROPIC,
  LLM_MONTHLY_BUDGET_USD: '10',
  ...extra,
});
// 1 801 tokens at 10 USD per million each: 18 010 micro-USD, above a 0.01 USD cap.
const EXPENSIVE = { LLM_PRICES: 'claude-haiku-5-5=10/10', LLM_MONTHLY_BUDGET_USD: '0.01' };

const post = (n: number) =>
  `DEMO: Szukamy programisty TypeScript nr ${n} do narzędzia wewnętrznego, zapłacimy za wykonanie.`;

async function setup(options: Parameters<typeof buildTestApp>[0] = {}) {
  const clock = (options.clock as FakeClock | undefined) ?? new FakeClock();
  const built = await buildTestApp({ clock, ...options });
  const cookie = await loginAsOperator(built.app);
  const importText = async (text: string) => {
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/signals/import',
      headers: { cookie },
      payload: { text },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ opportunityId: number }>().opportunityId;
  };
  const db = () => openTestDb(built.dir).db;
  const runs = (id?: number) => {
    const all = db().select().from(analyses).all();
    return id === undefined ? all : all.filter((r) => r.opportunityId === id);
  };
  const opp = (id: number) =>
    db()
      .select()
      .from(opportunities)
      .all()
      .find((o) => o.id === id)!;
  const status = async () =>
    (
      await built.app.inject({
        method: 'GET',
        url: '/api/analysis/status',
        headers: { cookie },
      })
    ).json();
  const detail = async (id: number) =>
    (
      await built.app.inject({
        method: 'GET',
        url: `/api/opportunities/${id}`,
        headers: { cookie },
      })
    ).json();
  return { ...built, clock, cookie, importText, db, runs, opp, status, detail };
}

describe('a real provider through the runner (FR-08 AC1, AC7)', () => {
  it('stores provider, model, versions, tokens and cost of a valid answer', async () => {
    answer(ANTHROPIC, MESSAGES, 200, json('anthropic-valid.json'));
    const t = await setup({ env: anthropicEnv() });
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    await t.runner.drain();

    const [run] = t.runs(id);
    expect(run).toMatchObject({
      status: 'COMPLETE',
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      inputTokens: 1234,
      outputTokens: 567,
      costMicroUsd: 407, // ceil((1234 × 0.10 + 567 × 0.50) USD / 1e6)
      reusedFromAnalysisId: null,
    });
    expect(run!.promptVersion).toMatch(/^analysis-/);
    expect(t.opp(id).analysisStatus).toBe('COMPLETE');
    const view = await t.detail(id);
    expect(view.latestAnalysis).toMatchObject({
      demo: false,
      costMicroUsd: 407,
      reusedFromAnalysisId: null,
    });
    expect(await t.status()).toMatchObject({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      paid: true,
      blocked: null,
      budget: { capMicroUsd: 10_000_000, spentMicroUsd: 407, unknownCostCount: 0 },
    });
  });

  it('runs the OpenAI-compatible adapter through the same runner', async () => {
    answer(COMPAT, CHAT, 200, json('openai-valid.json'));
    const t = await setup({
      env: {
        LLM_PROVIDER: 'openai-compatible',
        LLM_BASE_URL: `${COMPAT}/v1`,
        LLM_MODEL: 'demo-model',
      },
    });
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    await t.runner.drain();
    expect(t.opp(id).analysisStatus).toBe('COMPLETE');
    expect(t.runs(id)[0]).toMatchObject({ provider: 'openai-compatible', model: 'demo-model' });
  });
});

describe('rejected answers (FR-08 AC2)', () => {
  const bad: [string, unknown, RegExp][] = [
    ['not JSON', json('anthropic-not-json.json'), /^invalid_output: not_json$/],
    ['schema failure', anthropicWith((a) => delete a.category), /^invalid_output: category/],
    [
      'overlong text',
      anthropicWith((a) => (a.problem = 'x'.repeat(5000))),
      /^invalid_output: problem/,
    ],
    [
      'out-of-range number',
      anthropicWith((a) => (a.estimatedHours = { min: -5, max: 10 })),
      /^invalid_output: estimatedHours/,
    ],
    ['refusal', json('anthropic-refusal.json'), /^provider_error: refusal$/],
    ['truncated', json('anthropic-truncated.json'), /^provider_error: truncated$/],
  ];

  it.each(bad)(
    '%s gives FAILED with a reason and keeps the signal',
    async (_name, body, reason) => {
      answer(ANTHROPIC, MESSAGES, 200, body);
      const t = await setup({ env: anthropicEnv() });
      const id = await t.importText(read('synthetic-direct-pl.txt'));
      await t.runner.drain();

      expect(t.opp(id).analysisStatus).toBe('FAILED');
      const [run] = t.runs(id);
      expect(run!.status).toBe('FAILED');
      expect(run!.error).toMatch(reason);
      expect(t.db().select().from(rawSignals).all()).toHaveLength(1);
      expect((await t.detail(id)).latestAnalysis.error).toMatch(reason);
    },
  );

  it('records the cost of a billed answer that was rejected', async () => {
    answer(
      ANTHROPIC,
      MESSAGES,
      200,
      anthropicWith((a) => delete a.category),
    );
    const t = await setup({ env: anthropicEnv() });
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    await t.runner.drain();
    expect(t.runs(id)[0]).toMatchObject({ costMicroUsd: 407, inputTokens: 1234 });
    expect((await t.status()).budget.spentMicroUsd).toBe(407);
  });

  it.each([
    ['refusal', 'anthropic-refusal.json', 1],
    ['truncated', 'anthropic-truncated.json', 4001],
    ['not JSON', 'anthropic-not-json.json', 4],
  ])('costs a billed %s and counts it against the cap (R2)', async (_name, file, micro) => {
    answer(ANTHROPIC, MESSAGES, 200, json(file));
    const t = await setup({ env: anthropicEnv() });
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    await t.runner.drain();
    expect(t.runs(id)[0]).toMatchObject({ status: 'FAILED', costMicroUsd: micro });
    expect((await t.status()).budget.spentMicroUsd).toBe(micro);
  });

  it('stops the drain after a provider-wide error and leaks no secret (TR-12)', async () => {
    answer(ANTHROPIC, MESSAGES, 401, {
      type: 'error',
      error: { type: 'authentication_error', message: `invalid key ${KEY}` },
    });
    const t = await setup({ env: anthropicEnv() });
    const first = await t.importText(post(1));
    await t.importText(post(2));
    await t.importText(post(3));
    await t.runner.drain();

    expect(outbound).toBe(1);
    expect(t.runs(first)[0]!.error).toBe('provider_error: auth 401');
    expect(t.opp(first).analysisStatus).toBe('FAILED');
    const waiting = t
      .db()
      .select()
      .from(opportunities)
      .all()
      .filter((o) => o.analysisStatus === 'PENDING');
    expect(waiting).toHaveLength(2);
    expect((await t.status()).waiting).toBe(2);

    const everything = JSON.stringify([t.runs(), await t.status(), await t.detail(first)]);
    expect(everything).not.toContain(KEY);
  });

  it('does not stop the drain after an invalid answer', async () => {
    answer(
      ANTHROPIC,
      MESSAGES,
      200,
      anthropicWith((a) => delete a.category),
    );
    const t = await setup({ env: anthropicEnv() });
    await t.importText(post(1));
    await t.importText(post(2));
    await t.runner.drain();
    expect(outbound).toBe(2);
  });

  it('rejects an answer that echoes the API key', async () => {
    answer(
      ANTHROPIC,
      MESSAGES,
      200,
      anthropicWith((a) => (a.nextAction = `use ${KEY} to log in`)),
    );
    const t = await setup({ env: anthropicEnv() });
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    await t.runner.drain();
    expect(t.runs(id)[0]).toMatchObject({
      status: 'FAILED',
      error: 'invalid_output: secret_echo',
    });
    expect(JSON.stringify(t.runs())).not.toContain(KEY);
  });
});

describe('source content stays data (FR-08 AC3, AC4)', () => {
  it('an injection text changes neither the profile nor the number of outbound calls', async () => {
    answer(ANTHROPIC, MESSAGES, 200, json('anthropic-valid.json'));
    const t = await setup({ env: anthropicEnv() });
    const profile = () =>
      t.app.inject({ method: 'GET', url: '/api/profile', headers: { cookie: t.cookie } });
    const before = (await profile()).json();
    const id = await t.importText(read('synthetic-injection.txt'));
    await t.runner.drain();

    expect(outbound).toBe(1);
    expect(t.opp(id).analysisStatus).toBe('COMPLETE');
    expect((await profile()).json()).toEqual(before);
  });

  it('removes a URL and an e-mail the source does not contain and shows the notes', async () => {
    answer(
      ANTHROPIC,
      MESSAGES,
      200,
      anthropicWith((a) => {
        a.nextAction = 'Write to boss@invented.example or see https://invented.example/job';
      }),
    );
    const t = await setup({ env: anthropicEnv() });
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    await t.runner.drain();

    const view = await t.detail(id);
    const stored = JSON.stringify(view.latestAnalysis.result);
    expect(stored).not.toContain('invented.example');
    expect(view.latestAnalysis.result.nextAction).toContain('[usunięto]');
    expect(view.latestAnalysis.guardNotes.join(' ')).toContain('invented.example');
  });
});

describe('budget (FR-09 AC1, AC2, AC4)', () => {
  it('a paid provider without a cap analyses nothing, imports go on', async () => {
    answer(ANTHROPIC, MESSAGES, 200, json('anthropic-valid.json'));
    const t = await setup({ env: anthropicEnv({ LLM_MONTHLY_BUDGET_USD: '' }) });
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    await t.runner.drain();

    expect(outbound).toBe(0);
    expect(t.opp(id).analysisStatus).toBe('PENDING');
    expect(await t.status()).toMatchObject({
      blocked: 'budget_missing',
      waiting: 1,
      budget: { capMicroUsd: null },
    });
    await t.importText(post(2)); // still 201
  });

  it('a paid model without a price is blocked, not guessed', async () => {
    answer(ANTHROPIC, MESSAGES, 200, json('anthropic-valid.json'));
    const t = await setup({ env: anthropicEnv({ LLM_MODEL: 'claude-unlisted-1' }) });
    await t.importText(read('synthetic-direct-pl.txt'));
    await t.runner.drain();
    expect(outbound).toBe(0);
    expect(await t.status()).toMatchObject({ blocked: 'price_unknown' });
  });

  it('stops at the cap, keeps importing, and resumes next month', async () => {
    answer(ANTHROPIC, MESSAGES, 200, json('anthropic-valid.json'));
    const t = await setup({ env: anthropicEnv(EXPENSIVE) });
    const first = await t.importText(post(1));
    const second = await t.importText(post(2));
    await t.runner.drain();

    expect(outbound).toBe(1);
    expect(t.opp(first).analysisStatus).toBe('COMPLETE');
    expect(t.opp(second).analysisStatus).toBe('PENDING');
    expect(await t.status()).toMatchObject({
      blocked: 'budget_reached',
      budget: { capMicroUsd: 10_000, spentMicroUsd: 18_010 },
    });
    await t.importText(post(3)); // imports are not blocked

    t.clock.advance(32 * 86_400_000); // Feb 2026 in Europe/Warsaw
    expect(t.runner.status().blocked).toBeNull();
    await t.runner.drain();
    expect(t.opp(second).analysisStatus).toBe('COMPLETE');
  });

  it('a paid answer without usage costs "brak danych" and is counted', async () => {
    answer(COMPAT, CHAT, 200, json('openai-no-usage.json'));
    const t = await setup({
      env: {
        LLM_PROVIDER: 'openai-compatible',
        LLM_BASE_URL: `${COMPAT}/v1`,
        LLM_MODEL: 'demo-model',
        LLM_PAID: 'true',
        LLM_PRICES: 'demo-model=1/1',
        LLM_MONTHLY_BUDGET_USD: '10',
      },
    });
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    await t.runner.drain();
    expect(t.runs(id)[0]).toMatchObject({
      status: 'COMPLETE',
      costMicroUsd: null,
      inputTokens: null,
      outputTokens: null,
    });
    expect(await t.status()).toMatchObject({
      blocked: null,
      budget: { spentMicroUsd: 0, unknownCostCount: 1 },
    });
    expect((await t.detail(id)).latestAnalysis).toMatchObject({ costMicroUsd: null });
  });

  it('a free provider with an unknown model costs 0 and is never "bez danych"', async () => {
    answer(COMPAT, CHAT, 200, json('openai-no-usage.json'));
    const t = await setup({
      env: {
        LLM_PROVIDER: 'openai-compatible',
        LLM_BASE_URL: `${COMPAT}/v1`,
        LLM_MODEL: 'demo-model',
      },
    });
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    await t.runner.drain();
    expect(t.runs(id)[0]).toMatchObject({ costMicroUsd: 0 });
    expect(await t.status()).toMatchObject({
      paid: false,
      blocked: null,
      budget: { unknownCostCount: 0 },
    });
  });
});

describe('daily limit with a real provider (FR-09 AC3)', () => {
  it('analyses two of three and leaves the third waiting', async () => {
    answer(ANTHROPIC, MESSAGES, 200, json('anthropic-valid.json'));
    const t = await setup({ env: anthropicEnv({ ANALYSIS_DAILY_LIMIT: '2' }) });
    await t.importText(post(1));
    await t.importText(post(2));
    await t.importText(post(3));
    await t.runner.drain();
    expect(outbound).toBe(2);
    expect(await t.status()).toMatchObject({ analysedToday: 2, waiting: 1, limitReached: true });
  });
});

describe('reuse by content hash (FR-09 AC5)', () => {
  async function analysed() {
    answer(ANTHROPIC, MESSAGES, 200, json('anthropic-valid.json'));
    const t = await setup({ env: anthropicEnv() });
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    await t.runner.drain();
    expect(outbound).toBe(1);
    const requeue = (force: boolean) =>
      createAnalysisRepository(t.db()).requeue(id, force, t.clock.now().getTime());
    return { ...t, id, requeue };
  }

  it('re-queued without force reuses the stored result: no call, no cost, not counted', async () => {
    const t = await analysed();
    expect(t.requeue(false)).toBe(true);
    await t.runner.drain();

    expect(outbound).toBe(1);
    const [original, reused] = t.runs(t.id);
    expect(reused).toMatchObject({
      status: 'COMPLETE',
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      reusedFromAnalysisId: original!.id,
      costMicroUsd: null,
      resultJson: original!.resultJson,
    });
    expect(t.opp(t.id).analysisStatus).toBe('COMPLETE');
    expect(await t.status()).toMatchObject({
      analysedToday: 1,
      budget: { spentMicroUsd: 407, unknownCostCount: 0 },
    });
  });

  it('with force the provider is called again', async () => {
    const t = await analysed();
    t.requeue(true);
    await t.runner.drain();
    expect(outbound).toBe(2);
    expect(t.runs(t.id)).toHaveLength(2);
    expect(t.runs(t.id)[1]!.reusedFromAnalysisId).toBeNull();
    expect(t.opp(t.id).analysisForce).toBe(0);
  });

  it('a signal without a content hash is never reused', async () => {
    const t = await analysed();
    t.db().update(rawSignals).set({ contentHash: null }).run();
    t.requeue(false);
    await t.runner.drain();
    expect(outbound).toBe(2);
  });

  it('a different prompt version does not match', async () => {
    const t = await analysed();
    t.db().update(analyses).set({ promptVersion: 'analysis-0' }).run();
    t.requeue(false);
    await t.runner.drain();
    expect(outbound).toBe(2);
  });

  it('re-guards a reused result against the new text', async () => {
    const t = await analysed();
    t.db()
      .update(analyses)
      .set({
        resultJson: JSON.stringify({
          ...JSON.parse(t.runs(t.id)[0]!.resultJson!),
          nextAction: 'See https://invented.example/x',
        }),
      })
      .run();
    t.requeue(false);
    await t.runner.drain();
    const last = t.runs(t.id)[1]!;
    expect(last.reusedFromAnalysisId).not.toBeNull();
    expect(last.resultJson).not.toContain('invented.example');
  });

  it('cannot requeue a pre-filtered opportunity', async () => {
    const t = await analysed();
    t.db().update(opportunities).set({ analysisStatus: 'SKIPPED', prefilterRule: 'no_text' }).run();
    expect(t.requeue(false)).toBe(false);
  });
});
