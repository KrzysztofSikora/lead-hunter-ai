import type {
  Availability,
  AnalysisStatus,
  BusinessStatus,
  Category,
  Confidence,
  Currency,
  EvidenceLevel,
  MoveCheck,
  OpportunityListQuery,
  RejectionReason,
  PrefilterRule,
  SourceType,
  SourcesStatus,
} from '@lead-hunter/contracts';
import type { OfferDraftRow } from '../offers/ports.js';

/** An opportunity joined with its primary signal. Times are UTC epoch ms. */
export interface OpportunityRow {
  id: number;
  businessStatus: BusinessStatus;
  analysisStatus: AnalysisStatus;
  category: Category | null;
  evidenceLevel: EvidenceLevel | null;
  score: number | null;
  confidence: Confidence | null;
  createdAt: number;
  updatedAt: number;
  sourceType: SourceType;
  /** The configured source's name; null for manual imports (S-10 D-19). */
  sourceName: string | null;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  title: string;
  snippet: string;
  publishedAt: number | null;
  fetchedAt: number;
  availability: Availability;
  lastVerifiedAt: number | null;
  prefilterRule: PrefilterRule | null;
  prefilterMatches: number | null;
  /** Null until the pre-filter has run. */
  prefilterAt: number | null;
  language: 'pl' | 'en' | null;
  analysisProvider: string | null;
}

/** One `analyses` row; JSON columns are still text here. */
export interface AnalysisAttemptRow {
  status: 'COMPLETE' | 'FAILED';
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: number;
  resultJson: string | null;
  breakdownJson: string | null;
  guardNotesJson: string | null;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicroUsd: number | null;
  reusedFromAnalysisId: number | null;
  createdAt: number;
}

export interface EvidenceRow {
  id: number;
  evidenceType: 'IMPORT' | 'REPEAT_IMPORT';
  sourceFact: string;
  sourceUrl: string | null;
  extractedAt: number;
}

/** One `activity_events` row; `metadataJson` is still text here. */
export interface ActivityRow {
  id: number;
  type: 'STATUS_CHANGE' | 'NOTE' | 'FOLLOW_UP';
  actor: 'operator' | 'system';
  fromStatus: BusinessStatus | null;
  toStatus: BusinessStatus | null;
  reason: RejectionReason | null;
  note: string | null;
  metadataJson: string | null;
  occurredAt: number;
}

/** One `payments` row; `paidAt` is the Warsaw midnight of the day paid (S-08 D-5). */
export interface PaymentRow {
  id: number;
  amountMinor: number;
  currency: Currency;
  paidAt: number;
  note: string | null;
  createdAt: number;
}

export interface OpportunityFilter extends Omit<
  OpportunityListQuery,
  'from' | 'to' | 'maxAgeDays'
> {
  /** Inclusive, epoch ms. */
  from?: number;
  /** Exclusive, epoch ms. */
  to?: number;
  /** Epoch ms: excludes rows published (else fetched) before it. */
  notOlderThan?: number;
}

export interface OpportunityRepository {
  list(filter: OpportunityFilter): { rows: OpportunityRow[]; total: number };
  get(id: number):
    | {
        row: OpportunityRow;
        evidence: EvidenceRow[];
        latestAnalysis: AnalysisAttemptRow | undefined;
        /** Newest first. */
        activity: ActivityRow[];
        /** Warsaw midnight of the current follow-up day (D-7). */
        followUpAt: number | null;
        /** Newest paid first. */
        payments: PaymentRow[];
        /** Newest first, no `FAILED` rows: the current draft, then the history (at most 20). */
        offerDrafts: OfferDraftRow[];
      }
    | undefined;
}

/** D-10: replaced by job-run data in S-10/S-12. */
export interface SourceStatusReader {
  summary(): SourcesStatus;
}

export type StatusChangeOutcome = 'changed' | 'not_found' | 'not_allowed' | 'note_required';

export interface ActivityRepository {
  /**
   * One transaction: reads the current status, asks `decide` about it, then updates the status
   * (conditional on the status read) and inserts the event.
   */
  changeStatus(
    id: number,
    to: BusinessStatus,
    decide: (from: BusinessStatus) => MoveCheck,
    event: {
      reason: RejectionReason | null;
      note: string | null;
      /** Returns the validated `metadata_json` for the move that was decided, or null. */
      metadata: (
        check: Extract<MoveCheck, { allowed: true }>,
        /** The move dropped a follow-up that was set. */
        followUpCleared: boolean,
      ) => string | null;
      at: number;
    },
  ): StatusChangeOutcome;
  /**
   * Sets (`followUpAt` an instant) or clears (null) the follow-up and records a `FOLLOW_UP` event,
   * in one transaction. Only while the status may hold one (D-7).
   */
  setFollowUp(
    id: number,
    followUpAt: number | null,
    event: { metadata: string; at: number },
  ): 'changed' | 'not_found' | 'not_allowed';
  /** False when the opportunity does not exist. */
  addNote(id: number, text: string, at: number): boolean;
}

export interface PaymentRepository {
  /** False when the opportunity does not exist. Touches no status (D-10). */
  add(
    id: number,
    payment: { amountMinor: number; currency: Currency; paidAt: number; note: string | null },
    at: number,
  ): boolean;
}
