import { z } from 'zod';
import { MoneyRange } from './analysis.js';
import { BillingModel } from './profile.js';

export const OFFER_SCHEMA_VERSION = 1;

const text = (max: number) => z.string().trim().min(1).max(max);

/** What the model returns for an offer draft (FR-13 AC1). Estimates by contract. */
export const OfferDraftContent = z
  .object({
    language: z.string().regex(/^[a-z]{2}$/),
    problem: text(1000),
    plan: z.array(text(300)).min(1).max(8),
    valueProposition: text(1000),
    mvpScope: z.array(text(300)).min(1).max(10),
    exclusions: z.array(text(300)).max(10),
    timeline: z
      .object({
        minDays: z.number().int().min(1).max(365),
        maxDays: z.number().int().min(1).max(730),
        assumptions: z.array(text(300)).min(1).max(6),
      })
      .strict()
      .refine((t) => t.minDays <= t.maxDays, {
        path: ['maxDays'],
        message: 'górna granica mniejsza niż dolna',
      }),
    /** D-19: the operator's billing models, or `UNKNOWN`. */
    pricing: z
      .object({
        model: z.union([BillingModel, z.literal('UNKNOWN')]),
        range: MoneyRange.nullable(),
        assumptions: z.array(text(300)).min(1).max(6),
      })
      .strict(),
    questions: z.array(text(300)).min(3).max(6),
    message: z.object({ subject: text(200), body: text(4000) }).strict(),
    proposal: z.object({ body: text(8000) }).strict(),
  })
  .strict();
export type OfferDraftContent = z.infer<typeof OfferDraftContent>;

export const OfferDraftStatus = z.enum([
  'DRAFT',
  'REVIEWED',
  'COPIED_OR_EXPORTED',
  'SENT_MANUALLY',
]);
export type OfferDraftStatus = z.infer<typeof OfferDraftStatus>;

export const OfferDraftAction = z.enum(['save', 'copied', 'exported', 'sent']);
export type OfferDraftAction = z.infer<typeof OfferDraftAction>;

/**
 * D-3 / D-16: the linear acceptance workflow, never backwards. `changed` only matters for
 * `save`: new text after a copy or export needs another copy or export before `sent`.
 */
export function nextDraftStatus(
  status: OfferDraftStatus,
  action: OfferDraftAction,
  changed = true,
): OfferDraftStatus | null {
  switch (action) {
    case 'save':
      if (status === 'DRAFT' || status === 'REVIEWED') return 'REVIEWED';
      if (status === 'COPIED_OR_EXPORTED') return changed ? 'REVIEWED' : status;
      return null;
    case 'copied':
    case 'exported':
      return status === 'REVIEWED' || status === 'COPIED_OR_EXPORTED' ? 'COPIED_OR_EXPORTED' : null;
    case 'sent':
      return status === 'COPIED_OR_EXPORTED' ? 'SENT_MANUALLY' : null;
  }
}

const editable = {
  subject: text(200),
  message: text(4000),
  proposal: text(8000),
};

export const OfferDraftPatch = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), ...editable }).strict(),
  z.object({ action: z.literal('copied') }).strict(),
  z.object({ action: z.literal('exported') }).strict(),
  z.object({ action: z.literal('sent') }).strict(),
]);
export type OfferDraftPatch = z.infer<typeof OfferDraftPatch>;

const timestamps = {
  createdAt: z.string(),
  statusChangedAt: z.string(),
};

export const OfferDraft = z
  .object({
    id: z.number().int(),
    opportunityId: z.number().int(),
    status: OfferDraftStatus,
    language: z.string(),
    subject: z.string(),
    message: z.string(),
    proposal: z.string(),
    /** Null when the stored JSON no longer parses. */
    content: OfferDraftContent.nullable(),
    guardNotes: z.array(z.string()),
    provider: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    demo: z.boolean(),
    /** D-14: false when the draft rests on source and profile only. */
    analysed: z.boolean(),
    inputTokens: z.number().int().nullable(),
    outputTokens: z.number().int().nullable(),
    costMicroUsd: z.number().int().nullable(),
    ...timestamps,
    updatedAt: z.string(),
  })
  .strict();
export type OfferDraft = z.infer<typeof OfferDraft>;

export const OfferDraftHistoryItem = z
  .object({
    id: z.number().int(),
    status: OfferDraftStatus,
    language: z.string(),
    subject: z.string(),
    message: z.string(),
    proposal: z.string(),
    ...timestamps,
  })
  .strict();
export type OfferDraftHistoryItem = z.infer<typeof OfferDraftHistoryItem>;

export const OfferDraftRefused = z
  .object({
    error: z.enum([
      'in_progress',
      'daily_limit',
      'not_configured',
      'budget_missing',
      'price_unknown',
      'budget_reached',
    ]),
  })
  .strict();
export type OfferDraftRefused = z.infer<typeof OfferDraftRefused>;

export const OfferDraftFailed = z
  .object({ error: z.literal('provider_failed'), reason: z.string() })
  .strict();
export type OfferDraftFailed = z.infer<typeof OfferDraftFailed>;

export const OfferDraftConflict = z
  .object({ error: z.enum(['not_current', 'action_not_allowed']) })
  .strict();
export type OfferDraftConflict = z.infer<typeof OfferDraftConflict>;
