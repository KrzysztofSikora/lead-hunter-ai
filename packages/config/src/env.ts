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
    OPERATOR_PASSWORD_HASH: optional(z.string()),
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
