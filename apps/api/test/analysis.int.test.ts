import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  OperatorProfile,
  OpportunityAnalysis,
  ScoreBreakdown,
  type OperatorProfile as Profile,
} from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import { createAnalysisRepository } from '../src/infrastructure/db/analysis-repository.js';
import { createProfileRepository } from '../src/infrastructure/db/profile-repository.js';
import { analyses, opportunities } from '../src/infrastructure/db/schema.js';
import { MockProvider } from '../src/infrastructure/llm/mock.js';
import type { AnalysisInput, LlmProvider, ProviderOutput } from '../src/modules/analysis/ports.js';
import { createAnalysisRunner } from '../src/modules/analysis/service.js';
import { createProfileService } from '../src/modules/profile/service.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/llm/${name}`, import.meta.url)), 'utf8').trim();

/** The mock, with every input it receives recorded and optional per-text overrides. */
class RecordingProvider implements LlmProvider {
  readonly name = 'mock' as const;
  readonly model = 'recording';
  readonly promptVersion = 'recording-1';
  readonly demo = true;
  readonly inputs: AnalysisInput[] = [];
  private readonly inner = new MockProvider();

  constructor(private readonly override?: (input: AnalysisInput) => Promise<ProviderOutput>) {}

  async analyzeOpportunity(input: AnalysisInput): Promise<ProviderOutput> {
    this.inputs.push(input);
    return this.override ? this.override(input) : this.inner.analyzeOpportunity(input);
  }
}

async function setup(options: Parameters<typeof buildTestApp>[0] = {}) {
  const clock = (options.clock as FakeClock | undefined) ?? new FakeClock();
  const built = await buildTestApp({ clock, ...options });
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
  const rows = () => {
    const { db } = openTestDb(built.dir);
    return { opps: db.select().from(opportunities).all(), runs: db.select().from(analyses).all() };
  };
  const opp = (id: number) => rows().opps.find((o) => o.id === id)!;
  const runsFor = (id: number) => rows().runs.filter((r) => r.opportunityId === id);
  const putProfile = async (change: Partial<Profile>) => {
    const current = await built.app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { cookie },
    });
    const profile = OperatorProfile.parse({ ...current.json().profile, ...change });
    const res = await built.app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers: { cookie },
      payload: profile,
    });
    expect(res.statusCode).toBe(200);
  };
  return { ...built, clock, cookie, post, rows, opp, runsFor, putProfile };
}

const MOCK = { LLM_PROVIDER: 'mock' };

describe('analysis of a pasted post (FR-08 AC6, FR-10 AC1, AC4)', () => {
  it('stores a validated, scored, labelled mock analysis and repeats it exactly', async () => {
    const text = fixture('synthetic-direct-pl.txt');
    const first = await setup({ env: MOCK });
    const id = await first.post(text);
    await first.runner.drain();

    const row = first.opp(id);
    expect(row).toMatchObject({
      analysisStatus: 'COMPLETE',
      businessStatus: 'NEW',
      analysisProvider: 'mock',
      workMode: 'REMOTE',
      amountMaxMinor: 1_200_000,
      amountCurrency: 'PLN',
    });
    const [run] = first.runsFor(id);
    expect(run).toMatchObject({
      status: 'COMPLETE',
      provider: 'mock',
      model: 'mock-rules',
      promptVersion: 'mock-rules-1',
      schemaVersion: 2,
      inputTokens: null,
      outputTokens: null,
      error: null,
    });
    const breakdown = ScoreBreakdown.parse(JSON.parse(run!.breakdownJson!));
    expect(row.score).toBe(breakdown.total);
    expect(row.confidence).toBe(breakdown.confidence);
    const result = OpportunityAnalysis.parse(JSON.parse(run!.resultJson!));
    if (result.verdict !== 'ANALYSED') throw new Error('expected an analysed result');
    expect(text).toContain(result.sourceBudget!.quote);
    expect(JSON.parse(run!.guardNotesJson!)).toEqual([]);

    const second = await setup({ env: MOCK });
    const id2 = await second.post(text);
    await second.runner.drain();
    const [run2] = second.runsFor(id2);
    expect(run2!.resultJson).toBe(run!.resultJson);
    expect(run2!.breakdownJson).toBe(run!.breakdownJson);
  });

  it('scores a post without a budget and leaves sourceBudget null (FR-10 AC4)', async () => {
    const t = await setup({ env: MOCK });
    const id = await t.post(
      'DEMO: Szukam programisty React do prostej strony, zapłacimy za wykonanie. Zdalnie, szczegóły po rozmowie.',
    );
    await t.runner.drain();
    const [run] = t.runsFor(id);
    const result = JSON.parse(run!.resultJson!);
    expect(result.sourceBudget).toBeNull();
    expect(t.opp(id)).toMatchObject({ amountMaxMinor: null, amountCurrency: null });
    expect(t.opp(id).score).not.toBeNull();
  });

  it('analyses after an import without a manual drain when the runner is kicked (D-4)', async () => {
    const t = await setup({ env: MOCK, autoKick: true });
    const id = await t.post(fixture('synthetic-direct-pl.txt'));
    await t.runner.idle();
    expect(t.opp(id).analysisStatus).toBe('COMPLETE');
  });
});

