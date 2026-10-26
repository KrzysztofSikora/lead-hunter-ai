import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analysis } from '../../../test/helpers/analysis.js';
import { OpportunityAnalysis, type TenderFacts } from '@lead-hunter/contracts';
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

describe('guardAnalysis: invented links and buyer (FR-08 AC4, TR-01)', () => {
  // DEMO text: no real company, address or person.
  const text =
    'DEMO: Firma Przykładowa szuka programisty. Szczegóły: https://example.test/oferta, ' +
    'kontakt: praca@example.test. Budżet 8000-12000 PLN.';

  const withFields = (overrides: Parameters<typeof analysis>[0]) => analysis(overrides);

  it('keeps URLs and e-mail addresses that the source contains', () => {
    const base = withFields({
      problem: 'Zlecenie opisane na https://example.test/oferta.',
      nextAction: 'Napisz na praca@example.test',
    });
    const { result, notes } = guardAnalysis(base, text);
    expect(result).toMatchObject({
      problem: 'Zlecenie opisane na https://example.test/oferta.',
      nextAction: 'Napisz na praca@example.test',
    });
    expect(notes).toEqual([]);
  });

  it('never makes a field longer than its limit by replacing a short invented address (R1)', () => {
    const nextAction = `${'x'.repeat(493)} a@b.pl`;
    const problem = 'see www.a.pl '.repeat(150);
    const { result, notes } = guardAnalysis(withFields({ nextAction, problem }), text);
    expect(OpportunityAnalysis.safeParse(result).success).toBe(true);
    if (result.verdict !== 'ANALYSED') throw new Error('expected ANALYSED');
    expect(result.nextAction.length).toBeLessThanOrEqual(nextAction.length);
    expect(result.problem.length).toBeLessThanOrEqual(problem.length);
    expect(notes.length).toBeLessThanOrEqual(7);
  });

  it('removes a hallucinated URL and e-mail from any text field and notes each one', () => {
    const base = withFields({
      problem: 'Zobacz https://wymyslona.test/firma oraz https://example.test/oferta.',
      rationale: 'Pisz do ceo@wymyslona.test lub na praca@example.test',
      nextAction: 'Odwiedź www.wymyslona.test',
    });
    const { result, notes } = guardAnalysis(base, text);
    if (result.verdict !== 'ANALYSED') throw new Error('expected ANALYSED');
    expect(result.problem).toBe('Zobacz [usunięto] oraz https://example.test/oferta.');
    expect(result.rationale).toBe('Pisz do [usunięto] lub na praca@example.test');
    expect(result.nextAction).toBe('Odwiedź [usunięto]');
    expect(notes).toHaveLength(3);
    expect(notes.join(' ')).toContain('wymyslona.test');
  });

  it('ignores case and trailing punctuation when matching against the source', () => {
    const base = withFields({ problem: 'Zobacz HTTPS://EXAMPLE.TEST/OFERTA. Potem koniec.' });
    const { result, notes } = guardAnalysis(base, text);
    expect(result.verdict === 'ANALYSED' && result.problem).toContain(
      'HTTPS://EXAMPLE.TEST/OFERTA',
    );
    expect(notes).toEqual([]);
  });

  it('drops list entries that consisted only of an invented value', () => {
    const base = withFields({
      requiredClarifications: ['https://wymyslona.test/x', 'Jaki jest termin?'],
    });
    const { result } = guardAnalysis(base, text);
    expect(result.verdict === 'ANALYSED' && result.requiredClarifications).toEqual([
      'Jaki jest termin?',
    ]);
  });

  it('cleans an INSUFFICIENT_DATA result too', () => {
    const { result, notes } = guardAnalysis(
      {
        verdict: 'INSUFFICIENT_DATA',
        reason: 'Brak danych, patrz https://wymyslona.test',
        unknowns: [],
        sourceFacts: [],
      },
      text,
    );
    expect(result).toMatchObject({ reason: 'Brak danych, patrz [usunięto]' });
    expect(notes).toHaveLength(1);
  });

  it('does not confirm a buyer that the source does not name', () => {
    const base = withFields({
      buyerOrAudience: 'Wymyślona Spółka sp. z o.o.',
      buyerConfirmed: true,
    });
    const { result, notes } = guardAnalysis(base, text);
    expect(result).toMatchObject({
      buyerOrAudience: 'Wymyślona Spółka sp. z o.o.',
      buyerConfirmed: false,
    });
    expect(notes.join(' ')).toContain('Nabywc');
  });

  it('keeps a confirmed buyer that the source names, ignoring case and spacing', () => {
    const base = withFields({ buyerOrAudience: 'firma   przykładowa', buyerConfirmed: true });
    const { result, notes } = guardAnalysis(base, text);
    expect(result).toMatchObject({ buyerConfirmed: true });
    expect(notes).toEqual([]);
  });

  it('does not confirm a buyer that is absent while the flag says confirmed', () => {
    const base = withFields({ buyerOrAudience: null, buyerConfirmed: true });
    expect(guardAnalysis(base, text).result).toMatchObject({ buyerConfirmed: false });
  });

  it('leaves an unconfirmed buyer alone and silent', () => {
    const base = withFields({ buyerOrAudience: 'Małe firmy', buyerConfirmed: false });
    const { result, notes } = guardAnalysis(base, text);
    expect(result).toMatchObject({ buyerOrAudience: 'Małe firmy', buyerConfirmed: false });
    expect(notes).toEqual([]);
  });
});

