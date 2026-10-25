import {
  ANALYSIS_SCHEMA_VERSION,
  OfferDraftContent,
  OpportunityAnalysis,
} from '@lead-hunter/contracts';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { profile } from '../../../test/helpers/analysis.js';
import type { AnalysisInput } from '../../modules/analysis/ports.js';
import type { OfferInput } from '../../modules/offers/ports.js';
import { MockProvider } from './mock.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../../test/fixtures/llm/${name}`, import.meta.url), 'utf8');

const input = (text: string, overrides: Parameters<typeof profile>[0] = {}): AnalysisInput => {
  const p = profile(overrides);
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    source: { title: 'DEMO', text, url: null, sourceType: 'manual_text' },
    profile: {
      skills: p.skills,
      serviceTypes: p.serviceTypes,
      preferredTechnologies: p.preferredTechnologies,
      excludedTechnologies: p.excludedTechnologies,
      languages: p.languages,
      rateRanges: p.rateRanges,
    },
  };
};

const run = async (text: string, overrides: Parameters<typeof profile>[0] = {}) =>
  OpportunityAnalysis.parse(
    (await new MockProvider().analyzeOpportunity(input(text, overrides))).output,
  );

describe('MockProvider (D-15)', () => {
  it('declares itself as demo rules, not AI', () => {
    const mock = new MockProvider();
    expect([mock.name, mock.model, mock.demo]).toEqual(['mock', 'mock-rules', true]);
  });

  it('is deterministic for the same input', async () => {
    const text = fixture('synthetic-direct-pl.txt');
    expect(await run(text)).toEqual(await run(text));
  });

  it('answers a hiring post with schema-valid DIRECT_REQUEST and a quoted budget', async () => {
    const result = await run(fixture('synthetic-direct-pl.txt'));
    if (result.verdict !== 'ANALYSED') throw new Error('expected ANALYSED');
    expect(result.evidenceLevel).toBe('DIRECT_REQUEST');
    expect(result.category).toBe('DIRECT_GIG');
    expect(result.relevantSkills).toContain('TypeScript');
    expect(result.sourceBudget).toEqual({
      minMinor: 800_000,
      maxMinor: 1_200_000,
      currency: 'PLN',
      quote: expect.stringContaining('8000-12000'),
    });
    expect(result.problem.startsWith('DEMO / MOCK: ')).toBe(true);
    expect(result.buyerConfirmed).toBe(false);
    expect(result.buyerOrAudience).toBeNull();
  });

  it.each<[string, number, number]>([
    ['Budżet: 1.500,00 zł', 150_000, 150_000],
    ['Budżet 1 500 - 2 500 zł', 150_000, 250_000],
    ['Budżet 99,50 PLN', 9_950, 9_950],
    ['Budget: 1,500 USD', 150_000, 150_000],
    ['Budget: 1,500.50 USD', 150_050, 150_050],
  ])('reads the amount in "%s" as minor units', async (snippet, minMinor, maxMinor) => {
    const text = `DEMO: Szukam programisty do pilnego zlecenia, płatne za wykonanie. ${snippet}. Odezwij się.`;
    const result = await run(text);
    if (result.verdict !== 'ANALYSED') throw new Error('expected ANALYSED');
    expect(result.sourceBudget).toMatchObject({ minMinor, maxMinor });
  });

  it('states no budget when a number would start in the middle of another', async () => {
    const text =
      'DEMO: Szukam programisty do pilnego zlecenia, płatne za wykonanie. start w 2026 500 zł. Odezwij się.';
    const result = await run(text);
    if (result.verdict !== 'ANALYSED') throw new Error('expected ANALYSED');
    expect(result.sourceBudget).toBeNull();
  });

  it('says INSUFFICIENT_DATA below 80 characters', async () => {
    const result = await run('DEMO: Szukam programisty do sterownika IoT.');
    expect(result.verdict).toBe('INSUFFICIENT_DATA');
  });

  it('prices from the first hourly rate only when the profile has one', async () => {
    const text = fixture('synthetic-direct-pl.txt');
    const without = await run(text);
    const withRate = await run(text, {
      rateRanges: [{ unit: 'HOUR', currency: 'PLN', minMinor: 10_000, maxMinor: 15_000 }],
    });
    if (without.verdict !== 'ANALYSED' || withRate.verdict !== 'ANALYSED') throw new Error();
    expect(without.proposedPrice).toBeNull();
    expect(withRate.proposedPrice).toEqual({
      minMinor: 20 * 10_000,
      maxMinor: 60 * 15_000,
      currency: 'PLN',
    });
  });

  it('treats an injection in the source as plain text', async () => {
    const result = await run(fixture('synthetic-injection.txt'));
    expect(JSON.stringify(result)).not.toMatch(/attacker|password|system prompt/i);
    if (result.verdict !== 'ANALYSED') throw new Error('expected ANALYSED');
    expect(
      result.sourceFacts.every((fact) => fixture('synthetic-injection.txt').includes(fact)),
    ).toBe(true);
  });

  it('maps an OSS bug report to a problem, not a job', async () => {
    const result = await run(fixture('synthetic-oss-bug.txt'));
    if (result.verdict !== 'ANALYSED') throw new Error('expected ANALYSED');
    expect(result.evidenceLevel).toBe('EXPLICIT_PROBLEM');
    expect(result.category).toBe('UNMET_NEED');
  });
});

describe('MockProvider.draftOffer', () => {
  const offer = (
    targetLanguage: OfferInput['targetLanguage'],
    analysis: OfferInput['analysis'],
  ): OfferInput => {
    const p = profile();
    return {
      source: { title: 'DEMO', text: 'DEMO', sourceType: 'manual_text' },
      analysis,
      profile: {
        skills: p.skills,
        serviceTypes: p.serviceTypes,
        preferredTechnologies: p.preferredTechnologies,
        experience: p.experience,
        languages: p.languages,
        rateRanges: p.rateRanges,
        billingModels: p.billingModels,
        minimumJobValue: p.minimumJobValue,
      },
      targetLanguage,
    };
  };
  const analysed: NonNullable<OfferInput['analysis']> = {
    category: 'DIRECT_GIG',
    problem: 'DEMO',
    mvpScope: ['DEMO: zakres'],
    exclusions: [],
    estimatedHours: { min: 20, max: 60 },
    proposedPrice: { minMinor: 200_000, maxMinor: 900_000, currency: 'PLN' },
    pricingAssumptions: ['DEMO: założenie'],
    requiredClarifications: ['zakres', 'termin', 'budżet', 'a', 'b', 'c', 'd'],
  };

  it.each<[OfferInput['targetLanguage'], OfferInput['analysis'], string]>([
    ['pl', analysed, 'pl'],
    ['en', analysed, 'en'],
    ['en', null, 'en'],
    [null, null, 'pl'],
  ])('is a contract-valid draft without URLs or e-mails (%s, %j)', async (lang, analysis, code) => {
    const { output } = await new MockProvider().draftOffer(offer(lang, analysis));
    const content = OfferDraftContent.parse(output);
    expect(content.language).toBe(code);
    expect(content.message.body.startsWith('DEMO / MOCK: ')).toBe(true);
    expect(content.questions.length).toBeGreaterThanOrEqual(3);
    expect(content.questions.length).toBeLessThanOrEqual(6);
    expect(JSON.stringify(content)).not.toMatch(/https?:\/\/|www\.|@/);
    expect(await new MockProvider().draftOffer(offer(lang, analysis))).toEqual({
      output,
      usage: { inputTokens: null, outputTokens: null },
    });
  });
});