describe('pre-filter (FR-07 AC1, AC2)', () => {
  it('rejects SEEKING WORK without calling the provider and analyses SEEKING FREELANCER', async () => {
    const provider = new RecordingProvider();
    const t = await setup({ env: MOCK, provider });
    const work = await t.post(fixture('synthetic-seeking-work.txt'));
    const freelancer = await t.post(fixture('synthetic-seeking-freelancer.txt'));
    await t.runner.drain();

    expect(t.opp(work)).toMatchObject({
      businessStatus: 'REJECTED',
      analysisStatus: 'SKIPPED',
      prefilterRule: 'seeking_work',
    });
    expect(t.runsFor(work)).toEqual([]);
    expect(t.opp(freelancer)).toMatchObject({
      analysisStatus: 'COMPLETE',
      prefilterRule: null,
    });
    expect(provider.inputs.map((i) => i.source.text)).toEqual([
      fixture('synthetic-seeking-freelancer.txt'),
    ]);
  });

  it('rejects a post naming an excluded technology of the profile', async () => {
    const provider = new RecordingProvider();
    const t = await setup({ env: MOCK, provider });
    await t.putProfile({ excludedTechnologies: ['Java'] });
    const id = await t.post(
      'DEMO: Szukamy programisty Java do rozbudowy systemu, zapłacimy za pracę.',
    );
    await t.runner.drain();
    expect(t.opp(id)).toMatchObject({
      businessStatus: 'REJECTED',
      analysisStatus: 'SKIPPED',
      prefilterRule: 'excluded_technology',
    });
    expect(provider.inputs).toEqual([]);
  });
});

describe('daily limit (FR-07 AC3)', () => {
  it('analyses the best matches first and resumes on the next Warsaw day', async () => {
    const t = await setup({ env: { ...MOCK, ANALYSIS_DAILY_LIMIT: '1' } });
    const one = await t.post(
      'DEMO: Szukamy programisty TypeScript do prostego narzędzia wewnętrznego, zapłacimy za wykonanie.',
    );
    const two = await t.post(
      'DEMO: Szukamy programisty TypeScript i React do aplikacji dla działu sprzedaży, zapłacimy.',
    );
    const three = await t.post(
      'DEMO: Szukamy programisty TypeScript, Node.js oraz React do integracji, zapłacimy za wykonanie.',
    );
    await t.runner.drain();

    expect(t.opp(three).analysisStatus).toBe('COMPLETE');
    expect(t.opp(two).analysisStatus).toBe('PENDING');
    expect(t.opp(one).analysisStatus).toBe('PENDING');
    expect(createAnalysisRepository(openTestDb(t.dir).db).waitingCount()).toBe(2);

    await t.runner.drain();
    expect(t.rows().runs).toHaveLength(1);

    t.clock.advance(24 * 3_600_000);
    await t.runner.drain();
    expect(t.opp(two).analysisStatus).toBe('COMPLETE');
    expect(t.opp(one).analysisStatus).toBe('PENDING');
  });
});

