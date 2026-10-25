import { z } from 'zod';
import { Category, Confidence, EvidenceLevel } from './classification.js';
import { Currency } from './profile.js';

export const ANALYSIS_SCHEMA_VERSION = 1;
export const SCORING_VERSION = 1;
/** FR-10 AC6: the one-click minimum score. The API itself applies no minimum by default. */
export const DEFAULT_MIN_SCORE = 65;

export const MonetizationModel = z.enum([
  'FIXED_PRICE',
  'HOURLY_B2B',
  'SUBSCRIPTION',
  'PRODUCT_SALE',
  'UNKNOWN',
]);
export type MonetizationModel = z.infer<typeof MonetizationModel>;

export const AnalysisWorkMode = z.enum(['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN']);
export type AnalysisWorkMode = z.infer<typeof AnalysisWorkMode>;

const MINOR_MAX = 100_000_000_000;
const SHORT = 500;
const LONG = 2000;
const LIST_MAX = 20;

const short = z.string().max(SHORT);
const long = z.string().max(LONG);
const shortList = z.array(short).max(LIST_MAX);

export const MoneyRange = z
  .object({
    minMinor: z.number().int().min(0).max(MINOR_MAX),
    maxMinor: z.number().int().min(0).max(MINOR_MAX),
    currency: Currency,
  })
  .strict()
  .refine((range) => range.minMinor <= range.maxMinor, {
    path: ['maxMinor'],
    message: 'górna granica mniejsza niż dolna',
  });
export type MoneyRange = z.infer<typeof MoneyRange>;

/** A budget the source stated: `quote` is the verbatim text it was read from (D-14). */
export const SourceBudget = z
  .object({
    minMinor: z.number().int().min(0).max(MINOR_MAX),
    maxMinor: z.number().int().min(0).max(MINOR_MAX),
    currency: Currency,
    quote: z.string().min(1).max(SHORT),
  })
  .strict()
  .refine((range) => range.minMinor <= range.maxMinor, {
    path: ['maxMinor'],
    message: 'górna granica mniejsza niż dolna',
  });
export type SourceBudget = z.infer<typeof SourceBudget>;

export const HoursRange = z
  .object({
    min: z.number().int().min(1).max(10_000),
    max: z.number().int().min(1).max(10_000),
  })
  .strict()
  .refine((hours) => hours.min <= hours.max, {
    path: ['max'],
    message: 'górna granica mniejsza niż dolna',
  });
export type HoursRange = z.infer<typeof HoursRange>;

/** Brief §6.1 plus the fields the FR-10 AC6 filters need (D-7). */
const AnalysedResult = z
  .object({
    verdict: z.literal('ANALYSED'),
    category: Category,
    evidenceLevel: EvidenceLevel,
    problem: long,
    buyerOrAudience: short.nullable(),
    buyerConfirmed: z.boolean(),
    relevantSkills: shortList,
    solutionApproach: long,
    suggestedDeliverable: long,
    monetizationModel: MonetizationModel,
    estimatedHours: HoursRange.nullable(),
    proposedPrice: MoneyRange.nullable(),
    pricingAssumptions: shortList,
    requiredClarifications: shortList,
    nextAction: short,
    uncertainties: shortList,
    rationale: long,
    sourceFacts: shortList,
    inferences: shortList,
    unknowns: shortList,
    sourceBudget: SourceBudget.nullable(),
    industry: short.nullable(),
    workMode: AnalysisWorkMode,
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(LIST_MAX),
  })
  .strict();

const InsufficientData = z
  .object({
    verdict: z.literal('INSUFFICIENT_DATA'),
    reason: long,
    unknowns: shortList,
    sourceFacts: shortList,
  })
  .strict();

export const OpportunityAnalysis = z.discriminatedUnion('verdict', [
  AnalysedResult,
  InsufficientData,
]);
export type OpportunityAnalysis = z.infer<typeof OpportunityAnalysis>;
export type AnalysedResult = z.infer<typeof AnalysedResult>;
export type InsufficientDataResult = z.infer<typeof InsufficientData>;

export const ScoreComponentKey = z.enum([
  'demand',
  'skillFit',
  'speed',
  'profitability',
  'repeatability',
]);
export type ScoreComponentKey = z.infer<typeof ScoreComponentKey>;

/** FR-10 AC1: weights in the order the breakdown lists them. */
export const SCORE_COMPONENT_MAX: Readonly<Record<ScoreComponentKey, number>> = {
  demand: 30,
  skillFit: 25,
  speed: 20,
  profitability: 15,
  repeatability: 10,
};
const COMPONENT_ORDER = ScoreComponentKey.options;

export const ScoreComponent = z
  .object({
    key: ScoreComponentKey,
    points: z.number().int().min(0).max(100),
    max: z.number().int().min(1).max(100),
    justification: z.string().min(1).max(SHORT),
  })
  .strict();
export type ScoreComponent = z.infer<typeof ScoreComponent>;

export const ScoreBreakdown = z
  .object({
    version: z.literal(SCORING_VERSION),
    total: z.number().int().min(0).max(100),
    confidence: Confidence,
    components: z.array(ScoreComponent).length(5),
  })
  .strict()
  .superRefine((breakdown, ctx) => {
    let sum = 0;
    breakdown.components.forEach((component, index) => {
      const key = COMPONENT_ORDER[index];
      if (component.key !== key || component.max !== SCORE_COMPONENT_MAX[key!]) {
        ctx.addIssue({
          code: 'custom',
          path: ['components', index],
          message: 'zły składnik lub waga',
        });
      }
      if (component.points > component.max) {
        ctx.addIssue({
          code: 'custom',
          path: ['components', index, 'points'],
          message: 'więcej punktów niż maksimum',
        });
      }
      sum += component.points;
    });
    if (sum !== breakdown.total) {
      ctx.addIssue({
        code: 'custom',
        path: ['total'],
        message: 'suma składników różni się od wyniku',
      });
    }
  });
export type ScoreBreakdown = z.infer<typeof ScoreBreakdown>;

export const PrefilterRule = z.enum([
  'no_text',
  'seeking_work',
  'spam',
  'language',
  'too_old',
  'excluded_technology',
  'excluded_category',
  'no_profile_match',
]);
export type PrefilterRule = z.infer<typeof PrefilterRule>;

export const AnalysisServiceStatus = z
  .object({
    configured: z.boolean(),
    provider: z.enum(['mock']).nullable(),
    demo: z.boolean(),
    dailyLimit: z.number().int(),
    analysedToday: z.number().int(),
    waiting: z.number().int(),
    limitReached: z.boolean(),
  })
  .strict();
export type AnalysisServiceStatus = z.infer<typeof AnalysisServiceStatus>;
