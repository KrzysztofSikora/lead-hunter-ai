import { readFileSync } from 'node:fs';
import { TenderFacts } from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import { extractCpvCodes, mapBzpNotice } from './map-notice.js';

const page = JSON.parse(
  readFileSync(new URL('../../../../test/fixtures/tenders/bzp-page.json', import.meta.url), 'utf8'),
) as Record<string, unknown>[];
const CONFIG = { cpvPrefixes: ['72', '48', '73'] };
const map = (index: number, max = 20_000) => mapBzpNotice(page[index], CONFIG, max);
const item = (index: number) => {
  const mapped = map(index);
  if (mapped.kind !== 'item') throw new Error(`notice ${index} is ${mapped.kind}`);
  return mapped;
};

describe('mapBzpNotice (S-18 FR-32 AC1)', () => {
  it('maps a notice with a stated value: buyer, deadline, URL, value and its quote', () => {
    const { item: mapped } = item(0);
    expect(mapped).toMatchObject({
      key: '2026/BZP 00000001',
      url: 'https://ezamowienia.gov.pl/mo-client-board/bzp/notice-details/id/11111111-aaaa-4aaa-8aaa-000000000001',
      title: 'DEMO Dostawa i wdrożenie systemu obiegu dokumentów',
      publishedAt: Date.parse('2026-10-20T08:15:00Z'),
    });
    expect(mapped.tender).toEqual({
      noticeId: '2026/BZP 00000001',
      buyer: 'DEMO Gmina Przykładowo',
      deadlineAt: '2026-11-20T09:00:00.000Z',
      estimatedValue: {
        amountMinor: 12_345_678,
        currency: 'PLN',
        quote: 'Wartość szacunkowa: 123456.78 PLN',
      },
      valueState: 'stated',
      cpvCodes: ['72000000-5'],
      procedure: null,
      country: 'PL',
    });
    expect(TenderFacts.safeParse(mapped.tender).success).toBe(true);
    expect(mapped.text).toContain('Wartość szacunkowa: 123456.78 PLN');
    expect(mapped.text).toContain('Termin składania ofert: 2026-11-20 10:00 (czas warszawski)');
    expect(mapped.text).toContain('Opis: system & wdrożenie');
    expect(mapped.text).not.toMatch(/alert|<p>/);
  });

  it('states no value when the notice does not (unknown, never "not stated")', () => {
    const { item: mapped } = item(1);
    expect(mapped.tender?.estimatedValue).toBeNull();
    expect(mapped.tender?.valueState).toBe('unknown');
    expect(mapped.text).not.toContain('Wartość szacunkowa');
    // A zone-less deadline is Warsaw time.
    expect(mapped.tender?.deadlineAt).toBe('2026-11-18T09:00:00.000Z');
  });

  it('ignores a notice type that does not open a procedure and a CPV outside the prefixes', () => {
    expect(map(2)).toEqual({ kind: 'ignored', reason: 'notice_type' });
    expect(map(4)).toEqual({ kind: 'ignored', reason: 'cpv' });
    expect(mapBzpNotice(page[0], { cpvPrefixes: ['7220'] }, 20_000)).toEqual({
      kind: 'ignored',
      reason: 'cpv',
    });
  });

  it('marks a notice without title or id, and non-objects, as invalid', () => {
    expect(map(3)).toEqual({ kind: 'invalid' });
    for (const raw of [null, 'x', 7, [], undefined]) {
      expect(mapBzpNotice(raw, CONFIG, 20_000)).toEqual({ kind: 'invalid' });
    }
  });

  it('bounds each field alone: 25 CPV codes, a long buyer, a far date and a huge value (plan-review 3)', () => {
    const { item: mapped, cpvDropped } = item(5);
    expect(cpvDropped).toBe(5);
    expect(mapped.tender?.cpvCodes).toHaveLength(20);
    expect(mapped.tender?.buyer).toHaveLength(300);
    expect(mapped.tender?.deadlineAt).toBeNull();
    expect(mapped.tender?.estimatedValue).toBeNull();
    expect(mapped.tender?.valueState).toBe('unknown');
    // The whole object still passes the contract, so the buyer and CPV facts are not lost.
    expect(TenderFacts.safeParse(mapped.tender).success).toBe(true);
  });

  it('cuts the text to the maximum length', () => {
    const mapped = map(0, 80);
    expect(mapped.kind === 'item' && mapped.item.text).toHaveLength(80);
  });

  it('reads CPV codes out of a free-text field', () => {
    expect(extractCpvCodes('72000000-5 (Usługi), 48000000-8; 1234')).toEqual([
      '72000000-5',
      '48000000-8',
    ]);
    expect(extractCpvCodes(undefined)).toEqual([]);
  });
});
