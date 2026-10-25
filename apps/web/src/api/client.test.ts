import { afterEach, expect, it, vi } from 'vitest';
import { apiFetch, setUnauthorizedHandler, UnauthorizedError } from './client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(() => {});
});

it('calls the handler and throws on a 401', async () => {
  vi.stubGlobal('fetch', async () => new Response(null, { status: 401 }));
  const handler = vi.fn();
  setUnauthorizedHandler(handler);
  await expect(apiFetch('/api/x')).rejects.toBeInstanceOf(UnauthorizedError);
  expect(handler).toHaveBeenCalledOnce();
});

it('returns other answers untouched', async () => {
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));
  const handler = vi.fn();
  setUnauthorizedHandler(handler);
  expect((await apiFetch('/api/x')).status).toBe(404);
  expect(handler).not.toHaveBeenCalled();
});
