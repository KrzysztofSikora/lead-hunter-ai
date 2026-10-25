import type { ImportRequest, ImportResult } from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';
import {
  canonicalizeUrl,
  contentHash,
  deriveTitle,
  isNewEvidence,
  normaliseSnippet,
} from './identity.js';
import type { IdentityKind, PageFetcher, SignalRepository, SignalTx } from './ports.js';

export interface SignalDeps {
  repository: SignalRepository;
  clock: Clock;
  pageFetcher: PageFetcher;
}

export interface SignalService {
  /** Only the fetch awaits; the transaction callback stays synchronous (D-14). */
  importSignal(request: ImportRequest): Promise<ImportResult>;
}

export function createSignalService({ repository, clock, pageFetcher }: SignalDeps): SignalService {
  return {
    async importSignal({ text, url }) {
      const sourceUrl = url ?? null;
      const canonicalUrl = sourceUrl === null ? null : canonicalizeUrl(sourceUrl);
      let snippet = normaliseSnippet(text ?? '');
      let fetched: { title: string } | null = null;
      let at = clock.now().getTime();

      // D-1: a URL without text is fetched once, unless the URL is already known.
      if (sourceUrl !== null && canonicalUrl !== null && snippet === '') {
        const known = repository.findOwner('canonical_url', canonicalUrl);
        if (known !== undefined) {
          return {
            result: 'duplicate',
            opportunityId: known,
            matchedBy: 'canonical_url',
            evidenceAdded: false,
          };
        }
        const page = await pageFetcher.fetch(sourceUrl);
        if (!page.ok) {
          return {
            result: 'fetch_failed',
            reason: page.reason,
            ...(page.httpStatus === undefined ? {} : { httpStatus: page.httpStatus }),
          };
        }
        snippet = normaliseSnippet(page.text);
        fetched = { title: page.title };
        at = page.fetchedAt;
      }
      const hash = contentHash(snippet);
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
          sourceType: fetched ? 'manual_fetch' : sourceUrl === null ? 'manual_text' : 'manual_url',
          sourceUrl,
          canonicalUrl,
          title: fetched?.title ?? deriveTitle(snippet, sourceUrl),
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
