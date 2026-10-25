import { describe, expect, it } from 'vitest';
import { instantToWarsawDate, startOfWarsawDay, warsawDateToInstant } from './warsaw-day.js';

const iso = (value: string) => startOfWarsawDay(new Date(value)).toISOString();

describe('startOfWarsawDay', () => {
  it('uses +01:00 in winter', () => {
    expect(iso('2026-01-15T10:00:00Z')).toBe('2026-01-14T23:00:00.000Z');
  });

  it('uses +02:00 in summer', () => {
    expect(iso('2026-07-15T10:00:00Z')).toBe('2026-07-14T22:00:00.000Z');
  });

  it('flips at Warsaw midnight, not at UTC midnight', () => {
    expect(iso('2026-07-14T21:59:59Z')).toBe('2026-07-13T22:00:00.000Z');
    expect(iso('2026-07-14T22:00:00Z')).toBe('2026-07-14T22:00:00.000Z');
  });

  it('handles the day the clocks go back (25 hours)', () => {
    expect(iso('2026-10-25T12:00:00Z')).toBe('2026-10-24T22:00:00.000Z');
    expect(iso('2026-10-26T00:30:00Z')).toBe('2026-10-25T23:00:00.000Z');
  });

  it('handles the day the clocks go forward (23 hours)', () => {
    expect(iso('2026-03-29T12:00:00Z')).toBe('2026-03-28T23:00:00.000Z');
    expect(iso('2026-03-30T00:30:00Z')).toBe('2026-03-29T22:00:00.000Z');
  });
});

describe('warsawDateToInstant / instantToWarsawDate', () => {
  const at = (date: string) => warsawDateToInstant(date).toISOString();

  it('maps a day to its Warsaw midnight, winter and summer', () => {
    expect(at('2026-01-15')).toBe('2026-01-14T23:00:00.000Z');
    expect(at('2026-07-15')).toBe('2026-07-14T22:00:00.000Z');
  });

  it('handles the days the clocks change', () => {
    expect(at('2026-10-25')).toBe('2026-10-24T22:00:00.000Z');
    expect(at('2026-10-26')).toBe('2026-10-25T23:00:00.000Z');
    expect(at('2027-03-28')).toBe('2027-03-27T23:00:00.000Z');
    expect(at('2027-03-29')).toBe('2027-03-28T22:00:00.000Z');
  });

  it('round-trips, and agrees with startOfWarsawDay', () => {
    for (const date of ['2026-01-01', '2026-03-29', '2026-10-25', '2027-03-28', '2026-12-31']) {
      const instant = warsawDateToInstant(date);
      expect(instantToWarsawDate(instant)).toBe(date);
      expect(startOfWarsawDay(instant).getTime()).toBe(instant.getTime());
    }
  });

  it('reads the Warsaw day of a late-evening UTC instant', () => {
    expect(instantToWarsawDate(new Date('2026-07-14T22:30:00Z'))).toBe('2026-07-15');
    expect(instantToWarsawDate(new Date('2026-07-14T21:30:00Z'))).toBe('2026-07-14');
  });
});
