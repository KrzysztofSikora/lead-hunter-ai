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
