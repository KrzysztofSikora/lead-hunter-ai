import type { Availability, FetchFailureReason, SourceType } from '@lead-hunter/contracts';

export type IdentityKind = 'canonical_url' | 'external_id' | 'content_hash';

export interface NewSignal {
  sourceType: SourceType;
  /** Null for manual imports (S-10 D-1). */
  sourceId: number | null;
  externalId: string | null;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  title: string;
  snippet: string;
  publishedAt: number | null;
  /** UTC epoch ms */
  fetchedAt: number;
  contentHash: string | null;
  availability: Availability;
  lastVerifiedAt: number | null;
  jobRunId?: number | null;
  /** S-18 D-2: validated `TenderFacts` JSON; null for everything but a tender notice. */
  tenderJson?: string | null;
  /** S-19 D-2: validated `BountyFacts` JSON; null for everything but a bounty issue. */
  bountyJson?: string | null;
}

export interface NewEvidence {
  opportunityId: number;
  rawSignalId: number;
  evidenceType: 'IMPORT' | 'REPEAT_IMPORT';
  sourceFact: string;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  contentHash: string | null;
  /** UTC epoch ms */
  extractedAt: number;
}

/** Everything the import use case does inside one transaction (D-14). */
export interface SignalTx {
  findOwner(kind: IdentityKind, value: string): number | undefined;
  primarySignalId(opportunityId: number): number;
  evidenceKeys(
    opportunityId: number,
  ): { canonicalUrl: string | null; contentHash: string | null }[];
  /** Insert or ignore: the first opportunity to see a value owns it. */
  claimIdentity(kind: IdentityKind, value: string, opportunityId: number, at: number): void;
  insertSignal(signal: NewSignal): number;
  insertOpportunity(primarySignalId: number, at: number): number;
  insertEvidence(evidence: NewEvidence): void;
  /** S-17 D-5: store a new opportunity as rejected by its source's filter (same transaction). */
  rejectBySourceFilter(opportunityId: number, phrase: string | null, at: number): void;
}

export type PageFetchResult =
  | { ok: true; title: string; text: string; fetchedAt: number }
  | { ok: false; reason: FetchFailureReason; httpStatus?: number };

/** S-09: one guarded, robots-respecting fetch of a page the operator pasted. */
export interface PageFetcher {
  fetch(url: string): Promise<PageFetchResult>;
}

export interface SignalRepository {
  /** A plain read outside a transaction: the pre-fetch duplicate check (D-1). */
  findOwner(kind: IdentityKind, value: string): number | undefined;
  /** Synchronous: better-sqlite3 rejects a callback that returns a promise. */
  transaction<T>(fn: (tx: SignalTx) => T): T;
}
