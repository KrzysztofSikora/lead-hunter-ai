import Anthropic from '@anthropic-ai/sdk';
import {
  type AnalysisInput,
  type LlmProvider,
  ProviderError,
  type ProviderOutput,
} from '../../modules/analysis/ports.js';
import type { OfferDrafter, OfferInput } from '../../modules/offers/ports.js';
import { toProviderError } from './errors.js';
import { parseBilledJson } from './parse-json.js';
import {
  buildOfferUserMessage,
  OFFER_PROMPT_VERSION,
  offerJsonSchema,
  offerSystemPrompt,
} from './offer-prompt.js';
import { buildUserMessage, outputJsonSchema, PROMPT_VERSION, systemPrompt } from './prompt.js';

export interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  paid: boolean;
  timeoutMs: number;
  maxRetries: number;
}

const MAX_TOKENS = 8000;

interface Call {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort: 'low' | 'medium';
}

export class AnthropicProvider implements LlmProvider, OfferDrafter {
  readonly name = 'anthropic' as const;
  readonly demo = false;
  readonly promptVersion = PROMPT_VERSION;
  readonly offerPromptVersion = OFFER_PROMPT_VERSION;
  readonly model: string;
  readonly paid: boolean;
  private readonly client: Anthropic;

  constructor(options: AnthropicOptions) {
    this.model = options.model;
    this.paid = options.paid;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries,
    });
  }

  analyzeOpportunity(input: AnalysisInput): Promise<ProviderOutput> {
    return this.request({
      system: systemPrompt(),
      user: buildUserMessage(input),
      schema: outputJsonSchema(),
      effort: 'low',
    });
  }

  draftOffer(input: OfferInput): Promise<ProviderOutput> {
    return this.request({
      system: offerSystemPrompt(),
      user: buildOfferUserMessage(input),
      schema: offerJsonSchema(),
      effort: 'medium',
    });
  }

  private async request({ system, user, schema, effort }: Call): Promise<ProviderOutput> {
    let response;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort, format: { type: 'json_schema', schema } },
      });
    } catch (error) {
      throw toProviderError(error);
    }

    const usage = {
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
    };
    if (response.stop_reason === 'refusal') throw new ProviderError('refusal', undefined, usage);
    if (response.stop_reason === 'max_tokens')
      throw new ProviderError('truncated', undefined, usage);
    const block = response.content.find((part) => part.type === 'text');
    return { output: parseBilledJson(block?.type === 'text' ? block.text : '', usage), usage };
  }
}
