import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ProviderError } from '../../modules/analysis/ports.js';

function byStatus(status: number, retryAfterMs?: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('auth', status);
  if (status === 429) return new ProviderError('rate_limited', status, undefined, retryAfterMs);
  if (status === 408) return new ProviderError('timeout', status);
  if (status >= 500) return new ProviderError('unavailable', status, undefined, retryAfterMs);
  return new ProviderError('bad_request', status);
}

/** A source-supplied delay is bounded to a day, so a date in year 12026 cannot be stored or waited on. */
const RETRY_AFTER_CAP_MS = 24 * 60 * 60 * 1000;

/** `Retry-After` is delta-seconds or an HTTP-date; anything else is ignored. */
export function parseRetryAfter(value: string | null | undefined, now: number): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const ms = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  if (!Number.isFinite(ms)) return undefined;
  return Math.min(Math.max(ms, 0), RETRY_AFTER_CAP_MS);
}

const retryAfterOf = (headers: unknown): number | undefined => {
  const get = (headers as { get?: (name: string) => string | null } | undefined)?.get;
  return typeof get === 'function'
    ? parseRetryAfter(get.call(headers, 'retry-after'), Date.now())
    : undefined;
};

/** Maps an SDK failure to our own code; the SDK message may quote the response body (D-9). */
export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  // Before the generic APIError branch: an abort is a sibling of the connection errors (FR-34 AC3).
  if (error instanceof Anthropic.APIUserAbortError) return new ProviderError('cancelled');
  if (error instanceof OpenAI.APIUserAbortError) return new ProviderError('cancelled');
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('timeout');
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError('timeout');
  if (error instanceof Anthropic.APIConnectionError) return new ProviderError('unavailable');
  if (error instanceof OpenAI.APIConnectionError) return new ProviderError('unavailable');
  if (error instanceof Anthropic.APIError || error instanceof OpenAI.APIError) {
    return typeof error.status === 'number'
      ? byStatus(error.status, retryAfterOf(error.headers))
      : new ProviderError('unavailable');
  }
  return new ProviderError('unavailable');
}
