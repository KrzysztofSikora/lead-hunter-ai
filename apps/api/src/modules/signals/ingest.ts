import type { SourceType } from '@lead-hunter/contracts';
import { isNewEvidence } from './identity.js';
import type { IdentityKind, SignalTx } from './ports.js';

/** Everything one stored signal needs; manual import and feed items both build one (S-10 D-4). */
export interface IngestCandidate {
  sourceType: SourceType;
  sourceId: number | null;
  /** The source's own key for the item; null for manual imports. */
  externalId: string | null;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  title: string;
  snippet: string;
  publishedAt: number | null;
  contentHash: string | null;
  /** UTC epoch ms */
  at: number;
  /** The fact recorded as evidence: the text, or the URL when there is no text. */
  sourceFact: string;
  /** S-12 D-8: the source run that fetched it; null for manual imports. */
  jobRunId?: number | null;
  /** S-18 D-2: validated `TenderFacts` JSON, or null. */
  tenderJson?: string | null;
  /** S-19 D-2: validated `BountyFacts` JSON, or null. */
  bountyJson?: string | null;
}

export type IngestResult =
  | { result: 'created'; opportunityId: number; signalId: number }
  | {
      result: 'duplicate';
      opportunityId: number;
      matchedBy: IdentityKind;
      evidenceAdded: boolean;
    };

/** FR-06 AC1: URL, then the source's own key, then the content hash. */
export function ingest(tx: SignalTx, candidate: IngestCandidate): IngestResult {
  const { canonicalUrl, contentHash: hash, at, sourceUrl, sourceFact } = candidate;
  const externalValue =
    candidate.sourceId !== null && candidate.externalId !== null
      ? `${candidate.sourceId}:${candidate.externalId}`
      : null;

  const claim = (opportunityId: number): void => {
    if (canonicalUrl !== null) tx.claimIdentity('canonical_url', canonicalUrl, opportunityId, at);
    if (externalValue !== null) tx.claimIdentity('external_id', externalValue, opportunityId, at);
    if (hash !== null) tx.claimIdentity('content_hash', hash, opportunityId, at);
  };

  const lookups: [IdentityKind, string | null][] = [
    ['canonical_url', canonicalUrl],
    ['external_id', externalValue],
    ['content_hash', hash],
  ];
  for (const [kind, value] of lookups) {
    if (value === null) continue;
    const opportunityId = tx.findOwner(kind, value);
    if (opportunityId === undefined) continue;

    const keys = { canonicalUrl, contentHash: hash };
    const evidenceAdded = isNewEvidence(tx.evidenceKeys(opportunityId), keys);
    if (evidenceAdded) {
      tx.insertEvidence({
        opportunityId,
        rawSignalId: tx.primarySignalId(opportunityId),
        evidenceType: 'REPEAT_IMPORT',
        sourceFact,
        sourceUrl,
        ...keys,
        extractedAt: at,
      });
    }
    claim(opportunityId);
    return { result: 'duplicate', opportunityId, matchedBy: kind, evidenceAdded };
  }

  const signalId = tx.insertSignal({
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    externalId: candidate.externalId,
    sourceUrl,
    canonicalUrl,
    title: candidate.title,
    snippet: candidate.snippet,
    publishedAt: candidate.publishedAt,
    fetchedAt: at,
    contentHash: hash,
    availability: 'NOT_CHECKED',
    lastVerifiedAt: null,
    jobRunId: candidate.jobRunId ?? null,
    tenderJson: candidate.tenderJson ?? null,
    bountyJson: candidate.bountyJson ?? null,
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
  claim(opportunityId);
  return { result: 'created', opportunityId, signalId };
}
