import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4317);
const dataDir = mkdtempSync(join(tmpdir(), 'lh-e2e-'));

export default defineConfig({
  testDir: 'e2e',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // Optional: run against an already installed Chromium instead of the pinned download.
        launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH || undefined },
      },
    },
  ],
  webServer: {
    command: 'node apps/api/dist/server.js',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
      LLM_PROVIDER: 'mock',
    },
  },
});
