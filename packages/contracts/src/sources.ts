import { z } from 'zod';
import { SourceFailureReason } from './opportunities.js';

export { SourceFailureReason };

const isoInstant = z.iso.datetime();
const URL_MAX_CHARS = 2048;
const NAME_MAX_CHARS = 120;

const feedUrl = z
  .string()
  .trim()
  .max(URL_MAX_CHARS)
  .refine(
    (value) => {
      try {
        const { protocol } = new URL(value);
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Podaj poprawny adres URL (http lub https).' },
  );

/** The config of an RSS 2.0 / Atom source (adapter-owned JSON, D-1). */
export const RssConfig = z.object({ url: feedUrl }).strict();
export type RssConfig = z.infer<typeof RssConfig>;

/** D-11: a ready-made source the operator adds in one step. */
export const SourcePreset = z
  .object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    accessNote: z.string(),
    termsUrl: z.string(),
  })
  .strict();
export type SourcePreset = z.infer<typeof SourcePreset>;

/** D-1, D-9: one configured source with the outcome of its last attempt. */
export const Source = z
  .object({
    id: z.number().int(),
    type: z.literal('rss'),
    name: z.string(),
    url: z.string(),
    presetId: z.string().nullable(),
    accessNote: z.string(),
    termsUrl: z.string().nullable(),
    enabled: z.boolean(),
    lastAttemptAt: isoInstant.nullable(),
    lastSuccessAt: isoInstant.nullable(),
    lastError: z
      .object({
        reason: SourceFailureReason,
        httpStatus: z.number().int().min(100).max(599).optional(),
        at: isoInstant,
      })
      .strict()
      .nullable(),
    /** The earliest time the next attempt is allowed (A-03); null when none is pending. */
    nextAllowedAt: isoInstant.nullable(),
  })
  .strict();
export type Source = z.infer<typeof Source>;

export const SourceList = z
  .object({ items: z.array(Source), presets: z.array(SourcePreset) })
  .strict();
export type SourceList = z.infer<typeof SourceList>;

/** D-10: `{ preset }` adds a ready-made source, `{ name, url }` any other feed. */
export const CreateSourceRequest = z.union([
  z.object({ preset: z.string().min(1).max(60) }).strict(),
  z.object({ name: z.string().trim().min(1).max(NAME_MAX_CHARS), url: feedUrl }).strict(),
]);
export type CreateSourceRequest = z.infer<typeof CreateSourceRequest>;

export const UpdateSourceRequest = z.object({ enabled: z.boolean() }).strict();
export type UpdateSourceRequest = z.infer<typeof UpdateSourceRequest>;

/** D-10: the outcome of one run; `failed` counts entries that could not be mapped. */
export const SourceRunResult = z
  .object({
    status: z.enum(['ok', 'partial', 'failed']),
    fetched: z.number().int().min(0),
    new: z.number().int().min(0),
    duplicates: z.number().int().min(0),
    failed: z.number().int().min(0),
    error: z
      .object({
        reason: SourceFailureReason,
        httpStatus: z.number().int().min(100).max(599).optional(),
      })
      .strict()
      .optional(),
    nextAllowedAt: isoInstant,
  })
  .strict();
export type SourceRunResult = z.infer<typeof SourceRunResult>;

/** D-9: the outcome of a check; nothing is stored from it. */
export const SourceHealth = z
  .object({
    ok: z.boolean(),
    checkedAt: isoInstant,
    error: z
      .object({
        reason: SourceFailureReason,
        httpStatus: z.number().int().min(100).max(599).optional(),
      })
      .strict()
      .optional(),
    nextAllowedAt: isoInstant,
  })
  .strict();
export type SourceHealth = z.infer<typeof SourceHealth>;
