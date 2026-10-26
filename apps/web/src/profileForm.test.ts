import { expect, it } from 'vitest';
import { hoursToMinutes } from './profileForm.js';

it('turns typed hours into whole minutes and leaves other text alone', () => {
  expect(hoursToMinutes('1,5')).toBe(90);
  expect(hoursToMinutes('2')).toBe(120);
  expect(hoursToMinutes('0.25')).toBe(15);
  expect(hoursToMinutes('abc')).toBe('abc');
});
