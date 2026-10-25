import { z } from 'zod';
import { BusinessStatus, SourceError } from './opportunities.js';
import { Category, EvidenceLevel } from './classification.js';
import { PipelineItem } from './pipeline.js';
import { calendarDate } from './status.js';

/** S-13 D-4: rows of these kinds go to "Pomysły produktowe / słabe sygnały", never to TOP. */
export const WEAK_CATEGORIES: readonly Category[] = ['PRODUCT_HYPOTHESIS'];
export const WEAK_EVIDENCE: readonly EvidenceLevel[] = ['INDIRECT_SIGNAL', 'SPECULATIVE'];

/** `z.coerce.number()` turns `''` into 0; an empty query value means "not given". */
const emptyAsAbsent = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

/** D-8: the brief honours the minimum score of the list; other list filters are not applied. */
export const DigestQuery = z
  .object({ minScore: emptyAsAbsent(z.coerce.number().int().min(0).max(100).optional()) })
  .strict();
export type DigestQuery = z.infer<typeof DigestQuery>;

export const DigestItem = z
  .object({
    id: z.number().int(),
    title: z.string(),
    category: Category,
    evidenceLevel: EvidenceLevel,
    score: z.number().int().min(0).max(100),
    /** Model output (FR-11 AC3); null when the stored analysis cannot be read. */
    nextAction: z.string().nullable(),
    demo: z.boolean(),
    businessStatus: BusinessStatus,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DigestItem = z.infer<typeof DigestItem>;

const count = z.number().int().min(0);

/** `GET /api/digest/today` (S-13 D-1): every value comes from stored rows. */
export const DigestToday = z
  .object({
    /** Today in Europe/Warsaw. */
    date: calendarDate,
    minScore: z.number().int().min(0).max(100),
    sources: z
      .object({ ok: count, error: count, notChecked: count, errors: z.array(SourceError) })
      .strict(),
    newSignals: count,
    newAboveThreshold: count,
    /** At most 5, direct requests first, at most 2 near-duplicates of each other. */
    top: z.array(DigestItem).max(5),
    bestNextStep: z
      .discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('follow_up'),
            opportunityId: z.number().int(),
            title: z.string(),
            followUpOn: calendarDate,
          })
          .strict(),
        z
          .object({
            kind: z.literal('opportunity'),
            opportunityId: z.number().int(),
            title: z.string(),
            nextAction: z.string(),
          })
          .strict(),
      ])
      .nullable(),
    followUpsDue: z.array(PipelineItem),
    /** Tokens only (D-9); `null` when no analysis today reported them. */
    llm: z
      .object({
        analyses: count,
        inputTokens: count.nullable(),
        outputTokens: count.nullable(),
      })
      .strict(),
    weakSignals: z.array(DigestItem).max(5),
  })
  .strict();
export type DigestToday = z.infer<typeof DigestToday>;
