import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];

export const ENV_VARIABLES = [
  'NODE_ENV',
  'HOST',
  'PORT',
  'DATA_DIR',
  'LOG_LEVEL',
  'OPERATOR_PASSWORD_HASH',
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
  })
  .superRefine((env, ctx) => {
    const host = env.HOST ?? '127.0.0.1';
    if (!LOOPBACK_HOSTS.includes(host) && !env.OPERATOR_PASSWORD_HASH) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPERATOR_PASSWORD_HASH'],
        message: `wymagana, gdy HOST (${host}) nie jest adresem pętli zwrotnej`,
      });
    }
  });

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  dataDir: string;
  logLevel: (typeof LOG_LEVELS)[number];
  operatorPasswordHash?: string;
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
  LOG_LEVEL: `oczekiwano jednej z wartości: ${LOG_LEVELS.join(', ')}`,
};

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
  return {
    nodeEnv: v.NODE_ENV ?? 'development',
    host: v.HOST ?? '127.0.0.1',
    port: v.PORT ?? 8080,
    dataDir: v.DATA_DIR ?? './data',
    logLevel: v.LOG_LEVEL ?? 'info',
    ...(v.OPERATOR_PASSWORD_HASH ? { operatorPasswordHash: v.OPERATOR_PASSWORD_HASH } : {}),
  };
}
