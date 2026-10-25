import type { ImportRequest, ImportResult } from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';
import {
  canonicalizeUrl,
  contentHash,
  deriveTitle,
  isNewEvidence,
  normaliseSnippet,
} from './identity.js';
import type { IdentityKind, SignalRepository, SignalTx } from './ports.js';

export interface SignalDeps {
  repository: SignalRepository;
  clock: Clock;
}

export interface SignalService {
  /** Synchronous on purpose: the transaction callback must not await (D-14). */
  importSignal(request: ImportRequest): ImportResult;
}

export function createSignalService({ repository, clock }: SignalDeps): SignalService {
  return {
    importSignal({ text, url }) {
      const sourceUrl = url ?? null;
      const canonicalUrl = sourceUrl === null ? null : canonicalizeUrl(sourceUrl);
      const snippet = normaliseSnippet(text ?? '');
      const hash = contentHash(snippet);
      const at = clock.now().getTime();
      // For an import without text the only fact the operator gave is the URL.
      const sourceFact = snippet !== '' ? snippet : (sourceUrl ?? '');

      const claim = (tx: SignalTx, opportunityId: number): void => {
        if (canonicalUrl !== null)
          tx.claimIdentity('canonical_url', canonicalUrl, opportunityId, at);
        if (hash !== null) tx.claimIdentity('content_hash', hash, opportunityId, at);
      };

      return repository.transaction((tx): ImportResult => {
        const lookups: [IdentityKind, string | null][] = [
          ['canonical_url', canonicalUrl],
          ['content_hash', hash],
        ];
        for (const [kind, value] of lookups) {
          if (value === null) continue;
          const opportunityId = tx.findOwner(kind, value);
          if (opportunityId === undefined) continue;

          const candidate = { canonicalUrl, contentHash: hash };
          const evidenceAdded = isNewEvidence(tx.evidenceKeys(opportunityId), candidate);
          if (evidenceAdded) {
            tx.insertEvidence({
              opportunityId,
              rawSignalId: tx.primarySignalId(opportunityId),
              evidenceType: 'REPEAT_IMPORT',
              sourceFact,
              sourceUrl,
              ...candidate,
              extractedAt: at,
            });
          }
          claim(tx, opportunityId);
          return { result: 'duplicate', opportunityId, matchedBy: kind, evidenceAdded };
        }

        const signalId = tx.insertSignal({
          sourceType: sourceUrl === null ? 'manual_text' : 'manual_url',
          sourceUrl,
          canonicalUrl,
          title: deriveTitle(snippet, sourceUrl),
          snippet,
          publishedAt: null,
          fetchedAt: at,
          contentHash: hash,
          availability: 'NOT_CHECKED',
          lastVerifiedAt: null,
        });
        const opportunityId = tx.insertOpportunity(signalId, at);
        tx.insertEvidence({
          opportunityId,
          rawSignalId: signalId,
          evidenceType: 'IMPORT',
          sourceFact,
          sourceUrl,
          canonicalUrl,
          contentHash: hash,
          extractedAt: at,
        });
        claim(tx, opportunityId);
        return { result: 'created', opportunityId, signalId };
      });
    },
  };
}
