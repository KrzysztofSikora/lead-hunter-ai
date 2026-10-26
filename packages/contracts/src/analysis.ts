import { z } from 'zod';
import { Category, Confidence, EvidenceLevel } from './classification.js';
import { Currency } from './profile.js';

export const ANALYSIS_SCHEMA_VERSION = 2;
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

/** Brief §6.1 plus the fields the FR-10 AC6 filters need (D-7); schema v2 adds `mvpScope` and `exclusions` (§8 item 6). */
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
    mvpScope: shortList,
    exclusions: shortList,
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

/** Reads a result stored under an older schema version as the current one; v1 had no MVP scope or exclusions. */
export function upgradeStoredAnalysis(value: unknown, schemaVersion: number): unknown {
  if (
    schemaVersion < 2 &&
    typeof value === 'object' &&
    value !== null &&
    (value as { verdict?: unknown }).verdict === 'ANALYSED'
  ) {
    return { ...value, mvpScope: [], exclusions: [] };
  }
  return value;
}

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
  /** S-17 D-5: rejected at discovery by the source's own filter. */
  'source_filter',
]);
export type PrefilterRule = z.infer<typeof PrefilterRule>;

export const AnalysisServiceStatus = z
  .object({
    configured: z.boolean(),
    provider: z.enum(['mock', 'anthropic', 'openai-compatible']).nullable(),
    demo: z.boolean(),
    dailyLimit: z.number().int(),
    analysedToday: z.number().int(),
    waiting: z.number().int(),
    limitReached: z.boolean(),
    /** FR-34 AC3: the operator cancelled an analysis and the queue waits for "Wznów kolejkę". */
    paused: z.boolean(),
    /** D-13 (S-05): what is being used and whether the budget lets it run. */
    model: z.string().nullable(),
    paid: z.boolean(),
    blocked: z.enum(['budget_missing', 'price_unknown', 'budget_reached']).nullable(),
    budget: z
      .object({
        capMicroUsd: z.number().int().nullable(),
        spentMicroUsd: z.number().int(),
        unknownCostCount: z.number().int(),
        /** Start of the current Europe/Warsaw month. */
        monthStart: z.iso.datetime(),
      })
      .strict(),
  })
  .strict();
export type AnalysisServiceStatus = z.infer<typeof AnalysisServiceStatus>;

/** D-10 (S-05): retry or re-analyse one opportunity; `force` skips the content-hash reuse. */
export const AnalysisRequestBody = z.object({ force: z.boolean().optional() }).strict();
export type AnalysisRequestBody = z.infer<typeof AnalysisRequestBody>;

export const AnalysisRequestResult = z
  .object({ result: z.literal('queued'), force: z.boolean() })
  .strict();
export type AnalysisRequestResult = z.infer<typeof AnalysisRequestResult>;

export const AnalysisRequestRefused = z
  .object({ error: z.enum(['prefiltered', 'not_configured']) })
  .strict();
export type AnalysisRequestRefused = z.infer<typeof AnalysisRequestRefused>;

/**
 * FR-34 AC2, D-8 (S-20): a closed set, so a view of the analysis queue cannot leak a raw error,
 * a response body or source text.
 */
export const AnalysisReasonCode = z.enum([
  'timeout',
  'provider_unavailable',
  'rate_limited',
  'auth',
  'bad_request',
  'refusal',
  'truncated',
  'empty',
  'invalid_json',
  'schema_validation',
  'output_rejected',
  'internal_error',
  'cancelled',
]);
export type AnalysisReasonCode = z.infer<typeof AnalysisReasonCode>;

const ActivityTitle = z.string().max(120);

/** The entry the runner works on now (FR-34 AC1). */
export const AnalysisActiveEntry = z
  .object({
    opportunityId: z.number().int(),
    title: ActivityTitle,
    provider: z.enum(['mock', 'anthropic', 'openai-compatible']),
    model: z.string(),
    stage: z.enum(['requesting', 'backoff', 'saving']),
    startedAt: z.iso.datetime(),
    /** The timeout applies per request, so elapsed time is compared from here. */
    attemptStartedAt: z.iso.datetime(),
    attempt: z.number().int().min(1),
    maxAttempts: z.number().int().min(1),
    /** Set while `stage` is `backoff`. */
    nextAttemptAt: z.iso.datetime().nullable(),
    /** Why the previous attempt failed, while a retry is pending or running. */
    lastReason: AnalysisReasonCode.nullable(),
  })
  .strict();
export type AnalysisActiveEntry = z.infer<typeof AnalysisActiveEntry>;

export const AnalysisHistoryEntry = z
  .object({
    opportunityId: z.number().int(),
    title: ActivityTitle,
    provider: z.enum(['mock', 'anthropic', 'openai-compatible']),
    model: z.string(),
    outcome: z.enum(['complete', 'failed', 'cancelled']),
    /** Set for `failed` and `cancelled`. */
    reason: AnalysisReasonCode.nullable(),
    /** A stored result was copied; no provider was called. */
    reused: z.boolean(),
    attempts: z.number().int().min(0),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
  })
  .strict();
export type AnalysisHistoryEntry = z.infer<typeof AnalysisHistoryEntry>;

/** FR-34 AC5: a value that could not be read is `null`, never 0. */
export const HostSnapshot = z
  .object({
    temperatureC: z.number().nullable(),
    load1: z.number().nullable(),
    cpuCount: z.number().int().nullable(),
    measuredAt: z.iso.datetime(),
  })
  .strict();
export type HostSnapshot = z.infer<typeof HostSnapshot>;

export const AnalysisActivity = z
  .object({
    /** Server time, so a client with a wrong clock still shows the right elapsed time. */
    now: z.iso.datetime(),
    paused: z.boolean(),
    active: AnalysisActiveEntry.nullable(),
    queued: z
      .object({
        total: z.number().int(),
        items: z.array(
          z.object({ opportunityId: z.number().int(), title: ActivityTitle }).strict(),
        ),
      })
      .strict(),
    /** Newest first; bounded by count and age, and empty after an app restart (D-2). */
    history: z.array(AnalysisHistoryEntry),
    /** Per-request limit in ms; 0 when the provider has none. */
    timeoutMs: z.number().int().min(0),
    /** FR-34 AC4: a local backend may keep computing after the app closed the connection. */
    backendMayContinue: z.boolean(),
    host: HostSnapshot,
  })
  .strict();
export type AnalysisActivity = z.infer<typeof AnalysisActivity>;

/** FR-34 AC3, D-5: cancel is idempotent and always pauses; `cancelled` says whether a request was aborted. */
export const AnalysisCancelResult = z
  .object({ cancelled: z.boolean(), paused: z.literal(true) })
  .strict();
export type AnalysisCancelResult = z.infer<typeof AnalysisCancelResult>;

export const AnalysisResumeResult = z.object({ paused: z.literal(false) }).strict();
export type AnalysisResumeResult = z.infer<typeof AnalysisResumeResult>;
