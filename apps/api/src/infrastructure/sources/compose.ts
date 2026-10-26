import type { Config } from '@lead-hunter/config';
import type { OperatorProfile } from '@lead-hunter/contracts';
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
import { createGithubApi } from './github/api.js';
import { createGithubAdapter } from './github/adapter.js';
import { createTedAdapter } from './ted/adapter.js';
import { createRssAdapter } from './rss/adapter.js';

export interface SourceRuntimeDeps {
  db: BetterSQLite3Database;
  config: Pick<
    Config,
    | 'fetchTimeoutMs'
    | 'importMaxTextChars'
    | 'sourceMinIntervalMinutes'
    | 'sourceMaxAttempts'
    | 'github'
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
  /** S-19 D-20: the profile reader for the default languages of a GitHub source; the CLI passes none. */
  profile?: { get(): OperatorProfile };
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
  profile,
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
  const ted = createTedAdapter({
    http,
    clock,
    timeoutMs: config.fetchTimeoutMs,
    maxAttempts: config.sourceMaxAttempts,
    maxTextChars: config.importMaxTextChars,
    ...(sleep ? { sleep } : {}),
    ...(logger ? { logger } : {}),
  });
  // S-19 D-5: one instance, so the request spacing holds across the bounty adapters.
  const githubApi = createGithubApi({
    http,
    clock,
    token: config.github.token,
    timeoutMs: config.fetchTimeoutMs,
    maxAttempts: config.sourceMaxAttempts,
    ...(sleep ? { sleep } : {}),
  });
  const github = createGithubAdapter({
    api: githubApi,
    maxTextChars: config.importMaxTextChars,
    ...(logger ? { logger } : {}),
  });
  const service = createSourceService({
    repository: createSourceRepository(db),
    signals: createSignalRepository(db),
    adapters: { rss, bzp, ted, github, ...overrides } as SourceAdapters,
    clock,
    minIntervalMs: config.sourceMinIntervalMinutes * 60_000,
    ...(profile ? { profile } : {}),
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
