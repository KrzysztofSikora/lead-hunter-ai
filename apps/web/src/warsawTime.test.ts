import { describe, expect, it } from 'vitest';
import { formatWarsaw, isCalendarDate, warsawDayEnd, warsawDayStart } from './warsawTime.js';

describe('warsawDayStart', () => {
  it.each([
    ['2026-01-15', '2026-01-14T23:00:00.000Z'], // winter, UTC+1
    ['2026-07-15', '2026-07-14T22:00:00.000Z'], // summer, UTC+2
    ['2026-03-29', '2026-03-28T23:00:00.000Z'], // spring change day starts at +1
    ['2026-03-30', '2026-03-29T22:00:00.000Z'], // the day after is +2
    ['2026-10-25', '2026-10-24T22:00:00.000Z'], // autumn change day starts at +2
    ['2026-10-26', '2026-10-25T23:00:00.000Z'], // the day after is +1
  ])('%s begins at %s', (date, instant) => {
    expect(warsawDayStart(date)).toBe(instant);
  });
});

describe('warsawDayEnd', () => {
  it.each([
    ['2026-03-29', '2026-03-29T22:00:00.000Z'], // a 23-hour day
    ['2026-10-25', '2026-10-25T23:00:00.000Z'], // a 25-hour day
    ['2026-12-31', '2026-12-31T23:00:00.000Z'], // year end
    ['2026-02-28', '2026-02-28T23:00:00.000Z'], // month end
  ])('%s ends at %s', (date, instant) => {
    expect(warsawDayEnd(date)).toBe(instant);
  });
});

describe('formatWarsaw', () => {
  it.each([
    ['2026-03-29T00:30:00Z', '29.03.2026 01:30'],
    ['2026-03-29T01:30:00Z', '29.03.2026 03:30'],
    ['2026-10-25T00:30:00Z', '25.10.2026 02:30'],
    ['2026-10-25T01:30:00Z', '25.10.2026 02:30'],
    ['2026-01-01T23:30:00Z', '02.01.2026 00:30'],
  ])('%s reads %s', (iso, text) => {
    expect(formatWarsaw(iso)).toBe(text);
  });
});

it('accepts only real calendar dates', () => {
  expect(isCalendarDate('2026-02-28')).toBe(true);
  expect(isCalendarDate('2026-02-30')).toBe(false);
  expect(isCalendarDate('26-02-01')).toBe(false);
});
