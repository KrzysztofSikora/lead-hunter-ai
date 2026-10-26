import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analysis } from '../../../test/helpers/analysis.js';
import { OpportunityAnalysis, type BountyFacts } from '@lead-hunter/contracts';
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

describe('guardAnalysis: bounty sources (S-19 D-10, FR-27 AC1)', () => {
  const reward = { amountMinor: 20_000, currency: 'USD', quote: '[$200]' } as const;
  const facts = (withReward: boolean): BountyFacts => ({
    platform: 'github',
    repository: 'demo/repo',
    issueNumber: 1,
    labels: ['bounty'],
    reward: withReward ? reward : null,
  });
  const origin = (withReward: boolean, sourceType: 'github' | 'opire' = 'github') => ({
    sourceType,
    bounty: facts(withReward),
  });
  const plain = 'DEMO [$200] Fix the parser\nThe parser throws on empty input.';
  const verdict = (guarded: ReturnType<typeof guardAnalysis>) => {
    if (guarded.result.verdict !== 'ANALYSED') throw new Error('expected an analysed result');
    return guarded.result;
  };

  it('turns the parsed reward into the budget when the model gave none', () => {
    const { result } = guardAnalysis(analysis({ sourceBudget: null }), plain, origin(true));
    expect(verdict({ result, notes: [] }).sourceBudget).toEqual({
      minMinor: 20_000,
      maxMinor: 20_000,
      currency: 'USD',
      quote: '[$200]',
    });
  });

  it('replaces a different budget of the model with the reward and says so', () => {
    const modelBudget = {
      minMinor: 90_000,
      maxMinor: 90_000,
      currency: 'USD',
      quote: '$900',
    } as const;
    const guarded = guardAnalysis(
      analysis({ sourceBudget: modelBudget }),
      `${plain}\nAlso $900 of credit.`,
      origin(true),
    );
    expect(verdict(guarded).sourceBudget?.maxMinor).toBe(20_000);
    expect(guarded.notes.join(' ')).toContain('zastąpiono');
  });

  it('removes a budget the model invented when the issue states no reward', () => {
    const text = 'DEMO Fix the parser\nWe have $500 of credit in the account.';
    const guarded = guardAnalysis(
      analysis({
        sourceBudget: { minMinor: 50_000, maxMinor: 50_000, currency: 'USD', quote: '$500' },
      }),
      text,
      origin(false),
    );
    expect(verdict(guarded).sourceBudget).toBeNull();
    expect(guarded.notes.join(' ')).toContain('nie podaje nagrody');
  });

  it('keeps DIRECT_REQUEST and the paid category when a reward is stated, with no cue in the text', () => {
    const { result } = guardAnalysis(analysis(), plain, origin(true, 'opire'));
    const kept = verdict({ result, notes: [] });
    expect([kept.evidenceLevel, kept.category]).toEqual(['DIRECT_REQUEST', 'DIRECT_GIG']);
  });

  it('downgrades both steps for a bounty without a reward or cue', () => {
    const guarded = guardAnalysis(analysis(), 'DEMO Fix the parser\nIt throws.', origin(false));
    const downgraded = verdict(guarded);
    expect([downgraded.evidenceLevel, downgraded.category]).toEqual([
      'EXPLICIT_PROBLEM',
      'UNMET_NEED',
    ]);
  });

  it('keeps DIRECT_REQUEST for a bounty without a reward when the text itself is a cue', () => {
    const guarded = guardAnalysis(
      analysis(),
      'DEMO Fix the parser\nThis is a paid task.',
      origin(false),
    );
    expect(verdict(guarded).evidenceLevel).toBe('DIRECT_REQUEST');
  });

  it('leaves other sources unchanged, even with facts attached', () => {
    const budget = { minMinor: 20_000, maxMinor: 20_000, currency: 'USD', quote: '$200' } as const;
    const text = 'Szukam kogoś, budżet $200 na poprawkę.';
    const withoutOrigin = guardAnalysis(analysis({ sourceBudget: budget }), text);
    const rss = guardAnalysis(analysis({ sourceBudget: budget }), text, {
      sourceType: 'rss',
      bounty: facts(false),
    });
    expect(rss).toEqual(withoutOrigin);
    expect(verdict(rss).sourceBudget).toEqual(budget);
  });
});
