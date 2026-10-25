import { expect, it } from 'vitest';

it('rejects an unmocked fetch', async () => {
  await expect(fetch('https://example.com/')).rejects.toThrow();
});
