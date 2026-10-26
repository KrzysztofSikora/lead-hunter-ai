import OpenAI from 'openai';
import {
  type AnalysisInput,
  type LlmProvider,
  ProviderError,
  type ProviderOutput,
} from '../../modules/analysis/ports.js';
import type { OfferDrafter, OfferInput } from '../../modules/offers/ports.js';
import { toProviderError } from './errors.js';
import { parseBilledJson } from './parse-json.js';
import { buildOfferUserMessage, OFFER_PROMPT_VERSION, offerSystemPrompt } from './offer-prompt.js';
import { buildUserMessage, PROMPT_VERSION, systemPrompt } from './prompt.js';

export interface OpenAiCompatibleOptions {
  /** Optional: local servers such as Ollama accept any value. */
  apiKey?: string;
  baseUrl: string;
  model: string;
  paid: boolean;
  jsonMode: 'json_object' | 'off';
  timeoutMs: number;
  maxRetries: number;
}

const MAX_TOKENS = 4000;
const OFFER_MAX_TOKENS = 6000;

export class OpenAiCompatibleProvider implements LlmProvider, OfferDrafter {
  readonly name = 'openai-compatible' as const;
  readonly demo = false;
  readonly promptVersion = PROMPT_VERSION;
  readonly offerPromptVersion = OFFER_PROMPT_VERSION;
  readonly model: string;
  readonly paid: boolean;
  private readonly jsonMode: 'json_object' | 'off';
  private readonly client: OpenAI;

  constructor(options: OpenAiCompatibleOptions) {
    this.model = options.model;
    this.paid = options.paid;
    this.jsonMode = options.jsonMode;
    this.client = new OpenAI({
      apiKey: options.apiKey ?? 'not-needed',
      baseURL: options.baseUrl,
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries,
    });
  }

  analyzeOpportunity(input: AnalysisInput): Promise<ProviderOutput> {
    return this.request(systemPrompt(), buildUserMessage(input), MAX_TOKENS);
  }

  draftOffer(input: OfferInput): Promise<ProviderOutput> {
    return this.request(offerSystemPrompt(), buildOfferUserMessage(input), OFFER_MAX_TOKENS);
  }

  private async request(system: string, user: string, maxTokens: number): Promise<ProviderOutput> {
    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        ...(this.jsonMode === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
      });
    } catch (error) {
      throw toProviderError(error);
    }

    const usage = {
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
    };
    const choice = response.choices?.[0];
    if (choice?.finish_reason === 'length') throw new ProviderError('truncated', undefined, usage);
    if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
      throw new ProviderError('refusal', undefined, usage);
    }
    return { output: parseBilledJson(choice?.message?.content ?? '', usage), usage };
  }
}
