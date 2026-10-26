import type { OfferDraftContent } from '@lead-hunter/contracts';
import { removeInventedLinks } from '../analysis/output-guard.js';

export interface GuardedOffer {
  content: OfferDraftContent;
  notes: string[];
}

const MAX_NOTES = 5;

/**
 * S-07 D-11, D-17 (FR-13 AC2): URLs and e-mail addresses that neither the source nor the
 * operator's own experience text contain are the model's invention and are removed from every
 * field. Names, clients and past projects in free prose are not detected here (prompt rule and
 * review step). The caller re-parses the result with the contract.
 */
export function guardOfferDraft(content: OfferDraftContent, allowedText: string): GuardedOffer {
  const removed: string[] = [];
  const guarded = removeInventedLinks(
    content,
    allowedText.toLowerCase(),
    removed,
  ) as OfferDraftContent;
  const notes = removed
    .slice(0, MAX_NOTES)
    .map((link) => `Usunięto adres, którego nie ma w źródle ani w profilu: „${link}”.`);
  if (removed.length > MAX_NOTES) {
    notes.push(`Usunięto więcej adresów spoza źródła i profilu; łącznie: ${removed.length}.`);
  }
  return { content: guarded, notes };
}
