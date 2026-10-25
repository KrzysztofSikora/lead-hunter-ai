import type { Config } from '@lead-hunter/config';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SourceStatusReader } from '../../modules/opportunities/ports.js';
import type { Clock } from '../../modules/shared/clock.js';
import { createSourceService, type SourceService } from '../../modules/sources/service.js';
import { createSignalRepository } from '../db/signal-repository.js';
import { createSourceRepository } from '../db/source-repository.js';
import { createSourceStatusReader } from '../db/source-status-reader.js';
import type { HttpClient } from './http/client.js';
import { createRobotsCheck } from './manual/robots.js';
import { createRssAdapter } from './rss/adapter.js';

export interface SourceRuntimeDeps {
  db: BetterSQLite3Database;
  config: Pick<
    Config,
    'fetchTimeoutMs' | 'importMaxTextChars' | 'sourceMinIntervalMinutes' | 'sourceMaxAttempts'
  >;
  http: HttpClient;
  clock: Clock;
  onSignalCreated?: () => void;
  logger?: { info(message: string): void; warn(message: string): void };
  sleep?: (ms: number) => Promise<void>;
}

/** The one place the sources module meets its infrastructure; server, CLI and tests call it. */
export function createSourceRuntime({
  db,
  config,
  http,
  clock,
  onSignalCreated,
  logger,
  sleep,
}: SourceRuntimeDeps): { service: SourceService; statusReader: SourceStatusReader } {
  const adapter = createRssAdapter({
    http,
    robots: createRobotsCheck({ http, userAgentToken: 'LeadHunterAI', clock }),
    clock,
    timeoutMs: config.fetchTimeoutMs,
    maxAttempts: config.sourceMaxAttempts,
    maxTextChars: config.importMaxTextChars,
    ...(sleep ? { sleep } : {}),
  });
  const service = createSourceService({
    repository: createSourceRepository(db),
    signals: createSignalRepository(db),
    adapter,
    clock,
    minIntervalMs: config.sourceMinIntervalMinutes * 60_000,
    ...(onSignalCreated ? { onSignalCreated } : {}),
    ...(logger ? { logger } : {}),
  });
  return { service, statusReader: createSourceStatusReader(db) };
}
