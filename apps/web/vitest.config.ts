import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['source'] },
  test: { name: '@lead-hunter/web', environment: 'jsdom' },
});
