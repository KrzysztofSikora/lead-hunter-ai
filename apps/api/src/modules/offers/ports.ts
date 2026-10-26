import type { AnalysedResult, OperatorProfile, SourceType } from '@lead-hunter/contracts';
import type { ProviderOutput } from '../analysis/ports.js';

/**
 * What an offer drafter receives (S-07 D-10): data only, never the source URL, contacts, keys
 * or other opportunities. Source and analysis text are untrusted content (PRD §6.4).
 */
export interface OfferInput {
  source: { title: string; text: string; sourceType: SourceType };
  /** The current completed analysis, or null when the draft rests on source and profile (D-14). */
  analysis: Pick<
    AnalysedResult,
    | 'category'
    | 'problem'
    | 'mvpScope'
    | 'exclusions'
    | 'estimatedHours'
    | 'proposedPrice'
    | 'pricingAssumptions'
    | 'requiredClarifications'
  > | null;
  profile: Pick<
    OperatorProfile,
    | 'skills'
    | 'serviceTypes'
    | 'preferredTechnologies'
    | 'experience'
    | 'languages'
    | 'rateRanges'
    | 'billingModels'
    | 'minimumJobValue'
  >;
  /** The pre-filter language; null means the model follows the source. */
  targetLanguage: 'pl' | 'en' | null;
}

/** The offer-model side of a provider (S-07 D-6): the model is fixed at construction. */
export interface OfferDrafter {
  readonly name: 'mock' | 'anthropic' | 'openai-compatible';
  readonly paid: boolean;
  readonly model: string;
  readonly offerPromptVersion: string;
  readonly demo: boolean;
  draftOffer(input: OfferInput): Promise<ProviderOutput>;
}

/** One `offer_drafts` row; JSON columns are still text here (S-07 D-1). */
export interface OfferDraftRow {
  id: number;
  opportunityId: number;
  /** `FAILED` is internal and never leaves the repository's `current`. */
  status: 'DRAFT' | 'REVIEWED' | 'COPIED_OR_EXPORTED' | 'SENT_MANUALLY' | 'FAILED';
  language: string;
  subject: string;
  messageMarkdown: string;
  proposalMarkdown: string;
  contentJson: string | null;
  guardNotesJson: string | null;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: number;
  analysed: boolean;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicroUsd: number | null;
  createdAt: number;
  updatedAt: number;
  statusChangedAt: number;
}

export type NewOfferDraft = Omit<
  OfferDraftRow,
  'id' | 'createdAt' | 'updatedAt' | 'statusChangedAt'
>;

export interface OfferDraftChanges {
  status?: OfferDraftRow['status'];
  subject?: string;
  messageMarkdown?: string;
  proposalMarkdown?: string;
}

export interface OfferDraftRepository {
  /** Returns the new id. A `FAILED` row is stored with `insert` too. */
  insert(draft: NewOfferDraft, at: number): number;
  get(id: number): OfferDraftRow | undefined;
  /** The newest non-`FAILED` draft of the opportunity. */
  current(opportunityId: number): OfferDraftRow | undefined;
  /** Attempts (failed ones included) created at or after `at`. */
  countSince(at: number): number;
  /** Conditional on the status still being `expected`; false when it no longer is. */
  update(
    id: number,
    expected: OfferDraftRow['status'],
    changes: OfferDraftChanges,
    at: number,
  ): boolean;
}

/** What the service reads about an opportunity before asking for a draft (S-07 D-10). */
export interface OfferSource {
  title: string;
  text: string;
  sourceType: SourceType;
  /** The pre-filter language; null until it ran or when it could not tell. */
  language: 'pl' | 'en' | null;
  /** The newest completed analysis, still as stored. */
  analysis: { resultJson: string; schemaVersion: number } | null;
}

export interface OfferSourceReader {
  source(opportunityId: number): OfferSource | undefined;
}
