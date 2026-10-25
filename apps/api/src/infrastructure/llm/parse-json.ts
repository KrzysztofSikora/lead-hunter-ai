import { ProviderError } from '../../modules/analysis/ports.js';

const FENCE = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/;

/** Parses a model's text answer: trims, strips one surrounding code fence, then `JSON.parse` (D-7). */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') throw new ProviderError('empty');
  const unfenced = FENCE.exec(trimmed)?.[1] ?? trimmed;
  return JSON.parse(unfenced);
}
