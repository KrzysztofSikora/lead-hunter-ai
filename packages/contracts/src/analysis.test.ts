import { describe, expect, it } from 'vitest';
import { OpportunityAnalysis, ScoreBreakdown, upgradeStoredAnalysis } from './analysis.js';

const analysed = {
  verdict: 'ANALYSED',
  category: 'DIRECT_GIG',
  evidenceLevel: 'DIRECT_REQUEST',
  problem: 'DEMO: potrzebny sterownik',
  buyerOrAudience: null,
  buyerConfirmed: false,
  relevantSkills: ['IoT'],
  solutionApproach: 'DEMO',
  suggestedDeliverable: 'DEMO',
  mvpScope: ['DEMO'],
  exclusions: [],
  monetizationModel: 'FIXED_PRICE',
  estimatedHours: { min: 10, max: 20 },
  proposedPrice: { minMinor: 100_000, maxMinor: 200_000, currency: 'PLN' },
  pricingAssumptions: [],
  requiredClarifications: [],
  nextAction: 'DEMO',
  uncertainties: [],
  rationale: 'DEMO',
  sourceFacts: [],
  inferences: [],
  unknowns: [],
  sourceBudget: null,
  industry: null,
  workMode: 'UNKNOWN',
  countries: ['PL'],
};

const insufficient = {
  verdict: 'INSUFFICIENT_DATA',
  reason: 'DEMO',
  unknowns: [],
  sourceFacts: [],
};

const parses = (value: unknown) => OpportunityAnalysis.safeParse(value).success;

describe('OpportunityAnalysis (schema v2)', () => {
  it('accepts a full ANALYSED result and an INSUFFICIENT_DATA result', () => {
    expect(parses(analysed)).toBe(true);
    expect(parses(insufficient)).toBe(true);
  });

  it.each<[string, unknown]>([
    ['unknown field', { ...analysed, phone: '123' }],
    ['unknown field on INSUFFICIENT_DATA', { ...insufficient, category: 'DIRECT_GIG' }],
    ['no mvpScope', { ...analysed, mvpScope: undefined }],
    ['no exclusions', { ...analysed, exclusions: undefined }],
    ['mvpScope item over 500 characters', { ...analysed, mvpScope: ['x'.repeat(501)] }],
    ['unknown verdict', { ...analysed, verdict: 'MAYBE' }],
    ['no verdict', { ...analysed, verdict: undefined }],
    ['problem over 2000 characters', { ...analysed, problem: 'x'.repeat(2001) }],
    ['short field over 500 characters', { ...analysed, nextAction: 'x'.repeat(501) }],
    ['list over 20 items', { ...analysed, unknowns: Array.from({ length: 21 }, () => 'x') }],
    ['hours 0', { ...analysed, estimatedHours: { min: 0, max: 5 } }],
    ['hours 10001', { ...analysed, estimatedHours: { min: 1, max: 10_001 } }],
    ['hours min > max', { ...analysed, estimatedHours: { min: 9, max: 5 } }],
    [
      'price min > max',
      { ...analysed, proposedPrice: { minMinor: 5, maxMinor: 4, currency: 'PLN' } },
    ],
    [
      'negative minor units',
      { ...analysed, proposedPrice: { minMinor: -1, maxMinor: 4, currency: 'PLN' } },
    ],
    [
      'float minor units',
      { ...analysed, proposedPrice: { minMinor: 1.5, maxMinor: 4, currency: 'PLN' } },
    ],
    [
      'unknown currency',
      { ...analysed, proposedPrice: { minMinor: 1, maxMinor: 4, currency: 'GBP' } },
    ],
    [
      'budget without quote',
      { ...analysed, sourceBudget: { minMinor: 1, maxMinor: 4, currency: 'PLN', quote: '' } },
    ],
    ['bad country code', { ...analysed, countries: ['pl'] }],
    ['too many countries', { ...analysed, countries: Array.from({ length: 21 }, () => 'PL') }],
  ])('rejects %s', (_name, value) => {
    expect(parses(value)).toBe(false);
  });

  it('reports a refine failure under the field that is wrong', () => {
    const result = OpportunityAnalysis.safeParse({
      ...analysed,
      estimatedHours: { min: 9, max: 5 },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['estimatedHours', 'max']);
  });
});

describe('upgradeStoredAnalysis', () => {
  const v1: Record<string, unknown> = { ...analysed };
  delete v1.mvpScope;
  delete v1.exclusions;

  it('reads a v1 ANALYSED result with empty lists', () => {
    expect(parses(v1)).toBe(false);
    const upgraded = upgradeStoredAnalysis(v1, 1);
    expect(parses(upgraded)).toBe(true);
    expect(upgraded).toMatchObject({ mvpScope: [], exclusions: [] });
  });

  it('leaves v2 and INSUFFICIENT_DATA results unchanged', () => {
    expect(upgradeStoredAnalysis(analysed, 2)).toBe(analysed);
    expect(upgradeStoredAnalysis(insufficient, 1)).toBe(insufficient);
  });
});

const component = (key: string, points: number, max: number) => ({
  key,
  points,
  max,
  justification: 'DEMO',
});
const breakdown = {
  version: 1,
  total: 60,
  confidence: 'MEDIUM',
  components: [
    component('demand', 30, 30),
    component('skillFit', 10, 25),
    component('speed', 10, 20),
    component('profitability', 5, 15),
    component('repeatability', 5, 10),
  ],
};

describe('ScoreBreakdown', () => {
  it('accepts consistent components', () => {
    expect(ScoreBreakdown.safeParse(breakdown).success).toBe(true);
  });

  it('rejects a total that is not the sum', () => {
    expect(ScoreBreakdown.safeParse({ ...breakdown, total: 61 }).success).toBe(false);
  });

  it('rejects points above the maximum', () => {
    const over = {
      ...breakdown,
      total: 61,
      components: [component('demand', 31, 30), ...breakdown.components.slice(1)],
    };
    expect(ScoreBreakdown.safeParse(over).success).toBe(false);
  });

  it('rejects components out of order or with a wrong weight', () => {
    const [first, second, ...rest] = breakdown.components;
    expect(
      ScoreBreakdown.safeParse({ ...breakdown, components: [second, first, ...rest] }).success,
    ).toBe(false);
    expect(
      ScoreBreakdown.safeParse({
        ...breakdown,
        components: [component('demand', 30, 29), ...breakdown.components.slice(1)],
      }).success,
    ).toBe(false);
  });

  it('rejects fewer than five components and an empty justification', () => {
    expect(
      ScoreBreakdown.safeParse({ ...breakdown, components: breakdown.components.slice(1) }).success,
    ).toBe(false);
    expect(
      ScoreBreakdown.safeParse({
        ...breakdown,
        components: [
          { ...breakdown.components[0], justification: '' },
          ...breakdown.components.slice(1),
        ],
      }).success,
    ).toBe(false);
  });
});
