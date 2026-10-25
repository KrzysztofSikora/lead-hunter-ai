/** One `offer_drafts` row; JSON columns are still text here (S-07 D-1). */
export interface OfferDraftRow {
  id: number;
  opportunityId: number;
  /** `FAILED` is internal and never leaves the repository's `current`/`history`. */
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
  /** Non-`FAILED` drafts older than the current one, newest first. */
  history(opportunityId: number, limit: number): OfferDraftRow[];
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
