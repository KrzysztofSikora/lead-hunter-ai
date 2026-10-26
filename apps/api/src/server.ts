import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfigOrExit } from './cli/config.js';
import { openDb } from './infrastructure/db/client.js';
import { randomTokenSource } from './infrastructure/auth/token-source.js';
import { verifyPassword } from './infrastructure/auth/scrypt-password.js';
import { createActivityRepository } from './infrastructure/db/activity-repository.js';
import { createRunnerState } from './infrastructure/db/runner-state-repository.js';
import { createHostMetrics } from './infrastructure/host/host-metrics.js';
import { createAnalysisRepository } from './infrastructure/db/analysis-repository.js';
import {
  createLlmProvider,
  createOfferDrafter,
  llmRunnerDeps,
  offerDrafterDeps,
} from './infrastructure/llm/create-provider.js';
import { createOfferService } from './modules/offers/service.js';
import { createOpportunityService } from './modules/opportunities/service.js';
import {
  createOfferDraftRepository,
  createOfferSourceReader,
} from './infrastructure/db/offer-draft-repository.js';
import { createAnalysisRunner } from './modules/analysis/service.js';
import { createProfileService } from './modules/profile/service.js';
import { createHealthProbe } from './infrastructure/db/health-probe.js';
import { runMigrations } from './infrastructure/db/migrate.js';
import { createPaymentRepository } from './infrastructure/db/payment-repository.js';
import { createOpportunityRepository } from './infrastructure/db/opportunity-repository.js';
import { createDigestRepository } from './infrastructure/db/digest-repository.js';
import { createPipelineRepository } from './infrastructure/db/pipeline-repository.js';
import { createProfileRepository } from './infrastructure/db/profile-repository.js';
import { createSignalRepository } from './infrastructure/db/signal-repository.js';
import { createSessionRepository } from './infrastructure/db/session-repository.js';
import { createHttpClient } from './infrastructure/sources/http/client.js';
import { createPageFetcher } from './infrastructure/sources/manual/page-fetcher.js';
import { createRobotsCheck } from './infrastructure/sources/manual/robots.js';
import { createSourceRuntime } from './infrastructure/sources/compose.js';
import {
  retryWhileBusy,
  startScheduler,
  type Scheduler,
} from './infrastructure/scheduler/schedule.js';
import { createLoggerOptions } from './infrastructure/logging/logger.js';
import { VERSION } from './version.js';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const WEB_DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');

