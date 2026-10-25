import { z } from 'zod';
import { BusinessStatus } from './opportunities.js';
import { Currency } from './profile.js';
import { calendarDate } from './status.js';

/** S-08 D-11: the stages that list their opportunities; the others are only counted. */
export const PIPELINE_STAGES: readonly BusinessStatus[] = [
  'SAVED',
  'OFFER_DRAFTED',
  'CONTACTED',
  'REPLIED',
  'MEETING',
  'WON',
  'LOST',
];

/** Paid so far in one currency; sums of different currencies are never merged (FR-15 AC2). */
const PaidSum = z.object({ currency: Currency, totalMinor: z.number().int().min(1) }).strict();

export const PipelineItem = z
  .object({
    id: z.number().int(),
    title: z.string(),
    businessStatus: BusinessStatus,
    score: z.number().int().nullable(),
    /** A Europe/Warsaw calendar day (D-7). */
    followUpOn: calendarDate.nullable(),
    updatedAt: z.iso.datetime(),
    paid: z.array(PaidSum),
  })
  .strict();
export type PipelineItem = z.infer<typeof PipelineItem>;

/**
 * `GET /api/pipeline` (S-08 D-8, D-9, D-11). `contacted`, `won` and `paid` are counted from three
 * different records, so one never implies another.
 */
export const PipelineResponse = z
  .object({
    stages: z.array(
      z
        .object({
          status: BusinessStatus,
          count: z.number().int().min(0),
          /** Newest updated first, at most `PIPELINE_STAGE_LIMIT`. */
          items: z.array(PipelineItem),
        })
        .strict(),
    ),
    otherCounts: z.array(
      z.object({ status: BusinessStatus, count: z.number().int().min(0) }).strict(),
    ),
    /** Follow-ups due today or overdue, overdue first. */
    followUpsDue: z.array(PipelineItem),
    totals: z
      .object({
        contacted: z.number().int().min(0),
        won: z.number().int().min(0),
        paid: z.number().int().min(0),
        paidSums: z.array(PaidSum.extend({ count: z.number().int().min(1) }).strict()),
      })
      .strict(),
  })
  .strict();
export type PipelineResponse = z.infer<typeof PipelineResponse>;

export const PIPELINE_STAGE_LIMIT = 50;
