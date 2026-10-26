import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type Config } from '@lead-hunter/config';
import type { FastifyInstance } from 'fastify';
import { afterEach } from 'vitest';
import { buildApp, type AppDeps } from '../../src/app.js';
import { hashPassword, verifyPassword } from '../../src/infrastructure/auth/scrypt-password.js';
import { createActivityRepository } from '../../src/infrastructure/db/activity-repository.js';
import { createRunnerState } from '../../src/infrastructure/db/runner-state-repository.js';
import { createAnalysisRepository } from '../../src/infrastructure/db/analysis-repository.js';
import {
  createLlmProvider,
  createOfferDrafter,
  llmRunnerDeps,
  offerDrafterDeps,
} from '../../src/infrastructure/llm/create-provider.js';
import { createOfferService } from '../../src/modules/offers/service.js';
import type { OfferDrafter } from '../../src/modules/offers/ports.js';
import { createOpportunityService } from '../../src/modules/opportunities/service.js';
import {
  createOfferDraftRepository,
  createOfferSourceReader,
} from '../../src/infrastructure/db/offer-draft-repository.js';
import {
  createAnalysisRunner,
  type AnalysisRunner,
  type Sleep,
} from '../../src/modules/analysis/service.js';
import type { LlmProvider, RunnerState } from '../../src/modules/analysis/ports.js';
import { createProfileService } from '../../src/modules/profile/service.js';
import { createPaymentRepository } from '../../src/infrastructure/db/payment-repository.js';
import { createOpportunityRepository } from '../../src/infrastructure/db/opportunity-repository.js';
import { createDigestRepository } from '../../src/infrastructure/db/digest-repository.js';
import { createPipelineRepository } from '../../src/infrastructure/db/pipeline-repository.js';
import { createProfileRepository } from '../../src/infrastructure/db/profile-repository.js';
import { createSignalRepository } from '../../src/infrastructure/db/signal-repository.js';
import { createSessionRepository } from '../../src/infrastructure/db/session-repository.js';
import { randomTokenSource } from '../../src/infrastructure/auth/token-source.js';
import { getGlobalDispatcher } from 'undici';
import { createHttpClient } from '../../src/infrastructure/sources/http/client.js';
import { createPageFetcher } from '../../src/infrastructure/sources/manual/page-fetcher.js';
import { createRobotsCheck } from '../../src/infrastructure/sources/manual/robots.js';
import type { SourceAdapters } from '../../src/modules/sources/ports.js';
import { createSourceRuntime } from '../../src/infrastructure/sources/compose.js';
import type { JobLock } from '../../src/modules/jobs/ports.js';
import type { JobsService } from '../../src/modules/jobs/service.js';
import type { JobLockOptions } from '../../src/infrastructure/scheduler/job-lock.js';
import type { SourceService } from '../../src/modules/sources/service.js';
import type { Clock } from '../../src/modules/auth/ports.js';
import { openDb, type OpenDb } from '../../src/infrastructure/db/client.js';
import { createHealthProbe } from '../../src/infrastructure/db/health-probe.js';
import { runMigrations } from '../../src/infrastructure/db/migrate.js';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lh-test-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A file-backed, migrated database in a temp dir, closed after the test. */
export function openTestDb(existingDir?: string): OpenDb & { dir: string; file: string } {
  const dir = existingDir ?? tempDir();
  const file = join(dir, 'lead-hunter.db');
  const opened = openDb(file);
  cleanups.push(() => void opened.sqlite.close());
  runMigrations(opened.db);
  return { ...opened, dir, file };
}

export const TEST_PASSWORD = 'correct horse battery staple';
const TEST_PARAMS = { ln: 10, r: 8, p: 1 };
let testHash: Promise<string> | undefined;

/** A cheap hash of TEST_PASSWORD, computed once per test file. */
const getTestHash = (): Promise<string> => (testHash ??= hashPassword(TEST_PASSWORD, TEST_PARAMS));

