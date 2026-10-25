import { SourceFilter } from '@lead-hunter/contracts';

export const NO_FILTER: SourceFilter = { enabled: false, include: [], exclude: [] };

/**
 * S-17 D-1, D-18: a stored filter that is missing or does not validate reads as off and empty.
 * Only a hand-edited database can hold an invalid one; `invalid` lets the caller log it.
 */
export function readFilter(json: string | null): { filter: SourceFilter; invalid: boolean } {
  if (json === null) return { filter: NO_FILTER, invalid: false };
  try {
    const parsed = SourceFilter.safeParse(JSON.parse(json));
    if (parsed.success) return { filter: parsed.data, invalid: false };
  } catch {
    // fall through: not JSON
  }
  return { filter: NO_FILTER, invalid: true };
}

export type FilterVerdict = { pass: true } | { pass: false; phrase: string | null };

/** D-3: NFKC, lower case, whitespace runs collapsed; diacritics are kept. */
const normalise = (text: string): string =>
  text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();

/**
 * D-3: case-insensitive substring match over `title + snippet`. The first configured exclude
 * phrase that matches rejects (and is the reason); otherwise a non-empty include list needs one hit
 * (`phrase: null` = "brak frazy"). Phrases are bounded by the contract, so this is linear.
 */
export function applySourceFilter(
  filter: SourceFilter,
  title: string,
  snippet: string,
): FilterVerdict {
  const text = normalise(`${title}\n${snippet}`);
  const hit = (phrase: string): boolean => text.includes(normalise(phrase));
  const excluded = filter.exclude.find(hit);
  if (excluded !== undefined) return { pass: false, phrase: excluded };
  if (filter.include.length > 0 && !filter.include.some(hit)) return { pass: false, phrase: null };
  return { pass: true };
}