describe('analysis not configured (FR-08 AC5)', () => {
  it('pre-filters but leaves opportunities pending, and the API keeps working', async () => {
    const t = await setup();
    const id = await t.post(fixture('synthetic-direct-pl.txt'));
    const rejected = await t.post(fixture('synthetic-seeking-work.txt'));
    await t.runner.drain();

    expect(t.opp(id)).toMatchObject({ analysisStatus: 'PENDING', prefilterRule: null });
    expect(t.opp(id).prefilterAt).not.toBeNull();
    expect(t.opp(rejected)).toMatchObject({
      analysisStatus: 'SKIPPED',
      businessStatus: 'REJECTED',
    });
    expect(t.rows().runs).toEqual([]);

    const list = await t.app.inject({
      method: 'GET',
      url: '/api/opportunities',
      headers: { cookie: t.cookie },
    });
    expect(list.statusCode).toBe(200);
    const detail = await t.app.inject({
      method: 'GET',
      url: `/api/opportunities/${id}`,
      headers: { cookie: t.cookie },
    });
    expect(detail.statusCode).toBe(200);
  });
});

describe('insufficient data (FR-08 AC8)', () => {
  it('marks the opportunity for verification and gives no score', async () => {
    const t = await setup({ env: MOCK });
    const id = await t.post('DEMO: Potrzebuję strony, krótko, bez szczegółów.');
    await t.runner.drain();
    expect(t.opp(id)).toMatchObject({
      analysisStatus: 'COMPLETE',
      businessStatus: 'NEEDS_VERIFICATION',
      score: null,
      confidence: null,
    });
    const [run] = t.runsFor(id);
    expect(run!.breakdownJson).toBeNull();
    expect(JSON.parse(run!.resultJson!).verdict).toBe('INSUFFICIENT_DATA');
  });
});

describe('evidence guard through the mock (FR-10 AC3)', () => {
  it('never shows an OSS bug report as a direct request or a paid job', async () => {
    const t = await setup({ env: MOCK });
    const id = await t.post(fixture('synthetic-oss-bug.txt'));
    await t.runner.drain();
    const row = t.opp(id);
    expect(row.analysisStatus).toBe('COMPLETE');
    expect(row.evidenceLevel).not.toBe('DIRECT_REQUEST');
    expect(row.category).not.toBe('DIRECT_GIG');
    expect(row.category).not.toBe('B2B_SUBCONTRACT');
  });
});

describe('invalid provider output (TR-07)', () => {
  it('fails the row with a reason, keeps the signal and goes on with the next', async () => {
    const usage = { inputTokens: null, outputTokens: null };
    const mock = new MockProvider();
    const provider = new RecordingProvider(async (input) => {
      const { source } = input;
      if (source.text.includes('HOURS')) {
        const valid = await mock.analyzeOpportunity(input);
        return {
          output: { ...(valid.output as object), estimatedHours: { min: 1, max: 10_001 } },
          usage,
        };
      }
      if (source.text.includes('SCALAR')) return { output: 'not an object', usage };
      if (source.text.includes('THROW')) throw new Error('boom');
      return mock.analyzeOpportunity(input);
    });
    const t = await setup({ env: MOCK, provider });
    const pad = 'Szukamy programisty TypeScript do narzędzia wewnętrznego, zapłacimy za wykonanie.';
    const hours = await t.post(`DEMO HOURS: ${pad}`);
    const scalar = await t.post(`DEMO SCALAR: ${pad}`);
    const thrown = await t.post(`DEMO THROW: ${pad}`);
    const good = await t.post(`DEMO GOOD: ${pad}`);
    await t.runner.drain();

    expect(t.opp(hours).analysisStatus).toBe('FAILED');
    expect(t.runsFor(hours)[0]).toMatchObject({ status: 'FAILED' });
    expect(t.runsFor(hours)[0]!.error).toMatch(/^invalid_output: .*estimatedHours\.max/);
    expect(t.runsFor(scalar)[0]!.error).toMatch(/^invalid_output: /);
    expect(t.runsFor(thrown)[0]!.error).toBe('provider_error: boom');
    expect(t.opp(thrown)).toMatchObject({ analysisStatus: 'FAILED', businessStatus: 'NEW' });
    expect(t.opp(good).analysisStatus).toBe('COMPLETE');

    const list = await t.app.inject({
      method: 'GET',
      url: '/api/opportunities',
      headers: { cookie: t.cookie },
    });
    expect(list.json().total).toBe(4);
  });

  it('marks a row failed when saving its result throws, and analyses the next one', async () => {
    const t = await setup({ env: MOCK });
    const first = await t.post(fixture('synthetic-direct-pl.txt'));
    const second = await t.post(
      'DEMO: Szukamy programisty TypeScript do narzędzia wewnętrznego, zapłacimy za wykonanie.',
    );

    const { db } = openTestDb(t.dir);
    const real = createAnalysisRepository(db);
    let thrown = false;
    const runner = createAnalysisRunner({
      repository: {
        ...real,
        saveComplete(analysis) {
          if (!thrown) {
            thrown = true;
            throw new Error('disk full');
          }
          real.saveComplete(analysis);
        },
      },
      provider: new MockProvider(),
      profile: {
        get: () =>
          createProfileService({ repository: createProfileRepository(db), clock: t.clock }).get()
            .profile,
      },
      clock: t.clock,
      dailyLimit: 20,
      maxAgeDays: 30,
      onError: () => undefined,
    });
    await runner.drain();

    const failed = [first, second].map((id) => t.opp(id).analysisStatus).sort();
    expect(failed).toEqual(['COMPLETE', 'FAILED']);
    const failedId = t.opp(first).analysisStatus === 'FAILED' ? first : second;
    expect(t.runsFor(failedId)[0]!.error).toBe('internal_error: disk full');
  });
});

