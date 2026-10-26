import type { Config } from '@lead-hunter/config';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { hostname } from 'node:os';
import type { JobsService } from '../../modules/jobs/service.js';
import { createJobsService } from '../../modules/jobs/service.js';
import type { JobLock } from '../../modules/jobs/ports.js';
import type { SourceStatusReader } from '../../modules/opportunities/ports.js';
import type { Clock } from '../../modules/shared/clock.js';
import type { SourceAdapters } from '../../modules/sources/ports.js';
import { createSourceService, type SourceService } from '../../modules/sources/service.js';
import { createJobRunRepository } from '../db/job-run-repository.js';
import { createSignalRepository } from '../db/signal-repository.js';
import { createSourceRepository } from '../db/source-repository.js';
import { createSourceStatusReader } from '../db/source-status-reader.js';
import { createJobLock, type JobLockOptions } from '../scheduler/job-lock.js';
import type { HttpClient } from './http/client.js';
import { createRobotsCheck } from './manual/robots.js';
import { createBzpAdapter } from './bzp/adapter.js';
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
  /** Tests: another identity or a shorter staleness for the job lock. */
  jobLock?: Partial<Omit<JobLockOptions, 'db' | 'clock'>>;
  heartbeatMs?: number;
  /** Tests: adapters that replace the real ones, by source type (S-18). */
  adapters?: Partial<SourceAdapters>;
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
  jobLock,
  heartbeatMs,
  adapters: overrides,
}: SourceRuntimeDeps): {
  service: SourceService;
  statusReader: SourceStatusReader;
  jobs: JobsService;
  lock: JobLock;
} {
  const rss = createRssAdapter({
    http,
    robots: createRobotsCheck({ http, userAgentToken: 'LeadHunterAI', clock }),
    clock,
    timeoutMs: config.fetchTimeoutMs,
    maxAttempts: config.sourceMaxAttempts,
    maxTextChars: config.importMaxTextChars,
    ...(sleep ? { sleep } : {}),
  });
  const bzp = createBzpAdapter({
    http,
    clock,
    timeoutMs: config.fetchTimeoutMs,
    maxAttempts: config.sourceMaxAttempts,
    maxTextChars: config.importMaxTextChars,
    ...(sleep ? { sleep } : {}),
    ...(logger ? { logger } : {}),
  });
  const service = createSourceService({
    repository: createSourceRepository(db),
    signals: createSignalRepository(db),
    // ted joins the registry with its adapter (S-18 Phase 3); until then a stored `ted` source
    // fails with `internal`.
    adapters: { rss, bzp, ...overrides } as SourceAdapters,
    clock,
    minIntervalMs: config.sourceMinIntervalMinutes * 60_000,
    ...(onSignalCreated ? { onSignalCreated } : {}),
    ...(logger ? { logger } : {}),
  });
  const lock = createJobLock({ db, clock, host: hostname(), pid: process.pid, ...jobLock });
  const jobs = createJobsService({
    lock,
    runs: createJobRunRepository(db),
    sources: service,
    clock,
    ...(heartbeatMs === undefined ? {} : { heartbeatMs }),
    ...(logger ? { logger } : {}),
  });
  return { service, statusReader: createSourceStatusReader(db), jobs, lock };
}
