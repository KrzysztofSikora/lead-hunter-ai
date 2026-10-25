import { z } from 'zod';
import { OpportunityAnalysis, PrefilterRule, ScoreBreakdown } from './analysis.js';
import { Category, Confidence, EvidenceLevel } from './classification.js';
import { Currency } from './profile.js';
import { OfferDraft, OfferDraftHistoryItem } from './offer-drafts.js';
import { calendarDate, Contract, RejectionReason } from './status.js';

export { Category, Confidence, EvidenceLevel };

export const DEFAULT_IMPORT_MAX_TEXT_CHARS = 20_000;

/** S-11 adds `imap`. `manual_fetch`: the text came from a one-off page fetch. */
export const SourceType = z.enum(['manual_text', 'manual_url', 'manual_fetch', 'rss']);
export type SourceType = z.infer<typeof SourceType>;

/** Brief §10.1. */
export const BusinessStatus = z.enum([
  'NEW',
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
]);
export type BusinessStatus = z.infer<typeof BusinessStatus>;

export const AnalysisStatus = z.enum(['PENDING', 'COMPLETE', 'FAILED', 'SKIPPED']);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

export const Availability = z.enum(['NOT_CHECKED', 'AVAILABLE', 'UNAVAILABLE']);
export type Availability = z.infer<typeof Availability>;

const URL_MAX_CHARS = 2048;

/**
 * D-5/D-6: every rule that must answer 400 lives here, so the shared Zod handler produces it and
 * OpenAPI documents it. The user-info check is total: an unparsable value is left to `httpUrl`.
 */
export const importRequestSchema = (maxTextChars: number) =>
  z
    .object({
      text: z.string().max(maxTextChars).optional(),
      url: z
        .httpUrl()
        .max(URL_MAX_CHARS)
        .refine(
          (value) => {
            if (!URL.canParse(value)) return true;
            const parsed = new URL(value);
            return !parsed.username && !parsed.password;
          },
          { message: 'adres URL nie może zawierać loginu ani hasła' },
        )
        .optional(),
    })
    .strict()
    .refine((body) => Boolean(body.text?.trim()) || body.url !== undefined, {
      path: ['text'],
      message: 'wklej treść lub podaj adres URL',
    });
export type ImportRequest = z.infer<ReturnType<typeof importRequestSchema>>;

/** S-09 D-3: why a page fetch was refused or failed; the web app words each one. */
export const FetchFailureReason = z.enum([
  'blocked_address',
  'blocked_url',
  'robots_disallowed',
  'robots_unavailable',
  'timeout',
  'too_large',
  'http_status',
  'unsupported_content',
  'no_text',
  'too_many_redirects',
  'network',
]);
export type FetchFailureReason = z.infer<typeof FetchFailureReason>;

/** S-10 D-10: why a source run or check failed; a fetch reason or a feed-level one. */
export const SourceFailureReason = z.enum([
  ...FetchFailureReason.options,
  'invalid_feed',
  'rate_limited',
  'internal',
]);
export type SourceFailureReason = z.infer<typeof SourceFailureReason>;

export const ImportResult = z.discriminatedUnion('result', [
  z
    .object({
      result: z.literal('created'),
      opportunityId: z.number().int(),
      signalId: z.number().int(),
    })
    .strict(),
  z
    .object({
      result: z.literal('duplicate'),
      opportunityId: z.number().int(),
      matchedBy: z.enum(['canonical_url', 'external_id', 'content_hash']),
      evidenceAdded: z.boolean(),
    })
    .strict(),
  /** S-09 D-2: nothing was stored; the operator is asked to paste the text. */
  z
    .object({
      result: z.literal('fetch_failed'),
      reason: FetchFailureReason,
      httpStatus: z.number().int().min(100).max(599).optional(),
    })
    .strict(),
]);
export type ImportResult = z.infer<typeof ImportResult>;

const isoInstant = z.iso.datetime();

/** D-8: what the source said. Nothing here is inferred. */
export const SourceFacts = z
  .object({
    type: SourceType,
    /** S-10 D-19: the configured source's name for feed signals; null for manual ones. */
    name: z.string().nullable(),
    /** The URL exactly as the operator pasted it. */
    url: z.string().nullable(),
    /** Identity form of the URL, for display of what was matched. */
    canonicalUrl: z.string().nullable(),
    title: z.string(),
    publishedAt: isoInstant.nullable(),
    fetchedAt: isoInstant,
    availability: Availability,
    lastVerifiedAt: isoInstant.nullable(),
  })
  .strict();
