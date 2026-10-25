import type { ModelPrice } from '@lead-hunter/config';

export type BudgetBlock = 'budget_missing' | 'price_unknown' | 'budget_reached';

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * D-2: cost of one call in micro-USD, rounded up so the cap errs on the safe side. `null` when
 * the usage or the price is unknown ("brak danych", FR-09 AC4); never a guess.
 */
export function costMicroUsd(usage: TokenUsage | null, price: ModelPrice | null): number | null {
  if (!usage || !price || usage.inputTokens === null || usage.outputTokens === null) return null;
  const perMillion =
    usage.inputTokens * price.inputMicroUsdPerMTok +
    usage.outputTokens * price.outputMicroUsdPerMTok;
  return Math.ceil(perMillion / 1_000_000);
}

export interface BudgetState {
  paid: boolean;
  capMicroUsd: number | null;
  price: ModelPrice | null;
  spentMicroUsd: number;
}

/**
 * D-3: whether a provider call may start. A free provider is never blocked; a paid one needs a
 * cap (FR-09 AC1), a known price, and month-to-date spend below the cap (FR-09 AC2).
 */
export function budgetGate(state: BudgetState): BudgetBlock | null {
  if (!state.paid) return null;
  if (state.capMicroUsd === null) return 'budget_missing';
  if (state.price === null) return 'price_unknown';
  if (state.spentMicroUsd >= state.capMicroUsd) return 'budget_reached';
  return null;
}
