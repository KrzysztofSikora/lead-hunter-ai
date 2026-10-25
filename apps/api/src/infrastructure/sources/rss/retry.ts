/** D-6: a `Retry-After` above this stops the run at once instead of waiting inside a request. */
export const MAX_WAIT_MS = 30_000;
const BASE_DELAY_MS = 2_000;

/** `Retry-After` as milliseconds: delta-seconds or an HTTP-date; anything else is `null`. */
export function parseRetryAfter(value: string | undefined, nowMs: number): number | null {
  const text = value?.trim();
  if (text === undefined || text === '') return null;
  if (/^\d{1,9}$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

/**
 * D-6: the wait before attempt `attempt + 1` (attempt counts from 1): `max(2 s · 2^(attempt-1),
 * Retry-After)`, or `'stop'` when the server asks for more than `MAX_WAIT_MS`.
 */
export function retryDelay(attempt: number, retryAfterMs: number | null): number | 'stop' {
  if (retryAfterMs !== null && retryAfterMs > MAX_WAIT_MS) return 'stop';
  return Math.max(BASE_DELAY_MS * 2 ** (attempt - 1), retryAfterMs ?? 0);
}