export type SourceFacts = z.infer<typeof SourceFacts>;

/** D-8: inferred or derived values; the whole group is null until analysis (S-04). */
export const AnalysisSummary = z
  .object({
    category: Category.nullable(),
    evidenceLevel: EvidenceLevel.nullable(),
    score: z.number().int().min(0).max(100).nullable(),
    confidence: Confidence.nullable(),
    /** True when the result comes from the mock: every view labels it DEMO / MOCK (FR-08 AC6). */
    demo: z.boolean(),
  })
  .strict();
export type AnalysisSummary = z.infer<typeof AnalysisSummary>;

/** D-12: null until the pre-filter has run. */
export const PrefilterOutcome = z
  .object({
    rule: PrefilterRule.nullable(),
    matches: z.number().int().min(0),
    language: z.enum(['pl', 'en']).nullable(),
  })
  .strict();
export type PrefilterOutcome = z.infer<typeof PrefilterOutcome>;

/** D-12: the current (latest) analysis attempt; everything in `result` is model output. */
export const LatestAnalysis = z
  .object({
    status: z.enum(['COMPLETE', 'FAILED']),
    provider: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    schemaVersion: z.number().int(),
    demo: z.boolean(),
    createdAt: isoInstant,
    inputTokens: z.number().int().nullable(),
    outputTokens: z.number().int().nullable(),
    /** Micro-USD; null reads "brak danych" (FR-09 AC4). */
    costMicroUsd: z.number().int().nullable(),
    /** Set when the result was copied from an earlier analysis (FR-09 AC5). */
    reusedFromAnalysisId: z.number().int().nullable(),
    result: OpportunityAnalysis.nullable(),
    breakdown: ScoreBreakdown.nullable(),
    guardNotes: z.array(z.string()),
    error: z.string().nullable(),
  })
  .strict();
export type LatestAnalysis = z.infer<typeof LatestAnalysis>;

const opportunityBase = {
  id: z.number().int(),
  businessStatus: BusinessStatus,
  analysisStatus: AnalysisStatus,
  createdAt: isoInstant,
  updatedAt: isoInstant,
  analysis: AnalysisSummary.nullable(),
  prefilter: PrefilterOutcome.nullable(),
};

export const OpportunitySummary = z
  .object({
    ...opportunityBase,
    source: SourceFacts.extend({ excerpt: z.string() }).strict(),
  })
  .strict();
export type OpportunitySummary = z.infer<typeof OpportunitySummary>;

export const Evidence = z
  .object({
    id: z.number().int(),
    type: z.enum(['IMPORT', 'REPEAT_IMPORT']),
    sourceFact: z.string(),
    /** The source URL as pasted. */
    url: z.string().nullable(),
    extractedAt: isoInstant,
  })
  .strict();
export type Evidence = z.infer<typeof Evidence>;

/** S-06 D-4, D-8: why a system status move happened. */
export const ActivityCause = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prefilter'), rule: PrefilterRule }).strict(),
  z.object({ kind: z.literal('insufficient_data') }).strict(),
]);
export type ActivityCause = z.infer<typeof ActivityCause>;

/**
 * S-08 D-2, D-3, D-7: what an operator event stores in `metadata_json` (system events store an
 * `ActivityCause` instead; the reader picks by `actor`).
 */
export const ActivityMetadata = z
  .object({
    skipped: z.array(BusinessStatus).min(1).optional(),
    contract: Contract.optional(),
    /** `FOLLOW_UP` events: the day set, or null when cleared. */
    on: calendarDate.nullable().optional(),
    /** Status events: the move cleared a follow-up that was set. */
    followUpCleared: z.literal(true).optional(),
  })
  .strict();
export type ActivityMetadata = z.infer<typeof ActivityMetadata>;

export const ActivityEvent = z
  .object({
    id: z.number().int(),
    type: z.enum(['STATUS_CHANGE', 'NOTE', 'FOLLOW_UP']),
    actor: z.enum(['operator', 'system']),
    fromStatus: BusinessStatus.nullable(),
    toStatus: BusinessStatus.nullable(),
    reason: RejectionReason.nullable(),
    note: z.string().nullable(),
    cause: ActivityCause.nullable(),
    /** Main-path stages this move passed over (D-2). */
    skipped: z.array(BusinessStatus),
    contract: Contract.nullable(),
    /** `FOLLOW_UP` events only. */
    followUpOn: calendarDate.nullable(),
    /** Status events only: the move dropped the follow-up that was set (R5). */
    followUpCleared: z.boolean(),
    occurredAt: isoInstant,
  })
  .strict();
