/** Price of one model in micro-USD per million tokens (D-2); money stays in integers. */
export interface ModelPrice {
  inputMicroUsdPerMTok: number;
  outputMicroUsdPerMTok: number;
}

/**
 * Anthropic list prices for prompts up to 100K tokens, read 2026-10-06 from the Claude API
 * reference. A price change needs a new row here or an `LLM_PRICES` override in `.env`.
 */
export const DEFAULT_LLM_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-haiku-5-5': { inputMicroUsdPerMTok: 100_000, outputMicroUsdPerMTok: 500_000 },
  'claude-sonnet-5-5': { inputMicroUsdPerMTok: 2_000_000, outputMicroUsdPerMTok: 10_000_000 },
};

const DECIMAL = /^\d{1,6}(\.\d{1,6})?$/;

/**
 * Parses `LLM_PRICES="<model>=<in>/<out>,…"` (USD per million tokens, decimals allowed).
 * Throws an Error with a Polish message on bad syntax.
 */
export function parseLlmPrices(value: string): Record<string, ModelPrice> {
  const prices: Record<string, ModelPrice> = {};
  for (const entry of value.split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const match = /^([^=\s]+)=([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
    if (!match || !DECIMAL.test(match[2]!) || !DECIMAL.test(match[3]!)) {
      throw new Error(`nieprawidłowy wpis „${trimmed}” — oczekiwano model=wejście/wyjście w USD`);
    }
    prices[match[1]!] = {
      inputMicroUsdPerMTok: Math.round(Number(match[2]) * 1e6),
      outputMicroUsdPerMTok: Math.round(Number(match[3]) * 1e6),
    };
  }
  return prices;
}
