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