export type ActivityEvent = z.infer<typeof ActivityEvent>;

export const Payment = z
  .object({
    id: z.number().int(),
    amountMinor: z.number().int().min(1),
    currency: Currency,
    /** A Europe/Warsaw calendar day. */
    paidOn: calendarDate,
    note: z.string().nullable(),
    createdAt: isoInstant,
  })
  .strict();
export type Payment = z.infer<typeof Payment>;

export const OpportunityDetail = z
  .object({
    ...opportunityBase,
    source: SourceFacts.extend({ snippet: z.string() }).strict(),
    evidence: z.array(Evidence),
    latestAnalysis: LatestAnalysis.nullable(),
    /** The one current follow-up, a Europe/Warsaw calendar day (S-08 D-7). */
    followUpOn: calendarDate.nullable(),
    /** Newest paid first (S-08 D-10). */
    payments: z.array(Payment),
    /** Newest first. */
    activity: z.array(ActivityEvent),
    /** S-07 D-1: the newest non-failed draft. */
    offerDraft: OfferDraft.nullable(),
    /** Older drafts, newest first, at most 20. */
    offerDraftHistory: z.array(OfferDraftHistoryItem),
  })
  .strict();
export type OpportunityDetail = z.infer<typeof OpportunityDetail>;

/** `z.coerce.number()` turns `''` into 0; an empty query value means "not given". */
const emptyAsAbsent = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

/** D-9: `from` is inclusive, `to` exclusive, both ISO UTC instants on `createdAt`. */
export const OpportunityListQuery = z
  .object({
    page: emptyAsAbsent(z.coerce.number().int().min(1).default(1)),
    pageSize: emptyAsAbsent(z.coerce.number().int().min(1).max(100).default(20)),
    sort: z.enum(['date', 'score']).default('date'),
    minScore: emptyAsAbsent(z.coerce.number().int().min(0).max(100).optional()),
    category: Category.optional(),
    sourceType: SourceType.optional(),
    status: BusinessStatus.optional(),
    from: isoInstant.optional(),
    to: isoInstant.optional(),
    /** D-13: a row is excluded only when its value is known and fails the filter. */
    maxAgeDays: emptyAsAbsent(z.coerce.number().int().min(1).max(3650).optional()),
    /** Integer minor units of `currency`, compared with the amount the source stated. */
    minAmount: emptyAsAbsent(z.coerce.number().int().min(0).optional()),
    currency: emptyAsAbsent(Currency.optional()),
    language: emptyAsAbsent(z.enum(['pl', 'en']).optional()),
    workMode: emptyAsAbsent(z.enum(['REMOTE', 'HYBRID', 'ONSITE']).optional()),
    country: emptyAsAbsent(
      z
        .string()
        .regex(/^[A-Z]{2}$/)
        .optional(),
    ),
    excludeIndustries: emptyAsAbsent(
      z
        .string()
        .max(1000)
        .transform((value) =>
          value
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0),
        )
        .pipe(z.array(z.string().max(100)).max(20))
        .optional(),
    ),
  })
  .strict()
  .refine((query) => (query.minAmount === undefined) === (query.currency === undefined), {
    path: ['minAmount'],
    message: 'podaj kwotę minimalną razem z walutą',
  });
export type OpportunityListQuery = z.infer<typeof OpportunityListQuery>;

export const SourceError = z
  .object({
    sourceId: z.number().int(),
    source: z.string(),
    reason: SourceFailureReason,
    httpStatus: z.number().int().min(100).max(599).optional(),
    at: isoInstant,
  })
  .strict();

export type SourceError = z.infer<typeof SourceError>;

/** D-10: counts for the empty state; `checked` counts enabled sources that were attempted. */
export const SourcesStatus = z
  .object({ checked: z.number().int().min(0), errors: z.array(SourceError) })
  .strict();
export type SourcesStatus = z.infer<typeof SourcesStatus>;

export const OpportunityList = z
  .object({
    items: z.array(OpportunitySummary),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int().min(0),
    sources: SourcesStatus,
  })
  .strict();
export type OpportunityList = z.infer<typeof OpportunityList>;
