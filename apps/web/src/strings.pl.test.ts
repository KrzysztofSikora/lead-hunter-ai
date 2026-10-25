import { expect, it } from 'vitest';
import { strings } from './strings.pl.js';

it('names the app', () => {
  expect(strings.appName).toBe('Lead Hunter AI');
});
