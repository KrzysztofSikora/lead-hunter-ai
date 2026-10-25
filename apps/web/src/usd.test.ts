import { expect, it } from 'vitest';
import { formatUsd } from './usd.js';

it('formats micro-USD with a decimal comma', () => {
  expect(formatUsd(4_200)).toBe('0,0042');
  expect(formatUsd(407)).toBe('0,000407');
  expect(formatUsd(10_000_000).replace(/\s/g, '')).toBe('10,0000');
});