export class FakeClock implements Clock {
  constructor(private current = new Date('2026-01-01T12:00:00Z')) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export async function buildTestApp(
  options: {
    env?: Record<string, string>;
    overrides?: Partial<AppDeps>;
    clock?: Clock;
    /** Run without a configured password hash (D-2). */
    noPassword?: boolean;
    /** Reuse the database in this dir (a restart); the first app's connection stays open. */
    dir?: string;
    /** Replaces the provider chosen by `LLM_PROVIDER`; `null` means none. */
    provider?: LlmProvider | null;
    /** Replaces the offer drafter chosen by `LLM_PROVIDER`; `null` means none. */
    drafter?: OfferDrafter | null;
    /** Kick the runner after every created import, as the server does. Tests drain by hand otherwise. */
    autoKick?: boolean;
    /** Another identity or staleness for the job lock (S-12). */
    jobLock?: Partial<Omit<JobLockOptions, 'db' | 'clock'>>;
    heartbeatMs?: number;
    /** Adapters that replace the real ones, by source type (S-18). */
    adapters?: Partial<SourceAdapters>;
    /** Receives the source service's log lines (S-19). */
    sourceLogger?: { info(message: string): void; warn(message: string): void };
    /** The analysis backoff wait; a no-op unless a test holds it open (S-20). */
    sleep?: Sleep;
    /** Wraps the stored pause flag, to land a cancel at an exact point of the drain. */
    wrapRunnerState?: (real: RunnerState) => RunnerState;
  } = {},
): Promise<{
  app: FastifyInstance;
  config: Config;
  dir: string;
  runner: AnalysisRunner;
  sources: SourceService;
  jobs: JobsService;
  lock: JobLock;
}> {
  const { dir, sqlite, db } = openTestDb(options.dir);
  const config = loadConfig({ DATA_DIR: dir, ...options.env });
  const hash = await getTestHash();
  const clock = options.clock ?? { now: () => new Date() };
  const profileDeps = { repository: createProfileRepository(db), clock };
  const profileService = createProfileService(profileDeps);
  const provider =
    options.provider !== undefined
      ? (options.provider ?? undefined)
      : createLlmProvider(config.llm, { maxRetries: 0 });
  const analysisRepository = createAnalysisRepository(db);
  const runner = createAnalysisRunner({
    repository: analysisRepository,
    provider,
    profile: { get: () => profileService.get().profile },
    clock,
    dailyLimit: config.analysisDailyLimit,
    maxAgeDays: config.prefilterMaxAgeDays,
    ...llmRunnerDeps(config.llm),
    sleep: options.sleep ?? (async () => undefined),
    runnerState: (options.wrapRunnerState ?? ((real) => real))(createRunnerState(db)),
    onError: () => undefined,
  });
  // Pages go through the real fetcher; the global MockAgent answers (nothing leaves the machine).
  const http = createHttpClient({
    userAgent: 'LeadHunterAI/test (+https://example.invalid)',
    maxBytes: config.fetchMaxBytes,
    dispatcher: getGlobalDispatcher(),
  });
  const pageFetcher = createPageFetcher({
    http,
    robots: createRobotsCheck({ http, userAgentToken: 'LeadHunterAI', clock }),
    timeoutMs: config.fetchTimeoutMs,
    maxTextChars: config.importMaxTextChars,
    clock,
  });
  // Feeds go through the same mocked network; the backoff sleep is a no-op so tests do not wait.
  const sourceRuntime = createSourceRuntime({
    db,
    config,
    http,
    clock,
    sleep: async () => undefined,
    ...(options.adapters ? { adapters: options.adapters } : {}),
    ...(options.sourceLogger ? { logger: options.sourceLogger } : {}),
    ...(options.jobLock ? { jobLock: options.jobLock } : {}),
    ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
    ...(options.autoKick ? { onSignalCreated: () => runner.kick() } : {}),
  });
  const opportunityDeps = {
    repository: createOpportunityRepository(db),
    activity: createActivityRepository(db),
    payments: createPaymentRepository(db),
    sourceStatus: sourceRuntime.statusReader,
    clock,
  };
  const drafter =
    options.drafter !== undefined
      ? (options.drafter ?? undefined)
      : createOfferDrafter(config.llm, { maxRetries: 0 });
  const offers = createOfferService({
    repository: createOfferDraftRepository(db),
    sources: createOfferSourceReader(db),
    drafter,
    profile: { get: () => profileService.get().profile },
    activity: opportunityDeps.activity,
    spentSince: (at) => analysisRepository.spentSince(at),
    detail: createOpportunityService(opportunityDeps).get,
    clock,
    dailyLimit: config.offerDraftDailyLimit,
    ...offerDrafterDeps(config.llm),
  });
  const app = await buildApp({
    config,
    healthProbe: createHealthProbe(sqlite),
    version: 'test',
    auth: {
      sessions: createSessionRepository(db),
      ...(options.noPassword ? {} : { verifier: { verify: (pw) => verifyPassword(pw, hash) } }),
      clock: options.clock ?? { now: () => new Date() },
      tokens: randomTokenSource,
    },
    profile: profileDeps,
    signals: { repository: createSignalRepository(db), clock, pageFetcher },
    ...(options.autoKick ? { onSignalCreated: () => runner.kick() } : {}),
    opportunities: opportunityDeps,
    pipeline: { repository: createPipelineRepository(db), clock },
    digest: {
      repository: createDigestRepository(db),
      pipeline: createPipelineRepository(db),
      clock,
    },
    analysis: runner,
    offers,
    sources: sourceRuntime.service,
    jobs: sourceRuntime.jobs,
    schedule: { times: config.discoveryTimes, nextRunAt: () => null },
    ...options.overrides,
  });
  cleanups.push(() => app.close());
  return {
    app,
    config,
    dir,
    runner,
    sources: sourceRuntime.service,
    jobs: sourceRuntime.jobs,
    lock: sourceRuntime.lock,
  };
}

/** Logs in with TEST_PASSWORD and returns the value for a `cookie` request header. */
export async function loginAsOperator(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: TEST_PASSWORD },
  });
  if (res.statusCode !== 204) throw new Error(`login failed: ${res.statusCode}`);
  const cookie = res.cookies[0];
  if (!cookie) throw new Error('no session cookie');
  return `${cookie.name}=${cookie.value}`;
}