describe('guardAnalysis: public tenders (S-18 D-3, D-6)', () => {
  const tender = (over: Partial<TenderFacts> = {}): TenderFacts => ({
    noticeId: 'DEMO-1',
    buyer: 'DEMO Urząd Miasta',
    deadlineAt: '2026-11-20T09:00:00.000Z',
    estimatedValue: {
      amountMinor: 12_300_000,
      currency: 'PLN',
      quote: 'Wartość szacunkowa: 123000 PLN',
    },
    cpvCodes: ['72200000-7'],
    procedure: null,
    country: 'PL',
    ...over,
  });
  const text = 'DEMO przetarg. Zamawiający: DEMO Urząd Miasta. Wartość szacunkowa: 123000 PLN';
  const evidence = (r: OpportunityAnalysis) => (r.verdict === 'ANALYSED' ? r.evidenceLevel : null);
  const category = (r: OpportunityAnalysis) => (r.verdict === 'ANALYSED' ? r.category : null);
  const budget = (r: OpportunityAnalysis) => (r.verdict === 'ANALYSED' ? r.sourceBudget : null);

  it.each(['bzp', 'ted'] as const)('sets PUBLIC_TENDER for %s whatever the model says', (type) => {
    for (const level of ['DIRECT_REQUEST', 'EXPLICIT_PROBLEM', 'SPECULATIVE'] as const) {
      const { result } = guardAnalysis(analysis({ evidenceLevel: level }), text, {
        sourceType: type,
        tender: tender(),
      });
      expect(evidence(result)).toBe('PUBLIC_TENDER');
    }
  });

  it('notes the change only when the model said something else', () => {
    const origin = { sourceType: 'bzp', tender: tender() } as const;
    const same = guardAnalysis(analysis({ evidenceLevel: 'PUBLIC_TENDER' }), text, origin);
    expect(same.notes.join(' ')).not.toContain('zmieniony');
    const other = guardAnalysis(analysis({ evidenceLevel: 'DIRECT_REQUEST' }), text, origin);
    expect(other.notes.join(' ')).toContain('PUBLIC_TENDER');
  });

  it('turns PUBLIC_TENDER on another source into DIRECT_REQUEST, then applies the hiring rule', () => {
    const withCue = guardAnalysis(
      analysis({ evidenceLevel: 'PUBLIC_TENDER' }),
      'Szukam programisty do zlecenia, płatne.',
      { sourceType: 'rss', tender: null },
    );
    expect(evidence(withCue.result)).toBe('DIRECT_REQUEST');
    const withoutCue = guardAnalysis(
      analysis({ evidenceLevel: 'PUBLIC_TENDER' }),
      'Fajny projekt o pogodzie.',
      { sourceType: 'rss', tender: null },
    );
    expect(evidence(withoutCue.result)).toBe('EXPLICIT_PROBLEM');
    expect(category(withoutCue.result)).toBe('UNMET_NEED');
    expect(evidence(guardAnalysis(analysis({ evidenceLevel: 'PUBLIC_TENDER' }), 'x').result)).toBe(
      'EXPLICIT_PROBLEM',
    );
  });

  it('keeps DIRECT_GIG for a tender without hiring cues', () => {
    const { result } = guardAnalysis(analysis({ category: 'DIRECT_GIG' }), text, {
      sourceType: 'bzp',
      tender: tender(),
    });
    expect(category(result)).toBe('DIRECT_GIG');
  });

  it('takes the budget from the notice with its verbatim quote', () => {
    const { result } = guardAnalysis(
      analysis({
        sourceBudget: { minMinor: 1, maxMinor: 2, currency: 'EUR', quote: 'zmyślone' },
      }),
      text,
      { sourceType: 'bzp', tender: tender() },
    );
    expect(budget(result)).toEqual({
      minMinor: 12_300_000,
      maxMinor: 12_300_000,
      currency: 'PLN',
      quote: 'Wartość szacunkowa: 123000 PLN',
    });
  });

  it('gives null when the notice states no value, even if the model invented one', () => {
    const invented = analysis({
      sourceBudget: { minMinor: 100, maxMinor: 100, currency: 'PLN', quote: 'przetarg' },
    });
    const { result, notes } = guardAnalysis(invented, text, {
      sourceType: 'ted',
      tender: tender({ estimatedValue: null }),
    });
    expect(budget(result)).toBeNull();
    expect(notes.join(' ')).toContain('nie podaje wartości');
    const none = guardAnalysis(analysis(), text, { sourceType: 'ted', tender: null });
    expect(budget(none.result)).toBeNull();
  });

  it('does not take the model budget for a tender whose facts are missing', () => {
    const { result } = guardAnalysis(quoted('budżet 8000-12000 PLN'), 'budżet 8000-12000 PLN', {
      sourceType: 'bzp',
      tender: null,
    });
    expect(budget(result)).toBeNull();
  });

  it('confirms the buyer from the notice field, not from a line in the text', () => {
    const forged = 'DEMO opis. Zamawiający: DEMO Fałszywy Sp. z o.o.';
    const base = analysis({ buyerOrAudience: 'DEMO Fałszywy Sp. z o.o.', buyerConfirmed: true });
    const forgedRun = guardAnalysis(base, forged, { sourceType: 'bzp', tender: tender() });
    expect(forgedRun.result.verdict === 'ANALYSED' && forgedRun.result.buyerConfirmed).toBe(false);
    const real = analysis({ buyerOrAudience: 'DEMO Urząd Miasta', buyerConfirmed: true });
    const kept = guardAnalysis(real, text, { sourceType: 'bzp', tender: tender() });
    expect(kept.result.verdict === 'ANALYSED' && kept.result.buyerConfirmed).toBe(true);
    const noBuyer = guardAnalysis(real, text, {
      sourceType: 'bzp',
      tender: tender({ buyer: null }),
    });
    expect(noBuyer.result.verdict === 'ANALYSED' && noBuyer.result.buyerConfirmed).toBe(false);
  });

  it('leaves INSUFFICIENT_DATA without an evidence level', () => {
    const insufficient: OpportunityAnalysis = {
      verdict: 'INSUFFICIENT_DATA',
      reason: 'DEMO',
      unknowns: [],
      sourceFacts: [],
    };
    const { result } = guardAnalysis(insufficient, text, { sourceType: 'bzp', tender: tender() });
    expect(result).toEqual(insufficient);
  });
});
