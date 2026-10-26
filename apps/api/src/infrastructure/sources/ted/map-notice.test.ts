import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapTedNotice } from './map-notice.js';

const PAGE = JSON.parse(
  readFileSync(new URL('../../../../test/fixtures/tenders/ted-page.json', import.meta.url), 'utf8'),
) as { notices: Record<string, unknown>[] };
const CONFIG = { cpvPrefixes: ['72', '48', '73'] };
const map = (raw: unknown) => mapTedNotice(raw, CONFIG, 20_000);
const item = (raw: unknown) => {
  const mapped = map(raw);
  if (mapped.kind !== 'item') throw new Error(`expected an item, got ${mapped.kind}`);
  return mapped.item;
};

describe('mapTedNotice (S-18 FR-32 AC2)', () => {
  it('maps a notice with a stated value: Polish title, buyer, deadline with time, value, link', () => {
    const mapped = item(PAGE.notices[0]);
    expect(mapped).toMatchObject({
      key: '900001-2026',
      title: 'DEMO Dostawa platformy analitycznej',
      url: 'https://ted.europa.eu/pl/notice/-/detail/900001-2026',
      tender: {
        buyer: 'DEMO Uniwersytet Przykładowy',
        deadlineAt: '2026-11-24T09:30:00.000Z',
        estimatedValue: { amountMinor: 25_000_050, currency: 'PLN' },
        valueState: 'stated',
        cpvCodes: ['72000000', '48000000'],
        country: 'PL',
        procedure: 'cn-standard',
      },
    });
    expect(mapped.tender?.estimatedValue?.quote).toBe('Wartość szacunkowa: 250000.50 PLN');
    expect(mapped.text).toContain('Zamawiający: DEMO Uniwersytet Przykładowy');
    expect(mapped.text).toContain('Termin składania ofert: 2026-11-24 10:30 (czas warszawski)');
    expect(mapped.text).toContain(mapped.tender?.estimatedValue?.quote ?? 'missing');
    expect(mapped.text).toContain('Opis & zakres.');
  });

  it('falls back to English, marks a missing value as absent, and refuses a foreign link', () => {
    const mapped = item(PAGE.notices[1]);
    expect(mapped.title).toBe('DEMO Software maintenance');
    expect(mapped.tender).toMatchObject({
      buyer: 'DEMO City Office',
      estimatedValue: null,
      valueState: 'absent',
      deadlineAt: '2026-11-29T23:00:00.000Z',
    });
    expect(mapped.url).toBe('https://ted.europa.eu/en/notice/-/detail/900002-2026');
    expect(mapped.text).not.toContain('Wartość szacunkowa');
  });

  it('ignores a notice type that does not open a procedure and a CPV that is not wanted', () => {
    expect(map(PAGE.notices[2])).toEqual({ kind: 'ignored', reason: 'notice_type' });
    expect(map(PAGE.notices[3])).toEqual({ kind: 'ignored', reason: 'cpv' });
  });

  it('marks a notice without number or title, or a non-object, as invalid', () => {
    expect(map(PAGE.notices[4])).toEqual({ kind: 'invalid' });
    expect(map('x')).toEqual({ kind: 'invalid' });
    expect(map(null)).toEqual({ kind: 'invalid' });
  });

  it('keeps the value unknown, not absent, when it is present but unreadable', () => {
    const base = PAGE.notices[0] as Record<string, unknown>;
    const unknown = (over: Record<string, unknown>) => item({ ...base, ...over }).tender;
    expect(unknown({ 'estimated-value-lot': [1, 2] })).toMatchObject({
      estimatedValue: null,
      valueState: 'unknown',
    });
    expect(unknown({ 'estimated-value-cur-lot': ['CHF'] })).toMatchObject({
      valueState: 'unknown',
    });
    expect(unknown({ 'estimated-value-lot': [1e15] })).toMatchObject({ valueState: 'unknown' });
    expect(unknown({ 'estimated-value-lot': ['abc'] })).toMatchObject({ valueState: 'unknown' });
  });

  it('prefers the procedure value over a single lot', () => {
    const base = PAGE.notices[0] as Record<string, unknown>;
    const mapped = item({
      ...base,
      'estimated-value-proc': 1000,
      'estimated-value-cur-proc': 'EUR',
    });
    expect(mapped.tender?.estimatedValue).toMatchObject({ amountMinor: 100_000, currency: 'EUR' });
  });

  it('bounds each field alone: 25 CPV codes, a long buyer, an out-of-range deadline (plan-review 3)', () => {
    const base = PAGE.notices[0] as Record<string, unknown>;
    const codes = Array.from({ length: 25 }, (_, i) => `7200${String(1000 + i)}`);
    const mapped = map({
      ...base,
      'classification-cpv': codes,
      'buyer-name': { pol: 'B'.repeat(900) },
      'deadline-receipt-tender-date-lot': ['9999-01-01+01:00'],
    });
    expect(mapped.kind).toBe('item');
    if (mapped.kind !== 'item') return;
    expect(mapped.cpvDropped).toBe(5);
    expect(mapped.item.tender?.cpvCodes).toHaveLength(20);
    expect(mapped.item.tender?.buyer).toHaveLength(300);
    expect(mapped.item.tender?.deadlineAt).toBeNull();
    expect(mapped.item.text).not.toContain('Termin składania ofert');
  });

  it('takes the earliest deadline of several lots', () => {
    const base = PAGE.notices[0] as Record<string, unknown>;
    const mapped = item({
      ...base,
      'deadline-receipt-tender-date-lot': ['2026-12-01+01:00', '2026-11-20+01:00'],
      'deadline-receipt-tender-time-lot': ['12:00:00+01:00', '09:00:00+01:00'],
    });
    expect(mapped.tender?.deadlineAt).toBe('2026-11-20T08:00:00.000Z');
  });

  it('cuts a very long description to the text maximum', () => {
    const base = PAGE.notices[0] as Record<string, unknown>;
    const mapped = mapTedNotice({ ...base, 'description-proc': 'x'.repeat(50_000) }, CONFIG, 500);
    expect(mapped.kind === 'item' && mapped.item.text.length).toBe(500);
  });
});
