import type { ImportRequest, ImportResult } from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';
import { canonicalizeUrl, contentHash, deriveTitle, normaliseSnippet } from './identity.js';
import { ingest } from './ingest.js';
import type { PageFetcher, SignalRepository } from './ports.js';

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

      return repository.transaction((tx): ImportResult =>
        ingest(tx, {
          sourceType: fetched ? 'manual_fetch' : sourceUrl === null ? 'manual_text' : 'manual_url',
          sourceId: null,
          externalId: null,
          sourceUrl,
          canonicalUrl,
          title: fetched?.title ?? deriveTitle(snippet, sourceUrl),
          snippet,
          publishedAt: null,
          contentHash: hash,
          at,
          sourceFact,
        }),
      );
    },
  };
}
