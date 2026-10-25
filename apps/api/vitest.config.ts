import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    name: '@lead-hunter/api',
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
  },
});
