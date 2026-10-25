import { expect, it } from 'vitest';
import { formatMinor, strings } from './strings.pl.js';

it('names the app', () => {
  expect(strings.appName).toBe('Lead Hunter AI');
});

it('formats minor units per currency with grouped thousands and a decimal comma', () => {
  expect(formatMinor(150000, 'PLN')).toBe('1\u00a0500,00 PLN');
  expect(formatMinor(123450, 'EUR')).toBe('1\u00a0234,50 EUR');
  expect(formatMinor(5, 'USD')).toBe('0,05 USD');
  expect(formatMinor(100000000000, 'PLN')).toBe('1\u00a0000\u00a0000\u00a0000,00 PLN');
});
