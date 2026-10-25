import type { Config } from '@lead-hunter/config';
import type { DestinationStream, LoggerOptions } from 'pino';

// pino/fast-redact wildcards match one level only, so both `key` and `*.key` are listed.
const SECRET_KEYS = [
  'password',
  'passwordHash',
  'operatorPasswordHash',
  'apiKey',
  'token',
  'secret',
];

export const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...SECRET_KEYS.flatMap((key) => [key, `*.${key}`]),
];

export function createLoggerOptions(
  config: Pick<Config, 'logLevel'>,
  destination?: DestinationStream,
): { level: string; redact: LoggerOptions['redact']; stream?: DestinationStream } {
  return {
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(destination ? { stream: destination } : {}),
  };
}
