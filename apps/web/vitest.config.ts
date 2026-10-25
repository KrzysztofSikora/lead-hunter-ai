import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  test: { name: '@lead-hunter/web', environment: 'jsdom' },
});
