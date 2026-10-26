import { ProviderError } from './ports.js';

/** D-1 (S-20): the first call plus two retries, as the SDK did. */
export const MAX_ATTEMPTS = 3;
/** A longer `Retry-After` means the provider asks for more patience than a drain should spend. */
export const MAX_RETRY_AFTER_MS = 30_000;

const BASE_DELAY_MS = 2000;
const RETRYABLE: ReadonlySet<ProviderError['kind']> = new Set([
  'rate_limited',
  'unavailable',
  'timeout',
]);

/**
 * How long to wait before attempt `attempt + 1` after `error` ended attempt `attempt`
 * (1-based), or `give_up`. 2 s · 2^(n-1), but at least the provider's `Retry-After`.
 */
export function nextDelay(attempt: number, error: ProviderError): number | 'give_up' {
  if (!RETRYABLE.has(error.kind) || attempt >= MAX_ATTEMPTS) return 'give_up';
  const backoff = BASE_DELAY_MS * 2 ** (attempt - 1);
  const asked = error.retryAfterMs;
  if (asked === undefined) return backoff;
  return asked > MAX_RETRY_AFTER_MS ? 'give_up' : Math.max(backoff, asked);
}
