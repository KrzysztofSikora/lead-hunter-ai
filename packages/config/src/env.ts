import { z } from 'zod';
import { DEFAULT_LLM_PRICES, parseLlmPrices, type ModelPrice } from './llm-prices.js';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];

export const ENV_VARIABLES = [
  'NODE_ENV',
  'HOST',
  'PORT',
  'DATA_DIR',
  'LOG_LEVEL',
  'OPERATOR_PASSWORD_HASH',
  'IMPORT_MAX_TEXT_CHARS',
  'LLM_PROVIDER',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'LLM_MODEL_OFFER',
  'LLM_API_KEY',
  'LLM_MONTHLY_BUDGET_USD',
  'LLM_PAID',
  'LLM_PRICES',
  'LLM_JSON_MODE',
  'ANALYSIS_DAILY_LIMIT',
  'OFFER_DRAFT_DAILY_LIMIT',
  'PREFILTER_MAX_AGE_DAYS',
  'FETCH_TIMEOUT_MS',
  'FETCH_MAX_BYTES',
  'SOURCE_MIN_INTERVAL_MINUTES',
  'SOURCE_MAX_ATTEMPTS',
  'DISCOVERY_TIMES',
] as const;

/** `scrypt:<log2 N>:<r>:<p>:<salt>:<key>`, salt 16 bytes and key 32 bytes in base64url (`pnpm auth:hash`). */
export const PASSWORD_HASH_PATTERN =
  /^scrypt:(\d{1,2}):(\d{1,2}):(\d{1,2}):[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/;

function isValidPasswordHash(value: string): boolean {
  const match = PASSWORD_HASH_PATTERN.exec(value);
  if (!match) return false;
  const [ln, r, p] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return ln >= 10 && ln <= 20 && r >= 1 && r <= 32 && p >= 1 && p <= 16;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const DISCOVERY_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_DISCOVERY_TIMES = ['08:00', '18:00'];

/** D-6: `HH:MM` list in Europe/Warsaw; the 02:xx hour is the DST change, so it is refused. */
function discoveryTimesIssue(value: string): string | undefined {
  const times = value.split(',').map((t) => t.trim());
  if (times.length > 6) return 'najwyżej 6 godzin';
  if (!times.every((t) => DISCOVERY_TIME.test(t)))
    return 'oczekiwano godzin HH:MM oddzielonych przecinkami';
  if (times.some((t) => t.startsWith('02:'))) return 'godzina 02:xx to godzina zmiany czasu';
  if (new Set(times).size !== times.length) return 'godziny nie mogą się powtarzać';
  return undefined;
}

// An empty string counts as unset, so `FOO=` in .env falls back to the default.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const EnvSchema = z
  .object({
    NODE_ENV: optional(z.enum(['development', 'test', 'production'])),
    HOST: optional(z.string()),
    PORT: optional(z.coerce.number().int().min(1).max(65535)),
    DATA_DIR: optional(z.string()),
    LOG_LEVEL: optional(z.enum(LOG_LEVELS)),
    OPERATOR_PASSWORD_HASH: optional(
      z.string().refine(isValidPasswordHash, {
        message: 'nieprawidłowy format — wygeneruj hash poleceniem pnpm auth:hash',
      }),
    ),
    IMPORT_MAX_TEXT_CHARS: optional(z.coerce.number().int().min(1_000).max(200_000)),
    LLM_PROVIDER: optional(z.enum(['mock', 'anthropic', 'openai-compatible'])),
    LLM_BASE_URL: optional(
      z.string().refine(isHttpUrl, { message: 'oczekiwano adresu http:// lub https://' }),
    ),
    LLM_MODEL: optional(z.string().trim().min(1)),
    LLM_MODEL_OFFER: optional(z.string().trim().min(1)),
    LLM_API_KEY: optional(z.string().trim().min(1)),
    LLM_MONTHLY_BUDGET_USD: optional(z.coerce.number().min(0.01).max(100_000)),
    LLM_PAID: optional(z.enum(['true', 'false'])),
    LLM_PRICES: optional(z.string()),
    LLM_JSON_MODE: optional(z.enum(['json_object', 'off'])),
    ANALYSIS_DAILY_LIMIT: optional(z.coerce.number().int().min(1).max(1_000)),
    OFFER_DRAFT_DAILY_LIMIT: optional(z.coerce.number().int().min(1).max(100)),
    PREFILTER_MAX_AGE_DAYS: optional(z.coerce.number().int().min(1).max(365)),
    FETCH_TIMEOUT_MS: optional(z.coerce.number().int().min(1_000).max(60_000)),
    FETCH_MAX_BYTES: optional(z.coerce.number().int().min(65_536).max(5_242_880)),
    SOURCE_MIN_INTERVAL_MINUTES: optional(z.coerce.number().int().min(60).max(1_440)),
    SOURCE_MAX_ATTEMPTS: optional(z.coerce.number().int().min(1).max(5)),
    DISCOVERY_TIMES: optional(
      z.string().superRefine((value, ctx) => {
        const message = discoveryTimesIssue(value);
        if (message) ctx.addIssue({ code: 'custom', message });
      }),
    ),
  })
  .superRefine((env, ctx) => {
    const missing = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (env.LLM_PROVIDER === 'anthropic' && !env.LLM_API_KEY) {
      missing('LLM_API_KEY', 'wymagany, gdy LLM_PROVIDER=anthropic');
    }
    if (env.LLM_PROVIDER === 'openai-compatible') {
      if (!env.LLM_BASE_URL) {
        missing('LLM_BASE_URL', 'wymagany, gdy LLM_PROVIDER=openai-compatible');
      }
      if (!env.LLM_MODEL) missing('LLM_MODEL', 'wymagany, gdy LLM_PROVIDER=openai-compatible');
    }
    if (env.LLM_PRICES && env.LLM_PROVIDER !== 'mock') {
      try {
        parseLlmPrices(env.LLM_PRICES);
      } catch (error) {
        missing('LLM_PRICES', (error as Error).message);
      }
    }
    const host = env.HOST ?? '127.0.0.1';
    if (!LOOPBACK_HOSTS.includes(host) && !env.OPERATOR_PASSWORD_HASH) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPERATOR_PASSWORD_HASH'],
        message: `wymagana, gdy HOST (${host}) nie jest adresem pętli zwrotnej`,
      });
    }
  });

