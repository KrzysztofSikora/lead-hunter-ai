import type { LlmConfig, ModelPrice } from '@lead-hunter/config';
import type { LlmProvider } from '../../modules/analysis/ports.js';
import type { OfferDrafter } from '../../modules/offers/ports.js';
import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';
import { OpenAiCompatibleProvider } from './openai-compatible.js';

/** D-8: bounded call time; offer drafts keep SDK backoff on 429/5xx and connection errors. */
const TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;

export interface ProviderTuning {
  timeoutMs?: number;
  maxRetries?: number;
}

function build(
  config: LlmConfig | undefined,
  model: string | undefined,
  tuning: ProviderTuning,
): (LlmProvider & OfferDrafter) | undefined {
  if (!config) return undefined;
  if (config.provider === 'mock') return new MockProvider();
  const common = {
    model: model ?? config.model,
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

export function createLlmProvider(
  config: LlmConfig | undefined,
  tuning: ProviderTuning = {},
): LlmProvider | undefined {
  // S-20 D-1: the analysis runner owns the retries, so attempt and backoff are observable.
  return build(config, undefined, { maxRetries: 0, ...tuning });
}

/** S-07 D-6: a second instance whose model is `LLM_MODEL_OFFER`. */
export function createOfferDrafter(
  config: LlmConfig | undefined,
  tuning: ProviderTuning = {},
): OfferDrafter | undefined {
  return build(
    config,
    config && config.provider !== 'mock' ? config.offerModel : undefined,
    tuning,
  );
}

/** What the runner needs besides the provider: the cap, the model's price and the key to guard (D-3, D-9). */
export function llmRunnerDeps(config: LlmConfig | undefined): {
  budget: { monthlyCapMicroUsd: number | null; price: ModelPrice | null };
  secrets: string[];
} {
  if (!config || config.provider === 'mock') {
    return { budget: { monthlyCapMicroUsd: null, price: null }, secrets: [] };
  }
  return {
    budget: {
      monthlyCapMicroUsd: config.monthlyBudgetMicroUsd ?? null,
      price: config.prices[config.model] ?? null,
    },
    secrets: config.apiKey ? [config.apiKey] : [],
  };
}

/** Same as `llmRunnerDeps`, priced for the offer model (S-07 D-8). */
export function offerDrafterDeps(config: LlmConfig | undefined): ReturnType<typeof llmRunnerDeps> {
  const deps = llmRunnerDeps(config);
  if (!config || config.provider === 'mock') return deps;
  return { ...deps, budget: { ...deps.budget, price: config.prices[config.offerModel] ?? null } };
}
