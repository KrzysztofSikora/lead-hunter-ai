import { LoginRequest, ThrottledError } from '@lead-hunter/contracts';

export type LoginResult = 'ok' | 'invalid' | 'not_configured' | { throttled: number };

/**
 * `true` when the browser holds a valid session, `false` after a 401. Any other answer throws:
 * a server that is down is not a logged-out operator. Plain `fetch`: a 401 here is an answer.
 */
export async function getSession(): Promise<boolean> {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
  if (response.status === 200) return true;
  if (response.status === 401) return false;
  throw new Error(`session check failed: ${response.status}`);
}

export async function login(password: string): Promise<LoginResult> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(LoginRequest.parse({ password })),
  });
  if (response.status === 204) return 'ok';
  if (response.status === 429) {
    const body = ThrottledError.safeParse(await response.json().catch(() => null));
    return { throttled: body.success ? body.data.retryAfterSeconds : 900 };
  }
  if (response.status === 503) return 'not_configured';
  if (response.status === 401) return 'invalid';
  throw new Error(`login failed: ${response.status}`);
}

export async function logout(): Promise<void> {
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  // 401 means the session is already gone, which is what logout wants.
  if (response.status !== 204 && response.status !== 401) {
    throw new Error(`logout failed: ${response.status}`);
  }
}
