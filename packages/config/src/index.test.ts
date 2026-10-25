import { expect, it } from 'vitest';
import { ENV_VARIABLES } from './index.js';

it('exports the list of env variables', () => {
  expect(Array.isArray(ENV_VARIABLES)).toBe(true);
});
