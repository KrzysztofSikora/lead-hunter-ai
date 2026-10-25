import type { LlmConfig } from '@lead-hunter/config';
import type { LlmProvider } from '../../modules/analysis/ports.js';
import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';
import { OpenAiCompatibleProvider } from './openai-compatible.js';

/** D-8: bounded call time, SDK backoff on 429/5xx and connection errors. */
const TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;

export interface ProviderTuning {
  timeoutMs?: number;
  maxRetries?: number;
}

export function createLlmProvider(
  config: LlmConfig | undefined,
  tuning: ProviderTuning = {},
): LlmProvider | undefined {
  if (!config) return undefined;
  if (config.provider === 'mock') return new MockProvider();
  const common = {
    model: config.model,
    paid: config.paid,
    timeoutMs: tuning.timeoutMs ?? TIMEOUT_MS,
    maxRetries: tuning.maxRetries ?? MAX_RETRIES,
  };
  if (config.provider === 'anthropic') {
    return new AnthropicProvider({
      ...common,
      apiKey: config.apiKey ?? '',
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    });
  }
  return new OpenAiCompatibleProvider({
    ...common,
    baseUrl: config.baseUrl ?? '',
    jsonMode: config.jsonMode,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  });
}
