import { describe, expect, it } from 'vitest';
import {
  buildTenderText,
  findEstimatedValue,
  formatWarsaw,
  htmlToText,
  parseAmountMinor,
  parseNoticeDate,
  valueLine,
} from './tender-text.js';

describe('htmlToText (S-18 D-20)', () => {
  it('strips tags, scripts and styles, decodes entities and keeps block breaks', () => {
    const text = htmlToText(
      '<style>p{}</style><p>Jeden &amp; dwa</p><script>x()</script><div>Trzy&nbsp;cztery &#65; &#x42;</div>',
    );
    expect(text).toBe('Jeden & dwa\n\nTrzy cztery A B');
  });

  it('survives an unterminated tag and an unknown entity', () => {
    expect(htmlToText('a &nope; b <p')).toBe('a b');
  });

  it('finishes a body of the maximum size and deep nesting within a time budget', () => {
    const started = performance.now();
    const nested = 'tekst &amp; '.repeat(10_000) + '<div>'.repeat(40_000);
    const text = htmlToText(nested + '<'.repeat(100_000));
    expect(text.length).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('estimated value (S-18 D-20)', () => {
  it.each([
    ['123 456,78', 12_345_678],
    ['1234567.89', 123_456_789],
    ['1.234.567,89', 123_456_789],
    ['5 000 000', 500_000_000],
    ['100,5', 10_050],
  ])('reads %s as integer minor units', (raw, minor) => {
    expect(parseAmountMinor(raw)).toBe(minor);
  });

  it('reads a labelled amount with a known currency and nothing else', () => {
    expect(findEstimatedValue('Wartość zamówienia: 123 456,78 PLN')).toEqual({
      amountMinor: 12_345_678,
      currency: 'PLN',
    });
    expect(findEstimatedValue('Szacunkowa wartość zamówienia 2 000 000 zł')).toEqual({
      amountMinor: 200_000_000,
      currency: 'PLN',
    });
    expect(findEstimatedValue('Wartość zamówienia: 10 000 EUR')?.currency).toBe('EUR');
    expect(findEstimatedValue('Cena oferty 100 PLN')).toBeNull();
    expect(findEstimatedValue('Wartość zamówienia: nie podano')).toBeNull();
    expect(findEstimatedValue('Wartość zamówienia: 10 000 CHF')).toBeNull();
    // R2: threshold phrases with the same words are not a stated value.
    expect(
      findEstimatedValue('Wartość zamówienia nie przekracza kwoty 130 000 zł netto.'),
    ).toBeNull();
    expect(
      findEstimatedValue('Szacunkowa wartość zamówienia jest mniejsza niż 5 538 000 euro.'),
    ).toBeNull();
    expect(findEstimatedValue('Wartość zamówienia (netto): 10 000 PLN')?.amountMinor).toBe(
      1_000_000,
    );
  });

  it('formats the line the guard takes the budget quote from', () => {
    expect(valueLine({ amountMinor: 12_345_678, currency: 'PLN' })).toBe(
      'Wartość szacunkowa: 123456.78 PLN',
    );
    expect(valueLine({ amountMinor: 500, currency: 'EUR' })).toBe('Wartość szacunkowa: 5.00 EUR');
  });
});

describe('notice dates (S-18 lesson: bound source dates)', () => {
  it('keeps a zoned instant and reads a zone-less one as Warsaw time', () => {
    expect(parseNoticeDate('2026-11-20T09:00:00Z')).toBe(Date.parse('2026-11-20T09:00:00Z'));
    expect(parseNoticeDate('2026-11-20T10:00:00')).toBe(Date.parse('2026-11-20T09:00:00Z'));
    expect(parseNoticeDate('2026-07-20 10:00:00')).toBe(Date.parse('2026-07-20T08:00:00Z'));
    expect(parseNoticeDate('2026-11-20')).toBe(Date.parse('2026-11-19T23:00:00Z'));
  });

  it('rejects dates outside 2000..2100, text that is not a date and non-strings', () => {
    expect(parseNoticeDate('1999-12-31T00:00:00Z')).toBeNull();
    expect(parseNoticeDate('2126-01-01T00:00:00Z')).toBeNull();
    expect(parseNoticeDate('jutro')).toBeNull();
    expect(parseNoticeDate(20261120)).toBeNull();
  });

  it('formats Warsaw time with the winter and summer offset', () => {
    expect(formatWarsaw(Date.parse('2026-11-20T09:00:00Z'))).toBe('2026-11-20 10:00');
    expect(formatWarsaw(Date.parse('2026-07-20T08:00:00Z'))).toBe('2026-07-20 10:00');
  });
});

describe('buildTenderText (S-18 D-5)', () => {
  const parts = {
    title: 'DEMO Tytuł',
    buyer: 'DEMO Gmina',
    deadlineAt: Date.parse('2026-11-20T09:00:00Z'),
    valueLine: 'Wartość szacunkowa: 10.00 PLN',
    cpvCodes: ['72000000-5', '48000000-8'],
    noticeId: '2026/BZP 1',
    description: 'Opis zamówienia.',
  };

  it('writes labelled lines, then the description', () => {
    expect(buildTenderText(parts, 10_000)).toBe(
      [
        'DEMO Tytuł',
        'Zamawiający: DEMO Gmina',
        'Termin składania ofert: 2026-11-20 10:00 (czas warszawski)',
        'Wartość szacunkowa: 10.00 PLN',
        'Kody CPV: 72000000-5, 48000000-8',
        'Numer ogłoszenia: 2026/BZP 1',
        '',
        'Opis zamówienia.',
      ].join('\n'),
    );
  });

  it('omits what the notice does not state and cuts to the maximum length', () => {
    const text = buildTenderText(
      { ...parts, buyer: null, deadlineAt: null, valueLine: null, description: 'x'.repeat(500) },
      120,
    );
    expect(text).not.toMatch(/Zamawiający|Termin|Wartość/);
    expect(text).toHaveLength(120);
  });
});
