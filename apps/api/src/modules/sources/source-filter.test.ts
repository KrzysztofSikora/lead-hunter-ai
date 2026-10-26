import { SourceFilter } from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import { PRESETS, WITHDRAWN_PRESETS } from './presets.js';
import { applySourceFilter, NO_FILTER, readFilter } from './source-filter.js';

describe('readFilter (S-17 D-1, D-18)', () => {
  it('reads NULL as off and empty', () => {
    expect(readFilter(null)).toEqual({ filter: NO_FILTER, invalid: false });
  });

  it('reads a valid value and keeps the phrases when it is off', () => {
    const stored = { enabled: false, include: ['react'], exclude: ['[FOR HIRE]'] };
    expect(readFilter(JSON.stringify(stored))).toEqual({ filter: stored, invalid: false });
  });

  it('reads invalid JSON and a value that fails the schema as off and empty, flagged', () => {
    expect(readFilter('{not json')).toEqual({ filter: NO_FILTER, invalid: true });
    expect(readFilter(JSON.stringify({ enabled: true, include: 'x', exclude: [] }))).toEqual({
      filter: NO_FILTER,
      invalid: true,
    });
    expect(readFilter(JSON.stringify({ enabled: true, include: ['a', 'A'], exclude: [] }))).toEqual(
      {
        filter: NO_FILTER,
        invalid: true,
      },
    );
  });
});

describe('presets (S-17 D-7, D-9, D-11)', () => {
  it.each([...PRESETS, ...WITHDRAWN_PRESETS])('$id has a valid filter', ({ filter }) => {
    expect(SourceFilter.safeParse(filter).success).toBe(true);
  });

  it('has unique ids and offers no job-board feed', () => {
    const ids = [...PRESETS, ...WITHDRAWN_PRESETS].map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PRESETS.map((preset) => preset.id)).toEqual([
      'hn-freelance',
      'freelancer-nodejs',
      'freelancer-react',
      'freelancer-typescript',
      'freelancer-arduino',
      'freelancer-raspberry-pi',
      'freelancer-iot',
      'freelancer-3d-printing',
      'freelancer-pcb-layout',
      'freelancer-ai-automation',
      'arduino-jobs',
      'github-bounties',
    ]);
  });
});

describe('applySourceFilter (S-17 D-3)', () => {
  const filter = (include: string[], exclude: string[]): SourceFilter => ({
    enabled: true,
    include,
    exclude,
  });
  const cases: [string, SourceFilter, string, string, boolean, string | null][] = [
    ['empty lists pass everything', filter([], []), 'a', 'b', true, null],
    [
      'case and whitespace do not matter',
      filter([], ['for  hire']),
      'x',
      'FOR\n\tHIRE now',
      false,
      'for  hire',
    ],
    [
      'a bracketed phrase matches',
      filter([], ['[FOR HIRE]']),
      '[for hire] dev',
      '',
      false,
      '[FOR HIRE]',
    ],
    ['title only', filter(['arduino'], []), 'Arduino hub', 'text', true, null],
    ['snippet only', filter(['arduino'], []), 'Hub', 'needs ARDUINO', true, null],
    ['diacritics are kept', filter(['łódź'], []), 'Praca w Lodz', '', false, null],
    ['include miss has no phrase', filter(['react'], []), 'Vue app', 'x', false, null],
    ['exclude beats include', filter(['arduino'], ['spam']), 'Arduino', 'spam', false, 'spam'],
    ['the first configured exclude wins', filter([], ['b', 'a']), 'a b', '', false, 'b'],
  ];
  it.each(cases)('%s', (_name, f, title, snippet, pass, phrase) => {
    expect(applySourceFilter(f, title, snippet)).toEqual(pass ? { pass } : { pass, phrase });
  });
});
