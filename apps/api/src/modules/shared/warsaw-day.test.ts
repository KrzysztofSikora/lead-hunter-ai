import { describe, expect, it } from 'vitest';
import { startOfWarsawDay } from './warsaw-day.js';

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
