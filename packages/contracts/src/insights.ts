import { z } from 'zod';
import { BusinessStatus, Category, SourceType } from './opportunities.js';
import { Currency } from './profile.js';

export const INSIGHTS_MIN_YEAR = 2000;
export const INSIGHTS_MAX_YEAR = 2100;

/** ISO 8601: a year has 53 weeks when 1 January is a Thursday, or a Wednesday in a leap year. */
export function isoWeeksInYear(year: number): 52 | 53 {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return jan1 === 4 || (leap && jan1 === 3) ? 53 : 52;
}

/** S-14 D-11: `YYYY-Www`, a week that exists, in the bounded year range. */
export const IsoWeek = z
  .string()
  .regex(/^\d{4}-W\d{2}$/)
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    const week = Number(value.slice(6));
    return (
      year >= INSIGHTS_MIN_YEAR &&
      year <= INSIGHTS_MAX_YEAR &&
      week >= 1 &&
      week <= isoWeeksInYear(year)
    );
  }, 'niepoprawny tydzień');

export const IsoMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    return year >= INSIGHTS_MIN_YEAR && year <= INSIGHTS_MAX_YEAR;
  }, 'niepoprawny miesiąc');

/** D-1: at most one of `week` and `month`; none means the current ISO week. */
export const InsightsQuery = z
  .object({ week: IsoWeek.optional(), month: IsoMonth.optional() })
  .strict()
  .refine((query) => query.week === undefined || query.month === undefined, {
    path: ['month'],
    message: 'podaj tydzień albo miesiąc, nie oba',
  });
export type InsightsQuery = z.infer<typeof InsightsQuery>;

/** A sum in one currency; sums of different currencies are never merged (FR-19 AC3). */
const CurrencyTotal = z.object({ currency: Currency, totalMinor: z.number().int() }).strict();

const count = z.number().int().min(0);

/** D-3, D-4, D-5: every number comes from recorded events, drafts and payments. */
export const InsightsMetrics = z
  .object({
    /** Operator status changes (D-2). */
    transitions: count,
    /** Drafts that reached `SENT_MANUALLY` in the period. */
    offersSent: count,
    /** Opportunities whose first recorded contact falls in the period. */
    contacted: count,
    /** D-4: outcomes of those contacts as of now; `rate` is null without a known outcome. */
    replies: z
      .object({
        replied: count,
        noReply: count,
        awaiting: count,
        rate: z.number().min(0).max(1).nullable(),
      })
      .strict(),
    meetings: count,
    wins: count,
    payments: z.object({ count, sums: z.array(CurrencyTotal) }).strict(),
  })
  .strict();
export type InsightsMetrics = z.infer<typeof InsightsMetrics>;

/** D-8: the source of the primary signal; every manual import is one bucket. */
export const InsightsSource = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('source'), id: z.number().int(), name: z.string(), type: SourceType })
    .strict(),
  z.object({ kind: z.literal('manual') }).strict(),
]);
export type InsightsSource = z.infer<typeof InsightsSource>;

export const Insights = z
  .object({
    period: z
      .object({
        kind: z.enum(['week', 'month']),
        key: z.string(),
        /** Inclusive Europe/Warsaw calendar days. */
        from: z.string(),
        to: z.string(),
        /** Null outside the bounded years (D-11). */
        previous: z.string().nullable(),
        next: z.string().nullable(),
        /** Whether the period contains now. */
        current: z.boolean(),
      })
      .strict(),
    totals: InsightsMetrics,
    transitionsTo: z.array(z.object({ status: BusinessStatus, count: count.min(1) }).strict()),
    bySource: z.array(z.object({ source: InsightsSource, metrics: InsightsMetrics }).strict()),
    /** D-9: `null` is an opportunity whose analysis is pending or failed. */
    byCategory: z.array(
      z.object({ category: Category.nullable(), metrics: InsightsMetrics }).strict(),
    ),
    /** D-10: entered time and costs only; `net` may be negative. */
    work: z
      .object({
        minutes: z.number().int().min(0).nullable(),
        costs: z.array(CurrencyTotal),
        net: z.array(CurrencyTotal),
      })
      .strict(),
  })
  .strict();
export type Insights = z.infer<typeof Insights>;
