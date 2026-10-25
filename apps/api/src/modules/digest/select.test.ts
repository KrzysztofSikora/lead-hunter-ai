import { describe, expect, it } from 'vitest';
import type { DigestCandidateRow } from './ports.js';
import { nearDuplicate, pickTop, pickWeak, tokens } from './select.js';

let next = 1;
const row = (overrides: Partial<DigestCandidateRow> = {}): DigestCandidateRow => ({
  id: next++,
  title: `DEMO unikalny tytuł numer ${next}`,
  category: 'DIRECT_GIG',
  evidenceLevel: 'DIRECT_REQUEST',
  score: 80,
  businessStatus: 'NEW',
  createdAt: 1_000,
  provider: 'mock',
  buyer: null,
  nextAction: null,
  ...overrides,
});

describe('tokens', () => {
  it('folds case and diacritics and drops short tokens', () => {
    expect([...tokens('Zbudować SKLEP żółty, do 5 PLN!')].sort()).toEqual([
      'pln',
      'sklep',
      'zbudowac',
      'zolty',
    ]);
  });
});

describe('nearDuplicate', () => {
  it('is true for a reworded repost and false for a different job', () => {
    const a = row({ title: 'Szukam programisty do sklepu internetowego Shopify' });
    expect(
      nearDuplicate(a, row({ title: 'Szukam programisty do sklepu internetowego Shopify!!' })),
    ).toBe(true);
    expect(nearDuplicate(a, row({ title: 'Potrzebny grafik do logo restauracji' }))).toBe(false);
  });
});

describe('pickTop', () => {
  it('puts direct requests first even against a higher scored problem', () => {
    const problem = row({ evidenceLevel: 'EXPLICIT_PROBLEM', score: 95, title: 'alfa bravo' });
    const direct = row({ score: 66, title: 'charlie delta' });
    expect(pickTop([problem, direct], 65).map((r) => r.id)).toEqual([direct.id, problem.id]);
  });

  it('keeps weak rows and rows under the threshold out', () => {
    const rows = [
      row({ category: 'PRODUCT_HYPOTHESIS', score: 99, title: 'echo foxtrot' }),
      row({ evidenceLevel: 'SPECULATIVE', score: 99, title: 'golf hotel' }),
      row({ score: 64, title: 'india juliet' }),
    ];
    expect(pickTop(rows, 65)).toEqual([]);
    expect(pickWeak(rows)).toHaveLength(2);
  });

  it('never picks more than 5', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row({ title: `${'abcdefgh'[i]}${'xyz'.repeat(3)} unikat${i}${i}${i}` }),
    );
    expect(pickTop(rows, 0)).toHaveLength(5);
  });

  it('allows a group of two near-duplicates, also along an A~B~C chain', () => {
    const a = row({ title: 'one two three four five six', score: 90 });
    const b = row({ title: 'one two three four five seven', score: 89 });
    const c = row({ title: 'one two three four eight seven', score: 88 });
    expect(nearDuplicate(a, b)).toBe(true);
    expect(nearDuplicate(b, c)).toBe(true);
    expect(nearDuplicate(a, c)).toBe(false);
    expect(pickTop([a, b, c], 0).map((r) => r.id)).toEqual([a.id, b.id]);
  });
});
