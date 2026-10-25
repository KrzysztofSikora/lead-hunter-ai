import { describe, expect, it } from 'vitest';
import { budgetGate, costMicroUsd } from './budget.js';

const HAIKU = { inputMicroUsdPerMTok: 100_000, outputMicroUsdPerMTok: 500_000 };

describe('costMicroUsd (FR-09 AC4)', () => {
  it('multiplies tokens by the price per million tokens', () => {
    expect(costMicroUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, HAIKU)).toBe(600_000);
  });

  it('rounds a fraction of a micro-USD up', () => {
    expect(costMicroUsd({ inputTokens: 1, outputTokens: 0 }, HAIKU)).toBe(1);
    expect(costMicroUsd({ inputTokens: 5, outputTokens: 1 }, HAIKU)).toBe(1);
    expect(costMicroUsd({ inputTokens: 10, outputTokens: 0 }, HAIKU)).toBe(1);
    expect(costMicroUsd({ inputTokens: 11, outputTokens: 0 }, HAIKU)).toBe(2);
  });

  it('is zero for zero tokens, not unknown', () => {
    expect(costMicroUsd({ inputTokens: 0, outputTokens: 0 }, HAIKU)).toBe(0);
  });

  it.each([
    ['no usage', null, HAIKU],
    ['no price', { inputTokens: 10, outputTokens: 10 }, null],
    ['missing input tokens', { inputTokens: null, outputTokens: 10 }, HAIKU],
    ['missing output tokens', { inputTokens: 10, outputTokens: null }, HAIKU],
  ])('is null with %s', (_name, usage, price) => {
    expect(costMicroUsd(usage, price)).toBeNull();
  });
});

describe('budgetGate (FR-09 AC1, AC2)', () => {
  const base = { paid: true, capMicroUsd: 5_000_000, price: HAIKU, spentMicroUsd: 0 };

  it('lets a paid provider with cap, price and room run', () => {
    expect(budgetGate(base)).toBeNull();
    expect(budgetGate({ ...base, spentMicroUsd: 4_999_999 })).toBeNull();
  });

  it('blocks a paid provider without a cap', () => {
    expect(budgetGate({ ...base, capMicroUsd: null })).toBe('budget_missing');
  });

  it('blocks a paid provider whose model has no price', () => {
    expect(budgetGate({ ...base, price: null })).toBe('price_unknown');
  });

  it('blocks once spending reaches the cap, exactly at the cap too', () => {
    expect(budgetGate({ ...base, spentMicroUsd: 5_000_000 })).toBe('budget_reached');
    expect(budgetGate({ ...base, spentMicroUsd: 9_000_000 })).toBe('budget_reached');
  });

  it('reports the missing cap before the missing price', () => {
    expect(budgetGate({ ...base, capMicroUsd: null, price: null })).toBe('budget_missing');
  });

  it('never blocks a free provider, with or without cap and price', () => {
    expect(
      budgetGate({ paid: false, capMicroUsd: null, price: null, spentMicroUsd: 0 }),
    ).toBeNull();
    expect(budgetGate({ paid: false, capMicroUsd: 1, price: HAIKU, spentMicroUsd: 99 })).toBeNull();
  });
});
