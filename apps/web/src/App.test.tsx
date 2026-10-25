import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { strings } from './strings.pl.js';

const health = (status: 'ok' | 'degraded') => ({
  status,
  version: 'test',
  uptimeSeconds: 1,
  db: { status: status === 'ok' ? 'ok' : 'error', migrations: 1 },
});

type Handler = (init?: RequestInit) => Response | Promise<Response>;

/** Routes the fetch stub by URL; the session answers 200 unless overridden. */
function stubApi(routes: Record<string, Handler>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    return handler(init);
  });
  return calls;
}

const session =
  (status: number): Handler =>
  () =>
    new Response(null, { status });
const healthy: Handler = () => new Response(JSON.stringify(health('ok')));

const renderApp = () =>
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows the heading and an OK status for a logged-in operator', async () => {
  stubApi({ '/api/auth/session': session(200), '/api/health': healthy });
  renderApp();
  expect(screen.getByRole('heading', { name: strings.appName })).toBeTruthy();
  expect(await screen.findByText(strings.status.ok)).toBeTruthy();
});

it('shows the error text for a 503 health answer', async () => {
  stubApi({
    '/api/auth/session': session(200),
    '/api/health': () => new Response(JSON.stringify(health('degraded')), { status: 503 }),
  });
  renderApp();
  expect(await screen.findByText(strings.status.error)).toBeTruthy();
});

it('shows the error text when the health call fails on the network', async () => {
  stubApi({
    '/api/auth/session': session(200),
    '/api/health': () => {
      throw new TypeError('network');
    },
  });
  renderApp();
  expect(await screen.findByText(strings.status.error)).toBeTruthy();
});

it('shows the login form without a session and the shell after logging in', async () => {
  stubApi({
    '/api/auth/session': session(401),
    '/api/auth/login': session(204),
    '/api/health': healthy,
  });
  renderApp();
  expect(await screen.findByRole('heading', { name: strings.login.title })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(strings.login.passwordLabel), {
    target: { value: 'correct horse battery' },
  });
  fireEvent.click(screen.getByRole('button', { name: strings.login.submit }));
  expect(await screen.findByText(strings.status.ok)).toBeTruthy();
});

it('shows the server error, not the login form, when the session check cannot reach the server', async () => {
  stubApi({
    '/api/auth/session': () => {
      throw new TypeError('network');
    },
  });
  renderApp();
  expect(await screen.findByText(strings.status.error)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: strings.login.title })).toBeNull();
});

it('shows the server error when the session check answers 5xx', async () => {
  stubApi({ '/api/auth/session': session(503) });
  renderApp();
  expect(await screen.findByText(strings.status.error)).toBeTruthy();
});

it('returns to the login form after logout', async () => {
  const calls = stubApi({
    '/api/auth/session': session(200),
    '/api/auth/logout': session(204),
    '/api/health': healthy,
  });
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: strings.login.logout }));
  expect(await screen.findByRole('heading', { name: strings.login.title })).toBeTruthy();
  expect(calls).toContain('POST /api/auth/logout');
});
