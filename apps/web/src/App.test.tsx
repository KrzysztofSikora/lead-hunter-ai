import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { strings } from './strings.pl.js';

const health = (status: 'ok' | 'degraded') => ({
  status,
  version: 'test',
  uptimeSeconds: 1,
  db: { status: status === 'ok' ? 'ok' : 'error', migrations: 1 },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows the heading and an OK status for a healthy server', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(health('ok'))));
  render(<App />);
  expect(screen.getByRole('heading', { name: strings.appName })).toBeTruthy();
  expect(await screen.findByText(strings.status.ok)).toBeTruthy();
});

it('shows the error text for a 503', async () => {
  vi.stubGlobal(
    'fetch',
    async () => new Response(JSON.stringify(health('degraded')), { status: 503 }),
  );
  render(<App />);
  expect(await screen.findByText(strings.status.error)).toBeTruthy();
});

it('shows the error text when the network fails', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('network');
  });
  render(<App />);
  expect(await screen.findByText(strings.status.error)).toBeTruthy();
});
