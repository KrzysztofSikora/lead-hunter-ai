import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LoginForm, minutesLeft } from './LoginForm.js';
import { strings } from './strings.pl.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function submitWith(response: Response) {
  vi.stubGlobal('fetch', async () => response);
  const onLoggedIn = vi.fn();
  render(<LoginForm onLoggedIn={onLoggedIn} />);
  fireEvent.change(screen.getByLabelText(strings.login.passwordLabel), {
    target: { value: 'pw' },
  });
  fireEvent.click(screen.getByRole('button', { name: strings.login.submit }));
  return onLoggedIn;
}

it('rounds the wait up to whole minutes, at least one', () => {
  expect(minutesLeft(0)).toBe(1);
  expect(minutesLeft(60)).toBe(1);
  expect(minutesLeft(61)).toBe(2);
  expect(minutesLeft(900)).toBe(15);
});

it('reports a wrong password', async () => {
  const onLoggedIn = await submitWith(
    new Response(JSON.stringify({ error: 'invalid_password' }), { status: 401 }),
  );
  expect((await screen.findByRole('alert')).textContent).toBe(strings.login.invalid);
  expect(onLoggedIn).not.toHaveBeenCalled();
});

it('reports the throttle in minutes', async () => {
  await submitWith(
    new Response(JSON.stringify({ error: 'too_many_attempts', retryAfterSeconds: 601 }), {
      status: 429,
    }),
  );
  expect((await screen.findByRole('alert')).textContent).toBe(strings.login.throttled(11));
});

it('explains a missing password hash', async () => {
  await submitWith(new Response(JSON.stringify({ error: 'auth_not_configured' }), { status: 503 }));
  expect((await screen.findByRole('alert')).textContent).toBe(strings.login.notConfigured);
});

it('reports an unexpected answer', async () => {
  await submitWith(new Response(null, { status: 500 }));
  expect((await screen.findByRole('alert')).textContent).toBe(strings.login.failed);
});