export type LlmConfig =
  | { provider: 'mock' }
  | {
      provider: 'anthropic' | 'openai-compatible';
      baseUrl?: string;
      model: string;
      offerModel: string;
      /** Secret. Required for anthropic, optional for local servers. */
      apiKey?: string;
      /** A paid provider needs a monthly cap and a price before it may run (FR-09). */
      paid: boolean;
      /** Cap in integer micro-USD; absent means none was set. */
      monthlyBudgetMicroUsd?: number;
      prices: Record<string, ModelPrice>;
      jsonMode: 'json_object' | 'off';
    };

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  dataDir: string;
  logLevel: (typeof LOG_LEVELS)[number];
  operatorPasswordHash?: string;
  /** Longest text one manual import may carry, in UTF-16 code units (FR-02 AC4). */
  importMaxTextChars: number;
  /** Absent means analysis is not configured (FR-08 AC5). */
  llm?: LlmConfig;
  /** Analyses per Europe/Warsaw day (FR-07 AC3). */
  analysisDailyLimit: number;
  offerDraftDailyLimit: number;
  /** Sources older than this many days are pre-filtered out (D-6). */
  prefilterMaxAgeDays: number;
  /** One deadline for everything a URL import fetches: robots.txt, redirects, headers, body (D-8). */
  fetchTimeoutMs: number;
  /** Largest single HTTP response body the shared client reads, in bytes (D-8). */
  fetchMaxBytes: number;
  /** Shortest time between two attempts on one source (A-03), in minutes (S-10 D-5). */
  sourceMinIntervalMinutes: number;
  /** Requests one source run may make while the source answers 429/503 (S-10 D-6). */
  sourceMaxAttempts: number;
  /** Daily discovery slots as `HH:MM` in Europe/Warsaw, sorted (S-12 D-6). */
  discoveryTimes: string[];
}

export interface ConfigIssue {
  variable: string;
  message: string;
}

