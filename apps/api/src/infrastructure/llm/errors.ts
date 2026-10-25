import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ProviderError } from '../../modules/analysis/ports.js';

function byStatus(status: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('auth', status);
  if (status === 429) return new ProviderError('rate_limited', status);
  if (status === 408) return new ProviderError('timeout', status);
  if (status >= 500) return new ProviderError('unavailable', status);
  return new ProviderError('bad_request', status);
}

/** Maps an SDK failure to our own code; the SDK message may quote the response body (D-9). */
export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('timeout');
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError('timeout');
  if (error instanceof Anthropic.APIConnectionError) return new ProviderError('unavailable');
  if (error instanceof OpenAI.APIConnectionError) return new ProviderError('unavailable');
  if (error instanceof Anthropic.APIError || error instanceof OpenAI.APIError) {
    return typeof error.status === 'number'
      ? byStatus(error.status)
      : new ProviderError('unavailable');
  }
  return new ProviderError('unavailable');
}
