import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analysis } from '../../../test/helpers/analysis.js';
import { guardAnalysis } from './output-guard.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../../test/fixtures/llm/${name}`, import.meta.url), 'utf8');

const quoted = (quote: string) =>
  analysis({ sourceBudget: { minMinor: 800_000, maxMinor: 1_200_000, currency: 'PLN', quote } });

describe('guardAnalysis: source budget (TR-01)', () => {
  const text = fixture('synthetic-direct-pl.txt');

  it('keeps a budget whose quote is in the source, ignoring case and whitespace', () => {
    const { result, notes } = guardAnalysis(quoted('BUDŻET   8000-12000\nPLN'), text);
    expect(result.verdict === 'ANALYSED' && result.sourceBudget?.quote).toBe(
      'BUDŻET   8000-12000\nPLN',
    );
    expect(notes).toEqual([]);
  });

  it('drops a budget whose quote is absent and says so', () => {
    const { result, notes } = guardAnalysis(quoted('budżet 20000-30000 PLN'), text);
    expect(result.verdict === 'ANALYSED' && result.sourceBudget).toBeNull();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('budżet');
  });

  it('drops a budget when the quote occurs but does not state the amounts', () => {
    const { result, notes } = guardAnalysis(
      quoted('Budżet'),
      'Szukam kogoś do zlecenia. Budżet do ustalenia.',
    );
    expect(result.verdict === 'ANALYSED' && result.sourceBudget).toBeNull();
    expect(notes.join(' ')).toContain('kwot');
  });

  it('drops a quote cut from the middle of a number', () => {
    const base = analysis({
      sourceBudget: { minMinor: 50_000, maxMinor: 50_000, currency: 'PLN', quote: '500 zł' },
    });
    const { result, notes } = guardAnalysis(base, 'Szukam programisty. Budżet 1 500 zł za całość.');
    expect(result.verdict === 'ANALYSED' && result.sourceBudget).toBeNull();
    expect(notes.join(' ')).toContain('środku liczby');
  });

  it('keeps a quote that is a whole number in the source', () => {
    const base = analysis({
      sourceBudget: { minMinor: 150_000, maxMinor: 150_000, currency: 'PLN', quote: '1 500 zł' },
    });
    const { result } = guardAnalysis(base, 'Szukam programisty. Budżet 1 500 zł za całość.');
    expect(result.verdict === 'ANALYSED' && result.sourceBudget?.minMinor).toBe(150_000);
  });

  it('drops a budget whose currency differs from the quote', () => {
    const base = analysis({
      sourceBudget: {
        minMinor: 800_000,
        maxMinor: 1_200_000,
        currency: 'EUR',
        quote: 'budżet 8000-12000 PLN',
      },
    });
    const { result, notes } = guardAnalysis(base, 'Szukam kogoś. budżet 8000-12000 PLN, pilne.');
    expect(result.verdict === 'ANALYSED' && result.sourceBudget).toBeNull();
    expect(notes.join(' ')).toContain('waluta');
  });

  it('drops an empty quote and an empty source fact', () => {
    const base = quoted('');
    const withFact = { ...base, sourceFacts: ['  '] };
    const { result } = guardAnalysis(withFact, text);
    expect(result.verdict === 'ANALYSED' && result.sourceBudget).toBeNull();
    expect(result.sourceFacts).toEqual([]);
  });

  it('drops a budget whose quote was altered by one character', () => {
    const { result } = guardAnalysis(quoted('budżet 8000-12001 PLN'), text);
    expect(result.verdict === 'ANALYSED' && result.sourceBudget).toBeNull();
  });
});

describe('guardAnalysis: source facts', () => {
  const text = fixture('synthetic-direct-pl.txt');

  it('drops a source fact that is not verbatim in the text', () => {
    const { result, notes } = guardAnalysis(
      analysis({ sourceFacts: ['Praca zdalna', 'Klient to Firma XYZ'] }),
      text,
    );
    expect(result.sourceFacts).toEqual(['Praca zdalna']);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Firma XYZ');
  });

  it('also cleans the facts of an insufficient-data answer and leaves the rest alone', () => {
    const { result, notes } = guardAnalysis(
      {
        verdict: 'INSUFFICIENT_DATA',
        reason: 'DEMO',
        unknowns: ['budżet'],
        sourceFacts: ['wymyślone'],
      },
      text,
    );
    expect(result).toEqual({
      verdict: 'INSUFFICIENT_DATA',
      reason: 'DEMO',
      unknowns: ['budżet'],
      sourceFacts: [],
    });
    expect(notes).toHaveLength(1);
  });
});

describe('guardAnalysis: evidence and category (FR-10 AC3)', () => {
  it('downgrades a fake DIRECT_REQUEST / DIRECT_GIG on an OSS bug report', () => {
    const { result, notes } = guardAnalysis(
      analysis({ evidenceLevel: 'DIRECT_REQUEST', category: 'DIRECT_GIG' }),
      fixture('synthetic-oss-bug.txt'),
    );
    expect(result.verdict === 'ANALYSED' && [result.evidenceLevel, result.category]).toEqual([
      'EXPLICIT_PROBLEM',
      'UNMET_NEED',
    ]);
    expect(notes).toHaveLength(2);
  });

  it('downgrades the category on its own, whatever the evidence level (plan-review #5)', () => {
    const { result, notes } = guardAnalysis(
      analysis({ evidenceLevel: 'EXPLICIT_PROBLEM', category: 'DIRECT_GIG' }),
      fixture('synthetic-oss-bug.txt'),
    );
    expect(result.verdict === 'ANALYSED' && [result.evidenceLevel, result.category]).toEqual([
      'EXPLICIT_PROBLEM',
      'UNMET_NEED',
    ]);
    expect(notes).toHaveLength(1);
  });

  it('turns B2B_SUBCONTRACT without a hiring cue into UNMET_NEED too', () => {
    const { result } = guardAnalysis(
      analysis({ evidenceLevel: 'INDIRECT_SIGNAL', category: 'B2B_SUBCONTRACT' }),
      fixture('synthetic-oss-bug.txt'),
    );
    expect(result.verdict === 'ANALYSED' && result.category).toBe('UNMET_NEED');
  });

  it.each([
    ['Polish', 'synthetic-direct-pl.txt'],
    ['English', 'synthetic-seeking-freelancer.txt'],
  ])('keeps DIRECT_REQUEST / DIRECT_GIG on a %s hiring post', (_name, file) => {
    const { result, notes } = guardAnalysis(
      analysis({ evidenceLevel: 'DIRECT_REQUEST', category: 'DIRECT_GIG' }),
      fixture(file),
    );
    expect(result.verdict === 'ANALYSED' && [result.evidenceLevel, result.category]).toEqual([
      'DIRECT_REQUEST',
      'DIRECT_GIG',
    ]);
    expect(notes).toEqual([]);
  });

  it('leaves non-paid categories and weaker evidence untouched', () => {
    const { result, notes } = guardAnalysis(
      analysis({ evidenceLevel: 'SPECULATIVE', category: 'PRODUCT_HYPOTHESIS' }),
      fixture('synthetic-oss-bug.txt'),
    );
    expect(result.verdict === 'ANALYSED' && [result.evidenceLevel, result.category]).toEqual([
      'SPECULATIVE',
      'PRODUCT_HYPOTHESIS',
    ]);
    expect(notes).toEqual([]);
  });
});
