import { z } from 'zod';
import type { BusinessStatus } from './opportunities.js';
import { Currency } from './profile.js';

/** Brief §10.2. */
export const RejectionReason = z.enum([
  'NO_BUDGET',
  'POOR_FIT',
  'OUTDATED',
  'LOW_POTENTIAL',
  'NO_CONTACT',
  'HIGH_COMPETITION',
  'OTHER',
]);
export type RejectionReason = z.infer<typeof RejectionReason>;

/** S-08 D-1: the main path of §10.1, ranked. `WON` and `LOST` share the last rank. */
const MAIN_RANK: Partial<Record<BusinessStatus, number>> = {
  NEW: 0,
  QUALIFIED: 1,
  SAVED: 2,
  OFFER_DRAFTED: 3,
  CONTACTED: 4,
  REPLIED: 5,
  MEETING: 6,
  WON: 7,
  LOST: 7,
};
const MAIN_PATH: readonly BusinessStatus[] = [
  'NEW',
  'QUALIFIED',
  'SAVED',
  'OFFER_DRAFTED',
  'CONTACTED',
  'REPLIED',
  'MEETING',
];
const ASIDE: readonly BusinessStatus[] = ['REJECTED', 'EXPIRED', 'NEEDS_VERIFICATION'];
const AFTER_CONTACT: readonly BusinessStatus[] = ['CONTACTED', 'REPLIED', 'MEETING'];

/**
 * S-08 D-7 and plan-review 4: the only statuses that may hold a follow-up date; a move to any
 * other status clears it.
 */
export const FOLLOW_UP_STATUSES: readonly BusinessStatus[] = AFTER_CONTACT;

/** Every status the operator may move to: all but the system start state. */
export const OPERATOR_TARGETS: readonly BusinessStatus[] = [
  'QUALIFIED',
  'SAVED',
  'OFFER_DRAFTED',
  'CONTACTED',
  'REPLIED',
  'MEETING',
  'WON',
  'LOST',
  'REJECTED',
  'EXPIRED',
  'NEEDS_VERIFICATION',
];

export type MoveCheck =
  | { allowed: false }
  | {
      allowed: true;
      kind: 'forward' | 'back' | 'aside';
      /** Main-path stages a forward move from a main stage or from `NEEDS_VERIFICATION` (rank 0) passed over. */
      skipped: BusinessStatus[];
      /** A back move or a reopen needs a note. */
      noteRequired: boolean;
    };

const forward = (skipped: BusinessStatus[] = []): MoveCheck => ({
  allowed: true,
  kind: 'forward',
  skipped,
  noteRequired: false,
});
const back: MoveCheck = { allowed: true, kind: 'back', skipped: [], noteRequired: true };

/**
 * S-08 D-1: the one place that says which operator moves exist. `WON` / `LOST` only from the
 * stages after contact (or from each other, as a correction); `REJECTED`, `EXPIRED` and
 * `NEEDS_VERIFICATION` from anywhere; any other move along the main path is forward or back.
 */
export function checkMove(from: BusinessStatus, to: BusinessStatus): MoveCheck {
  if (from === to || to === 'NEW') return { allowed: false };
  if (ASIDE.includes(to)) return { allowed: true, kind: 'aside', skipped: [], noteRequired: false };
  if (to === 'WON' || to === 'LOST') {
    if (AFTER_CONTACT.includes(from)) return forward();
    return from === 'WON' || from === 'LOST' ? back : { allowed: false };
  }
  const offPath = from === 'REJECTED' || from === 'EXPIRED';
  // R1, R6: leaving an off-path state never goes past CONTACTED, so a later stage always passes
  // through a recorded contact. NEEDS_VERIFICATION counts as a forward move from the start of the
  // main path; a reopen from REJECTED/EXPIRED is a back move and needs a note.
  const toRank = MAIN_RANK[to];
  if (offPath) {
    return toRank !== undefined && toRank <= (MAIN_RANK.CONTACTED ?? 0) ? back : { allowed: false };
  }
  const fromRank = from === 'NEEDS_VERIFICATION' ? 0 : MAIN_RANK[from];
  if (fromRank === undefined || toRank === undefined) return { allowed: false };
  if (from === 'NEEDS_VERIFICATION' && toRank > (MAIN_RANK.CONTACTED ?? 0))
    return { allowed: false };
  if (toRank < fromRank || from === 'WON' || from === 'LOST') return back;
  return forward(
    MAIN_PATH.filter(
      (stage) => (MAIN_RANK[stage] ?? 0) > fromRank && (MAIN_RANK[stage] ?? 0) < toRank,
    ),
  );
}

/** Plain `YYYY-MM-DD`, a real date; read as a Europe/Warsaw calendar day (S-08 D-5). */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, 'niepoprawna data');

export const NOTE_MAX_CHARS = 2000;
const note = z.string().trim().min(1).max(NOTE_MAX_CHARS);

/** S-08 D-3: stored in the `WON` event's metadata. */
export const Contract = z
  .object({
    valueMinor: z.number().int().min(1).max(100_000_000_000),
    currency: Currency,
    expectedStartOn: calendarDate.optional(),
    expectedEndOn: calendarDate.optional(),
  })
  .strict()
  .refine(
    (contract) =>
      contract.expectedStartOn === undefined ||
      contract.expectedEndOn === undefined ||
      contract.expectedEndOn >= contract.expectedStartOn,
    { path: ['expectedEndOn'], message: 'koniec nie może być przed początkiem' },
  );
export type Contract = z.infer<typeof Contract>;

const plainTargets = [
  'QUALIFIED',
  'SAVED',
  'OFFER_DRAFTED',
  'CONTACTED',
  'REPLIED',
  'MEETING',
  'LOST',
  'EXPIRED',
  'NEEDS_VERIFICATION',
] as const satisfies readonly BusinessStatus[];

export const StatusChangeRequest = z.union([
  z
    .object({ status: z.literal('REJECTED'), reason: RejectionReason, note: note.optional() })
    .strict()
    .refine((body) => body.reason !== 'OTHER' || body.note !== undefined, {
      path: ['note'],
      message: 'przy powodzie "inne" dodaj notatkę',
    }),
  z
    .object({ status: z.literal('WON'), note: note.optional(), contract: Contract.optional() })
    .strict(),
  z.object({ status: z.enum(plainTargets), note: note.optional() }).strict(),
]);
export type StatusChangeRequest = z.infer<typeof StatusChangeRequest>;

/** S-08 D-7: `null` clears the follow-up. A past date is refused by the service (clock). */
export const FollowUpRequest = z.object({ on: calendarDate.nullable() }).strict();
export type FollowUpRequest = z.infer<typeof FollowUpRequest>;

export const PAYMENT_MAX_MINOR = 100_000_000_000;

/** S-08 D-10: a payment is its own record, whatever the status. A future date is refused by the service. */
export const PaymentRequest = z
  .object({
    amountMinor: z.number().int().min(1).max(PAYMENT_MAX_MINOR),
    currency: Currency,
    paidOn: calendarDate,
    note: note.optional(),
  })
  .strict();
export type PaymentRequest = z.infer<typeof PaymentRequest>;

export const NoteRequest = z.object({ text: note }).strict();
export type NoteRequest = z.infer<typeof NoteRequest>;