describe('prompt injection and leakage (TR-02)', () => {
  it('gives the provider data only and changes nothing else', async () => {
    const canary = 'LEAK-CANARY-4d1f';
    const hash = `scrypt:15:8:3:${'A'.repeat(22)}:${'B'.repeat(43)}`;
    const provider = new RecordingProvider();
    const t = await setup({
      env: { ...MOCK, OPERATOR_PASSWORD_HASH: hash, LEAK_CANARY: canary },
      provider,
    });
    const profileBefore = await t.app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { cookie: t.cookie },
    });

    const text = fixture('synthetic-injection.txt');
    const id = await t.post(text);
    await t.runner.drain();

    expect(provider.inputs).toHaveLength(1);
    const input = provider.inputs[0]!;
    expect(Object.keys(input).sort()).toEqual(['profile', 'schemaVersion', 'source']);
    expect(input.source.text).toBe(text);
    expect(JSON.stringify(input.profile)).not.toMatch(/ignore|instructions|password/i);
    const serialised = JSON.stringify(input);
    for (const secret of [canary, hash]) expect(serialised).not.toContain(secret);

    const stored = JSON.stringify(t.rows());
    for (const secret of [canary, hash]) expect(stored).not.toContain(secret);
    expect(t.opp(id).analysisStatus).toBe('COMPLETE');

    const profileAfter = await t.app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { cookie: t.cookie },
    });
    expect(profileAfter.body).toBe(profileBefore.body);
  });
});

describe('GET /api/analysis/status (D-11)', () => {
  it('counts what waits and says when the daily limit is reached', async () => {
    const t = await setup({ env: { ...MOCK, ANALYSIS_DAILY_LIMIT: '1' } });
    await t.post('DEMO: Szukamy programisty TypeScript do narzędzia, zapłacimy za wykonanie.');
    await t.post('DEMO: Szukamy programisty TypeScript i React do aplikacji, zapłacimy.');
    await t.post(
      'DEMO: Szukamy programisty TypeScript, Node.js oraz React, zapłacimy za wykonanie.',
    );
    await t.runner.drain();
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/analysis/status',
      headers: { cookie: t.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      configured: true,
      provider: 'mock',
      demo: true,
      dailyLimit: 1,
      analysedToday: 1,
      waiting: 2,
      limitReached: true,
    });
  });

  it('says analysis is not configured without LLM_PROVIDER', async () => {
    const t = await setup();
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/analysis/status',
      headers: { cookie: t.cookie },
    });
    expect(res.json()).toMatchObject({
      configured: false,
      provider: null,
      demo: false,
      analysedToday: 0,
      limitReached: false,
    });
  });
});
