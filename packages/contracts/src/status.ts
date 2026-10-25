import { z } from 'zod';
import type { BusinessStatus } from './opportunities.js';

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

export type OperatorMove = 'SAVED' | 'REJECTED';

/**
 * S-06 D-6: the moves the operator may make now. S-08 replaces this with the full §10.1 table.
 * Leaving `NEEDS_VERIFICATION` or skipping `QUALIFIED` counts as a forward move; the event's
 * from/to is enough to rebuild skipped stages.
 */
export function operatorMoves(status: BusinessStatus): readonly OperatorMove[] {
  const moves: OperatorMove[] = [];
  if (status === 'NEW' || status === 'QUALIFIED' || status === 'NEEDS_VERIFICATION') {
    moves.push('SAVED');
  }
  if (status !== 'REJECTED') moves.push('REJECTED');
  return moves;
}

export const NOTE_MAX_CHARS = 2000;
const note = z.string().trim().min(1).max(NOTE_MAX_CHARS);

export const StatusChangeRequest = z.discriminatedUnion('status', [
  z.object({ status: z.literal('SAVED'), note: note.optional() }).strict(),
  z
    .object({ status: z.literal('REJECTED'), reason: RejectionReason, note: note.optional() })
    .strict()
    .refine((body) => body.reason !== 'OTHER' || body.note !== undefined, {
      path: ['note'],
      message: 'przy powodzie "inne" dodaj notatkę',
    }),
]);
export type StatusChangeRequest = z.infer<typeof StatusChangeRequest>;

export const NoteRequest = z.object({ text: note }).strict();
export type NoteRequest = z.infer<typeof NoteRequest>;