export class ConfigError extends Error {
  readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    super(
      ['Błąd konfiguracji:', ...issues.map((i) => `  ${i.variable} — ${i.message}`)].join('\n'),
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const EXPECTED: Record<string, string> = {
  NODE_ENV: 'oczekiwano development, test lub production',
  PORT: 'oczekiwano liczby całkowitej 1–65535',
  IMPORT_MAX_TEXT_CHARS: 'oczekiwano liczby całkowitej 1000–200000',
  ANALYSIS_DAILY_LIMIT: 'oczekiwano liczby całkowitej 1–1000',
  OFFER_DRAFT_DAILY_LIMIT: 'oczekiwano liczby całkowitej 1–100',
  PREFILTER_MAX_AGE_DAYS: 'oczekiwano liczby całkowitej 1–365',
  FETCH_TIMEOUT_MS: 'oczekiwano liczby całkowitej 1000–60000',
  FETCH_MAX_BYTES: 'oczekiwano liczby całkowitej 65536–5242880',
  SOURCE_MIN_INTERVAL_MINUTES: 'oczekiwano liczby całkowitej 60–1440',
  SOURCE_MAX_ATTEMPTS: 'oczekiwano liczby całkowitej 1–5',
  LLM_PROVIDER: 'oczekiwano: mock, anthropic lub openai-compatible',
  LLM_MONTHLY_BUDGET_USD: 'oczekiwano liczby 0.01–100000 (USD)',
  LLM_PAID: 'oczekiwano true lub false',
  LLM_JSON_MODE: 'oczekiwano json_object lub off',
  LOG_LEVEL: `oczekiwano jednej z wartości: ${LOG_LEVELS.join(', ')}`,
};

function buildLlm(v: z.infer<typeof EnvSchema>): LlmConfig | undefined {
  if (!v.LLM_PROVIDER) return undefined;
  if (v.LLM_PROVIDER === 'mock') return { provider: 'mock' };
  const anthropic = v.LLM_PROVIDER === 'anthropic';
  const model = v.LLM_MODEL ?? (anthropic ? 'claude-haiku-5-5' : '');
  return {
    provider: v.LLM_PROVIDER,
    ...(v.LLM_BASE_URL ? { baseUrl: v.LLM_BASE_URL } : {}),
    model,
    offerModel: v.LLM_MODEL_OFFER ?? (anthropic ? 'claude-sonnet-5-5' : model),
    ...(v.LLM_API_KEY ? { apiKey: v.LLM_API_KEY } : {}),
    paid: v.LLM_PAID ? v.LLM_PAID === 'true' : anthropic,
    ...(v.LLM_MONTHLY_BUDGET_USD !== undefined
      ? { monthlyBudgetMicroUsd: Math.round(v.LLM_MONTHLY_BUDGET_USD * 1e6) }
      : {}),
    prices: { ...DEFAULT_LLM_PRICES, ...(v.LLM_PRICES ? parseLlmPrices(v.LLM_PRICES) : {}) },
    jsonMode: v.LLM_JSON_MODE ?? 'json_object',
  };
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => {
        const variable = String(issue.path[0] ?? 'env');
        return {
          variable,
          message: issue.code === 'custom' ? issue.message : (EXPECTED[variable] ?? issue.message),
        };
      }),
    );
  }
  const v = parsed.data;
  const llm = buildLlm(v);
  return {
    nodeEnv: v.NODE_ENV ?? 'development',
    host: v.HOST ?? '127.0.0.1',
    port: v.PORT ?? 8080,
    dataDir: v.DATA_DIR ?? './data',
    logLevel: v.LOG_LEVEL ?? 'info',
    importMaxTextChars: v.IMPORT_MAX_TEXT_CHARS ?? 20_000,
    analysisDailyLimit: v.ANALYSIS_DAILY_LIMIT ?? 20,
    offerDraftDailyLimit: v.OFFER_DRAFT_DAILY_LIMIT ?? 5,
    prefilterMaxAgeDays: v.PREFILTER_MAX_AGE_DAYS ?? 30,
    fetchTimeoutMs: v.FETCH_TIMEOUT_MS ?? 20_000,
    fetchMaxBytes: v.FETCH_MAX_BYTES ?? 1_048_576,
    sourceMinIntervalMinutes: v.SOURCE_MIN_INTERVAL_MINUTES ?? 60,
    sourceMaxAttempts: v.SOURCE_MAX_ATTEMPTS ?? 3,
    discoveryTimes: v.DISCOVERY_TIMES
      ? v.DISCOVERY_TIMES.split(',')
          .map((t) => t.trim())
          .sort()
      : DEFAULT_DISCOVERY_TIMES,
    ...(llm ? { llm } : {}),
    ...(v.OPERATOR_PASSWORD_HASH ? { operatorPasswordHash: v.OPERATOR_PASSWORD_HASH } : {}),
  };
}
