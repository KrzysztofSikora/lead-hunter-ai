import type { AnalysedResult, Category, EvidenceLevel } from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import { analysis, profile } from '../../../test/helpers/analysis.js';
import { demand, profitability, repeatability, skillFit, speed } from './rubric.js';

const hours = (max: number) => ({ min: 1, max });
const budget = (minMinor: number, maxMinor: number, currency: 'PLN' | 'EUR' = 'PLN') => ({
  minMinor,
  maxMinor,
  currency,
  quote: 'DEMO',
});
const hourly = (minMinor: number, currency: 'PLN' | 'EUR' = 'PLN') => ({
  unit: 'HOUR' as const,
  currency,
  minMinor,
  maxMinor: minMinor * 2,
});

describe('demand (FR-10 AC2 caps)', () => {
  it.each<[EvidenceLevel, boolean, number]>([
    ['DIRECT_REQUEST', true, 30],
    ['DIRECT_REQUEST', false, 22],
    ['EXPLICIT_PROBLEM', true, 18],
    ['EXPLICIT_PROBLEM', false, 12],
    ['INDIRECT_SIGNAL', true, 10],
    ['INDIRECT_SIGNAL', false, 6],
    ['SPECULATIVE', true, 6],
    ['SPECULATIVE', false, 3],
  ])('%s, buyer confirmed %s → %i', (evidenceLevel, buyerConfirmed, points) => {
    expect(demand(analysis({ evidenceLevel, buyerConfirmed }))).toMatchObject({ points, max: 30 });
  });
});

describe('skillFit', () => {
  const p = profile({
    skills: ['TypeScript', 'Node.js'],
    preferredTechnologies: ['React', 'LoRa'],
    excludedTechnologies: ['PHP'],
  });
  it.each<[string[], number]>([
    [[], 0],
    [['Rust'], 0],
    [['typescript'], 10],
    [['typescript', 'NODE.JS'], 16],
    [['TypeScript', 'Node.js', 'react'], 21],
    [['TypeScript', 'Node.js', 'React', 'LoRa'], 25],
    [['TypeScript', 'Node.js', 'React', 'LoRa', 'Rust'], 25],
    [['TypeScript', 'typescript'], 10],
  ])('relevant %j → %i', (relevantSkills, points) => {
    expect(skillFit(analysis({ relevantSkills }), p)).toMatchObject({ points, max: 25 });
  });

  it('is 0 when an excluded technology is named, whatever else matches', () => {
    const result = skillFit(
      analysis({ relevantSkills: ['TypeScript', 'Node.js', 'React', ' php '] }),
      p,
    );
    expect(result.points).toBe(0);
    expect(result.justification).toContain('wykluczonej');
  });
});

describe('speed', () => {
  it.each<[Category, number]>([
    ['DIRECT_GIG', 12],
    ['B2B_SUBCONTRACT', 10],
    ['HARDWARE_IOT', 6],
    ['UNMET_NEED', 4],
    ['PRODUCT_HYPOTHESIS', 2],
  ])('category %s with unknown hours → base %i + 3', (category, base) => {
    expect(speed(analysis({ category })).points).toBe(base + 3);
  });

  it.each<[number, number]>([
    [1, 8],
    [40, 8],
    [41, 5],
    [120, 5],
    [121, 2],
    [400, 2],
    [401, 0],
    [10_000, 0],
  ])('hours.max %i → band %i', (max, band) => {
    expect(speed(analysis({ category: 'UNMET_NEED', estimatedHours: hours(max) })).points).toBe(
      4 + band,
    );
  });

  it('never exceeds its maximum', () => {
    expect(speed(analysis({ category: 'DIRECT_GIG', estimatedHours: hours(10) })).points).toBe(20);
  });
});

describe('profitability', () => {
  const rate = profile({ rateRanges: [hourly(10_000)] }); // 100.00 PLN per hour
  const withHours = (b: ReturnType<typeof budget>) =>
    analysis({ sourceBudget: b, estimatedHours: { min: 10, max: 10 } });

  it.each<[string, number, number]>([
    ['above the minimum rate', 100_000, 15],
    ['exactly the minimum rate', 100_000, 15],
    ['just below the minimum rate', 99_998, 10],
    ['exactly 75 %', 75_000, 10],
    ['just below 75 %', 74_998, 5],
    ['exactly 50 %', 50_000, 5],
    ['just below 50 %', 49_998, 0],
    ['zero', 0, 0],
  ])('%s (budget %i) → %i', (_name, total, points) => {
    expect(profitability(withHours(budget(total, total)), rate).points).toBe(points);
  });

  it('uses the midpoint of the budget range', () => {
    expect(profitability(withHours(budget(50_000, 150_000)), rate).points).toBe(15);
  });

  it('is 0 below the minimum job value of the same currency', () => {
    const p = profile({
      rateRanges: [hourly(10_000)],
      minimumJobValue: { amountMinor: 200_000, currency: 'PLN' },
    });
    expect(profitability(withHours(budget(100_000, 199_999)), p).points).toBe(0);
    expect(profitability(withHours(budget(100_000, 200_000)), p).points).toBe(15);
  });

  it('ignores the minimum job value in another currency', () => {
    const p = profile({
      rateRanges: [hourly(10_000)],
      minimumJobValue: { amountMinor: 200_000, currency: 'EUR' },
    });
    expect(profitability(withHours(budget(100_000, 100_000)), p).points).toBe(15);
  });

  it.each<[string, AnalysedResult, number]>([
    ['no budget', analysis({ estimatedHours: hours(10) }), 5],
    [
      'only a proposed price, even a generous one',
      analysis({
        estimatedHours: hours(10),
        proposedPrice: { minMinor: 9_000_000, maxMinor: 9_000_000, currency: 'PLN' },
      }),
      5,
    ],
    ['no hours', analysis({ sourceBudget: budget(1, 1) }), 5],
  ])('%s → neutral 5', (_name, result, points) => {
    const outcome = profitability(result, rate);
    expect(outcome.points).toBe(points);
    expect(outcome.justification).toContain('Brak danych');
  });

  it('is neutral without an hourly rate in the budget currency', () => {
    expect(profitability(withHours(budget(1, 1, 'EUR')), rate).points).toBe(5);
    expect(profitability(withHours(budget(1, 1)), profile({ rateRanges: [] })).points).toBe(5);
  });
});

describe('repeatability', () => {
  it.each<[Category, number]>([
    ['PRODUCT_HYPOTHESIS', 8],
    ['UNMET_NEED', 7],
    ['B2B_SUBCONTRACT', 6],
    ['HARDWARE_IOT', 5],
    ['DIRECT_GIG', 4],
  ])('%s → %i, +2 for a recurring model, capped at 10', (category, base) => {
    expect(repeatability(analysis({ category })).points).toBe(base);
    expect(repeatability(analysis({ category, monetizationModel: 'SUBSCRIPTION' })).points).toBe(
      Math.min(base + 2, 10),
    );
    expect(repeatability(analysis({ category, monetizationModel: 'PRODUCT_SALE' })).points).toBe(
      Math.min(base + 2, 10),
    );
    expect(repeatability(analysis({ category, monetizationModel: 'HOURLY_B2B' })).points).toBe(
      base,
    );
  });
});
