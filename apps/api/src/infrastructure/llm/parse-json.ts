import { ProviderError, type ProviderOutput } from '../../modules/analysis/ports.js';

const FENCE = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/;

/** Parses a model's text answer: trims, strips one surrounding code fence, then `JSON.parse` (D-7). */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') throw new ProviderError('empty');
  const unfenced = FENCE.exec(trimmed)?.[1] ?? trimmed;
  return JSON.parse(unfenced);
}

/** Like `parseModelJson`, but a rejected answer keeps its usage: the call was billed (R2). */
export function parseBilledJson(text: string, usage: ProviderOutput['usage']): unknown {
  try {
    return parseModelJson(text);
  } catch (error) {
    if (error instanceof ProviderError) throw new ProviderError(error.kind, error.status, usage);
    throw new ProviderError('not_json', undefined, usage);
  }
}
