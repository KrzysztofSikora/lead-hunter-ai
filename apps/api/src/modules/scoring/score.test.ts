import {
  Category,
  EvidenceLevel,
  MonetizationModel,
  ScoreBreakdown,
  type Confidence,
} from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import { analysis, profile } from '../../../test/helpers/analysis.js';
import { confidenceFor, scoreAnalysis } from './score.js';

const p = profile({ skills: ['TypeScript'], rateRanges: [] });
const unknowns = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);

describe('scoreAnalysis', () => {
  it('sums the five components into the total (FR-10 AC1)', () => {
    const result = scoreAnalysis(
      analysis({
        evidenceLevel: 'DIRECT_REQUEST',
        buyerConfirmed: true,
        relevantSkills: ['TypeScript'],
        estimatedHours: { min: 5, max: 30 },
        monetizationModel: 'SUBSCRIPTION',
      }),
      p,
    );
    // demand 30 + skillFit 10 + speed 12+8 + profitability 5 + repeatability 4+2
    expect(result.components.map((c) => c.points)).toEqual([30, 10, 20, 5, 6]);
    expect(result.total).toBe(71);
  });

  it('is 0 to 100 and consistent for every category, level, model and hours band (property)', () => {
    const bands = [
      null,
      { min: 1, max: 40 },
      { min: 1, max: 120 },
      { min: 1, max: 400 },
      { min: 1, max: 401 },
    ];
    for (const category of Category.options)
      for (const evidenceLevel of EvidenceLevel.options)
        for (const monetizationModel of MonetizationModel.options)
          for (const estimatedHours of bands)
            for (const buyerConfirmed of [true, false]) {
              const breakdown = scoreAnalysis(
                analysis({
                  category,
                  evidenceLevel,
                  monetizationModel,
                  estimatedHours,
                  buyerConfirmed,
                  relevantSkills: ['TypeScript'],
                }),
                p,
              );
              expect(ScoreBreakdown.safeParse(breakdown).success).toBe(true);
              expect(breakdown.total).toBe(breakdown.components.reduce((s, c) => s + c.points, 0));
              for (const c of breakdown.components) {
                expect(c.points).toBeLessThanOrEqual(c.max);
                expect(c.justification.length).toBeGreaterThan(0);
              }
            }
  });

  it('gives the same result for the same input (FR-10 AC5) and has no probability field', () => {
    const input = analysis({ relevantSkills: ['TypeScript'], estimatedHours: { min: 1, max: 50 } });
    const first = scoreAnalysis(input, p);
    expect(scoreAnalysis(structuredClone(input), structuredClone(p))).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/probab/i);
  });

  it('stores the confidence next to, not inside, the total', () => {
    const result = scoreAnalysis(analysis({ evidenceLevel: 'SPECULATIVE' }), p);
    expect(result.confidence).toBe('LOW');
    expect(result.components.every((c) => !('confidence' in c))).toBe(true);
  });
});

describe('confidenceFor (D-3)', () => {
  it.each<[string, Parameters<typeof analysis>[0], Confidence]>([
    ['direct request, buyer confirmed, no unknowns', { buyerConfirmed: true }, 'HIGH'],
    [
      'explicit problem, buyer confirmed, 2 unknowns',
      { evidenceLevel: 'EXPLICIT_PROBLEM', buyerConfirmed: true, unknowns: unknowns(2) },
      'HIGH',
    ],
    [
      'public tender, buyer confirmed',
      { evidenceLevel: 'PUBLIC_TENDER', buyerConfirmed: true },
      'HIGH',
    ],
    ['public tender, buyer not confirmed', { evidenceLevel: 'PUBLIC_TENDER' }, 'MEDIUM'],
    ['3 unknowns', { buyerConfirmed: true, unknowns: unknowns(3) }, 'MEDIUM'],
    ['buyer not confirmed', { buyerConfirmed: false }, 'MEDIUM'],
    ['indirect signal', { evidenceLevel: 'INDIRECT_SIGNAL', buyerConfirmed: true }, 'MEDIUM'],
    ['4 unknowns', { buyerConfirmed: true, unknowns: unknowns(4) }, 'MEDIUM'],
    ['5 unknowns', { buyerConfirmed: true, unknowns: unknowns(5) }, 'LOW'],
    ['speculative', { evidenceLevel: 'SPECULATIVE', buyerConfirmed: true }, 'LOW'],
  ])('%s → %s', (_name, overrides, expected) => {
    expect(confidenceFor(analysis(overrides))).toBe(expected);
  });
});
