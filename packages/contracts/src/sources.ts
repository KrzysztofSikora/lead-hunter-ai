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

const FILTER_PHRASE_MAX_CHARS = 100;
const FILTER_LIST_MAX = 30;

const filterPhrases = z
  .array(z.string().trim().min(1).max(FILTER_PHRASE_MAX_CHARS))
  .max(FILTER_LIST_MAX)
  .refine(
    (phrases) => new Set(phrases.map((phrase) => phrase.toLowerCase())).size === phrases.length,
    { message: 'Fraza występuje więcej niż raz.' },
  );

/**
 * S-17 D-2, D-16: the per-source noise filter. No `.transform()`: this schema is reachable from
 * response schemas, which are encoded and cannot hold a unidirectional transform.
 */
export const SourceFilter = z
  .object({ enabled: z.boolean(), include: filterPhrases, exclude: filterPhrases })
  .strict();
export type SourceFilter = z.infer<typeof SourceFilter>;

/** S-19 D-1: the kinds of source the loop runs; the stored `sources.type`. */
export const SourceKind = z.enum(['rss', 'github', 'opire']);
export type SourceKind = z.infer<typeof SourceKind>;

/** S-19 D-3: GitHub Linguist names the search may filter on. */
export const GITHUB_LANGUAGES = [
  'TypeScript',
  'JavaScript',
  'Python',
  'Go',
  'Rust',
  'Java',
  'Kotlin',
  'Swift',
  'C',
  'C++',
  'C#',
  'PHP',
  'Ruby',
  'Scala',
  'Elixir',
  'Dart',
  'Lua',
  'Shell',
  'HTML',
  'CSS',
  'Vue',
  'Svelte',
  'Solidity',
  'Zig',
  'Haskell',
  'Clojure',
  'Julia',
  'R',
  'Jupyter Notebook',
  'Dockerfile',
] as const;

const GITHUB_LABELS_MAX = 10;
const GITHUB_LANGUAGES_MAX = 5;
/** GitHub rejects a search query longer than 256 characters. */
export const GITHUB_QUERY_MAX_CHARS = 256;
/** The fixed qualifiers every query carries (S-19 D-3). */
export const GITHUB_QUERY_BASE = 'is:issue is:open archived:false';

/**
 * S-19 D-3: the GitHub search source. No free-text query, so no injection into qualifiers. The
 * longest query it can build must fit GitHub's limit (plan-review #11).
 */
export const GithubSearchConfig = z
  .object({
    labels: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(50)
          .refine((label) => !label.includes('"'), {
            message: 'Etykieta nie może zawierać cudzysłowu.',
          }),
      )
      .min(1)
      .max(GITHUB_LABELS_MAX),
    languages: z.array(z.enum(GITHUB_LANGUAGES)).max(GITHUB_LANGUAGES_MAX),
  })
  .strict()
  .refine(
    (config) => new Set(config.labels.map((l) => l.toLowerCase())).size === config.labels.length,
    {
      message: 'Etykieta występuje więcej niż raz.',
      path: ['labels'],
    },
  )
  .refine((config) => new Set(config.languages).size === config.languages.length, {
    message: 'Język występuje więcej niż raz.',
    path: ['languages'],
  })
  .refine(
    (config) => {
      const labels = config.labels.map((l) => (/[\s,]/.test(l) ? `"${l}"` : l)).join(',');
      const longestLanguage = Math.max(0, ...config.languages.map((l) => l.length + 12));
      return (
        GITHUB_QUERY_BASE.length + 7 + labels.length + longestLanguage <= GITHUB_QUERY_MAX_CHARS
      );
    },
    { message: 'Zapytanie jest za długie (najwyżej 256 znaków).', path: ['labels'] },
  );
export type GithubSearchConfig = z.infer<typeof GithubSearchConfig>;

/** S-19 D-11: Opire's public rewards list takes no settings. */
export const OpireConfig = z.object({}).strict();
export type OpireConfig = z.infer<typeof OpireConfig>;

/** D-11: a ready-made source the operator adds in one step. */
export const SourcePreset = z
  .object({
    id: z.string(),
    type: SourceKind,
    name: z.string(),
    url: z.string(),
    accessNote: z.string(),
    termsUrl: z.string(),
    filter: SourceFilter,
  })
  .strict();
export type SourcePreset = z.infer<typeof SourcePreset>;

/** D-1, D-9: one configured source with the outcome of its last attempt. */
export const Source = z
  .object({
    id: z.number().int(),
    type: SourceKind,
    name: z.string(),
    /** The feed URL, or the API endpoint for a bounty source (display only). */
    url: z.string(),
    presetId: z.string().nullable(),
    accessNote: z.string(),
    termsUrl: z.string().nullable(),
    enabled: z.boolean(),
    /** S-17 D-1: off and empty when none was stored. */
    filter: SourceFilter,
    /** S-19 D-3: the search settings of a `github` source; null for any other type. */
    github: GithubSearchConfig.nullable(),
    /** S-17 D-7: the preset is no longer offered; the source keeps working. */
    presetWithdrawn: z.boolean(),
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

/** S-17 D-13: `filter` replaces the whole filter. */
export const UpdateSourceRequest = z
  .object({
    enabled: z.boolean().optional(),
    filter: SourceFilter.optional(),
    /** S-19 D-11: replaces the search settings of a GitHub source. */
    github: GithubSearchConfig.optional(),
  })
  .strict()
  .refine(
    (body) => body.enabled !== undefined || body.filter !== undefined || body.github !== undefined,
    { message: 'Podaj enabled, filter lub github.' },
  );
export type UpdateSourceRequest = z.infer<typeof UpdateSourceRequest>;

/** D-10: the outcome of one run; `failed` counts entries that could not be mapped. */
export const SourceRunResult = z
  .object({
    status: z.enum(['ok', 'partial', 'failed']),
    fetched: z.number().int().min(0),
    new: z.number().int().min(0),
    duplicates: z.number().int().min(0),
    failed: z.number().int().min(0),
    /** S-17 D-6: new signals stored as rejected by the source filter (also counted in `new`). */
    filtered: z.number().int().min(0),
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
