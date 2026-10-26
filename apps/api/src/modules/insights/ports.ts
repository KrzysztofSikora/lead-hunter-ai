import type { BusinessStatus, Category, Currency } from '@lead-hunter/contracts';

/** What an opportunity is attributed to (D-8, D-9): its primary signal's source and its category now. */
export interface Attribution {
  /** Null for manual imports. */
  source: { id: number; name: string; type: string } | null;
  category: Category | null;
}

/** An operator status change. `businessStatus` is the opportunity's status now. */
export interface StatusEventFact extends Attribution {
  opportunityId: number;
  businessStatus: BusinessStatus;
  toStatus: BusinessStatus;
  skipped: BusinessStatus[];
  /** UTC epoch ms. */
  occurredAt: number;
}

export interface SentDraftFact extends Attribution {
  opportunityId: number;
}

export interface PaymentFact extends Attribution {
  opportunityId: number;
  currency: Currency;
  amountMinor: number;
}

/** A `WORK` entry: time spent and/or a cost entered on an opportunity (D-6). */
export interface WorkFact {
  minutes: number | null;
  cost: { currency: Currency; amountMinor: number } | null;
}

export interface InsightsRepository {
  /** Every operator status change, oldest first: a contact's cohort needs the first one (D-4). */
  operatorStatusEvents(): StatusEventFact[];
  /** Drafts that reached `SENT_MANUALLY` in `[from, to)` (UTC epoch ms). */
  sentDrafts(from: number, to: number): SentDraftFact[];
  /** Payments made in `[from, to)`. */
  payments(from: number, to: number): PaymentFact[];
  /** Work entries made in `[from, to)`. */
  workEntries(from: number, to: number): WorkFact[];
}
