import { z } from 'zod';

export const PROFILE_SCHEMA_VERSION = 1;

const Tag = z.string().trim().min(1).max(80);
const TagList = z.array(Tag).max(100);

const uniqueItems = (items: readonly unknown[]): boolean => new Set(items).size === items.length;

export const Currency = z.enum(['PLN', 'EUR', 'USD']);
export type Currency = z.infer<typeof Currency>;

/** Money as integer minor units (grosze, cents). */
export const Money = z
  .object({
    amountMinor: z.number().int().min(0).max(100_000_000_000),
    currency: Currency,
  })
  .strict();
export type Money = z.infer<typeof Money>;

export const RateRange = z
  .object({
    unit: z.enum(['HOUR', 'DAY', 'PROJECT']),
    currency: Currency,
    minMinor: z.number().int().min(0).max(100_000_000_000),
    maxMinor: z.number().int().min(0).max(100_000_000_000),
  })
  .strict()
  .refine((range) => range.minMinor <= range.maxMinor, {
    path: ['maxMinor'],
    message: 'górna granica mniejsza niż dolna',
  });
export type RateRange = z.infer<typeof RateRange>;

export const EffortSplit = z
  .object({
    directRevenuePercent: z.number().int().min(0).max(100),
    productHypothesisPercent: z.number().int().min(0).max(100),
  })
  .strict()
  .refine((split) => split.directRevenuePercent + split.productHypothesisPercent === 100, {
    message: 'suma musi wynosić 100',
  });
export type EffortSplit = z.infer<typeof EffortSplit>;

export const BillingModel = z.enum(['FIXED_PRICE', 'HOURLY', 'DAILY', 'RETAINER']);
export const WorkMode = z.enum(['REMOTE', 'HYBRID', 'ONSITE']);

export const OperatorProfile = z
  .object({
    skills: TagList,
    experience: z.string().max(4000),
    serviceTypes: TagList,
    preferredTechnologies: TagList,
    excludedTechnologies: TagList,
    industries: TagList,
    excludedCategories: TagList,
    minimumJobValue: Money.nullable(),
    billingModels: z
      .array(BillingModel)
      .refine(uniqueItems, { message: 'wartości się powtarzają' }),
    languages: z
      .array(z.string().regex(/^[a-z]{2}$/))
      .min(1)
      .max(10),
    workModes: z
      .array(WorkMode)
      .min(1)
      .max(3)
      .refine(uniqueItems, { message: 'wartości się powtarzają' }),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(50),
    weeklyHours: z.number().int().min(0).max(168),
    rateRanges: z.array(RateRange).max(10),
    monthlyRevenueGoal: Money.nullable(),
    effortSplit: EffortSplit,
  })
  .strict();
export type OperatorProfile = z.infer<typeof OperatorProfile>;

export const ProfileResponse = z
  .object({
    profile: OperatorProfile,
    example: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ProfileResponse = z.infer<typeof ProfileResponse>;

export const ValidationError = z
  .object({
    error: z.literal('validation_failed'),
    fields: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() }).strict()),
  })
  .strict();
export type ValidationError = z.infer<typeof ValidationError>;