async function main(): Promise<void> {
  const config = loadConfigOrExit();

  const dataDir = resolve(config.dataDir);
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.W_OK);
  } catch {
    fail(
      `Błąd konfiguracji:\n  DATA_DIR — katalog ${dataDir} nie istnieje lub nie jest zapisywalny`,
    );
  }

  const { sqlite, db } = openDb(join(dataDir, 'lead-hunter.db'));
  try {
    runMigrations(db);
  } catch (error) {
    sqlite.close();
    fail(
      `Migracja bazy danych nie powiodła się: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const hash = config.operatorPasswordHash;
  const clock = { now: () => new Date() };
  const profileDeps = { repository: createProfileRepository(db), clock };
  // The profile row is created by the profile routes at build time; read lazily.
  const profileService = createProfileService(profileDeps);
  let logger: { error: (message: string) => void } = { error: () => undefined };
  let logInfo: (message: string) => void = () => undefined;
  let logWarn: (message: string) => void = () => undefined;
  const analysisRepository = createAnalysisRepository(db);
  const runner = createAnalysisRunner({
    repository: analysisRepository,
    provider: createLlmProvider(config.llm),
    profile: { get: () => profileService.get().profile },
    clock,
    dailyLimit: config.analysisDailyLimit,
    maxAgeDays: config.prefilterMaxAgeDays,
    ...llmRunnerDeps(config.llm),
    runnerState: createRunnerState(db),
    hostMetrics: createHostMetrics(),
    onError: (error) =>
      logger.error(`analysis drain failed: ${error instanceof Error ? error.message : 'error'}`),
  });
  // S-09 D-12: one guarded client for every outbound source request.
  const http = createHttpClient({
    userAgent: `LeadHunterAI/${VERSION} (+https://github.com/KrzysztofSikora/lead-hunter-ai)`,
    maxBytes: config.fetchMaxBytes,
  });
  const pageFetcher = createPageFetcher({
    http,
    robots: createRobotsCheck({ http, userAgentToken: 'LeadHunterAI', clock }),
    timeoutMs: config.fetchTimeoutMs,
    maxTextChars: config.importMaxTextChars,
    clock,
    logger: { info: (message) => logInfo(message), warn: (message) => logWarn(message) },
  });
  const sourceRuntime = createSourceRuntime({
    db,
    config,
    http,
    clock,
    onSignalCreated: () => runner.kick(),
    logger: { info: (message) => logInfo(message), warn: (message) => logWarn(message) },
  });
  const opportunityDeps = {
    repository: createOpportunityRepository(db),
    activity: createActivityRepository(db),
    payments: createPaymentRepository(db),
    sourceStatus: sourceRuntime.statusReader,
    clock,
  };
  const offers = createOfferService({
    repository: createOfferDraftRepository(db),
    sources: createOfferSourceReader(db),
    drafter: createOfferDrafter(config.llm),
    profile: { get: () => profileService.get().profile },
    activity: opportunityDeps.activity,
    spentSince: (at) => analysisRepository.spentSince(at),
    detail: createOpportunityService(opportunityDeps).get,
    clock,
    dailyLimit: config.offerDraftDailyLimit,
    ...offerDrafterDeps(config.llm),
  });
  // The list shows the next slot; the scheduler starts after the app, so it is read lazily.
  const running: { scheduler?: Scheduler } = {};
  const app = await buildApp({
    config,
    healthProbe: createHealthProbe(sqlite),
    version: VERSION,
    auth: {
      sessions: createSessionRepository(db),
      ...(hash ? { verifier: { verify: (password) => verifyPassword(password, hash) } } : {}),
      clock: { now: () => new Date() },
      tokens: randomTokenSource,
    },
    profile: profileDeps,
    signals: { repository: createSignalRepository(db), clock, pageFetcher },
    onSignalCreated: () => runner.kick(),
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
    schedule: {
      times: config.discoveryTimes,
      nextRunAt: () => running.scheduler?.nextRunAt() ?? null,
    },
    ...(existsSync(WEB_DIST_DIR) ? { webDistDir: WEB_DIST_DIR } : {}),
    logger: createLoggerOptions(config),
  });

  logger = app.log;
  logInfo = (message) => app.log.info(message);
  logWarn = (message) => app.log.warn(message);
  // D-2: a lock left by a dead process is freed before this one schedules anything.
  if (sourceRuntime.lock.releaseStale())
    logWarn('released a stale discovery lock (interrupted run)');
  const retries = new Set<() => void>();
  const scheduler = startScheduler({
    times: config.discoveryTimes,
    onSlot: (slot) => {
      const at = new Date(slot).toISOString();
      const slotRetry: { cancel: (() => void) | null } = { cancel: null };
      slotRetry.cancel = retryWhileBusy(
        () => {
          const started = sourceRuntime.jobs.startCycle('schedule', slot);
          if (started.kind === 'busy') {
            logWarn(`scheduled slot ${at}: a run is in progress, trying again`);
            return 'busy';
          }
          if (started.kind === 'slot_taken') logInfo(`slot ${at} already ran`);
          else
            started.done.catch((error: unknown) =>
              logger.error(
                `scheduled cycle failed: ${error instanceof Error ? error.message : 'error'}`,
              ),
            );
          return 'done';
        },
        {
          onGiveUp: () => logWarn(`scheduled slot ${at} skipped: a run stayed in progress`),
          onError: (error) =>
            logger.error(
              `scheduled slot ${at} retry failed: ${error instanceof Error ? error.message : 'error'}`,
            ),
          onSettled: () => {
            if (slotRetry.cancel) retries.delete(slotRetry.cancel);
          },
        },
      );
      if (slotRetry.cancel) retries.add(slotRetry.cancel);
    },
    // D-4: work held back by the daily limit resumes on a later tick.
    analysisTick: () => runner.kick(),
    onError: (error) =>
      logger.error(`scheduler error: ${error instanceof Error ? error.message : 'error'}`),
  });

  running.scheduler = scheduler;

  const shutdown = async (): Promise<void> => {
    scheduler.stop();
    for (const cancel of retries) cancel();
    await app.close();
    // D-3: only a lock this process holds is released; a running cycle is not awaited.
    sourceRuntime.jobs.shutdown(Date.now());
    await runner.idle().catch(() => undefined);
    sqlite.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await app.listen({ host: config.host, port: config.port });
  runner.kick();
}

main().catch((error: unknown) => {
  fail(`Start serwera nie powiódł się: ${error instanceof Error ? error.message : String(error)}`);
});
