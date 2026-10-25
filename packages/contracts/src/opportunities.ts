import { z } from 'zod';

export const DEFAULT_IMPORT_MAX_TEXT_CHARS = 20_000;

/** S-10/S-11 add `rss` and `imap`. */
export const SourceType = z.enum(['manual_text', 'manual_url']);
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

export const AnalysisStatus = z.enum(['PENDING', 'COMPLETE', 'FAILED']);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

/** Brief §6.1. */
export const Category = z.enum([
  'DIRECT_GIG',
  'B2B_SUBCONTRACT',
  'UNMET_NEED',
  'PRODUCT_HYPOTHESIS',
  'HARDWARE_IOT',
]);
export type Category = z.infer<typeof Category>;

/** Brief §5.4. */
export const EvidenceLevel = z.enum([
  'DIRECT_REQUEST',
  'EXPLICIT_PROBLEM',
  'INDIRECT_SIGNAL',
  'SPECULATIVE',
]);
export type EvidenceLevel = z.infer<typeof EvidenceLevel>;

export const Confidence = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type Confidence = z.infer<typeof Confidence>;

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
      matchedBy: z.enum(['canonical_url', 'content_hash']),
      evidenceAdded: z.boolean(),
    })
    .strict(),
]);
export type ImportResult = z.infer<typeof ImportResult>;

const isoInstant = z.iso.datetime();

/** D-8: what the source said. Nothing here is inferred. */
export const SourceFacts = z
  .object({
    type: SourceType,
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
  })
  .strict();
export type AnalysisSummary = z.infer<typeof AnalysisSummary>;

const opportunityBase = {
  id: z.number().int(),
  businessStatus: BusinessStatus,
  analysisStatus: AnalysisStatus,
  createdAt: isoInstant,
  updatedAt: isoInstant,
  analysis: AnalysisSummary.nullable(),
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

export const OpportunityDetail = z
  .object({
    ...opportunityBase,
    source: SourceFacts.extend({ snippet: z.string() }).strict(),
    evidence: z.array(Evidence),
  })
  .strict();
export type OpportunityDetail = z.infer<typeof OpportunityDetail>;

/** D-9: `from` is inclusive, `to` exclusive, both ISO UTC instants on `createdAt`. */
export const OpportunityListQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(['date', 'score']).default('date'),
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    category: Category.optional(),
    sourceType: SourceType.optional(),
    status: BusinessStatus.optional(),
    from: isoInstant.optional(),
    to: isoInstant.optional(),
  })
  .strict();
export type OpportunityListQuery = z.infer<typeof OpportunityListQuery>;

export const SourceError = z
  .object({ source: z.string(), message: z.string(), at: isoInstant })
  .strict();

/** D-10: counts for the empty state; `checked` is 0 until automatic sources exist. */
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
