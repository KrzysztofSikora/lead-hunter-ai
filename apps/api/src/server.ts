import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfigOrExit } from './cli/config.js';
import { openDb } from './infrastructure/db/client.js';
import { randomTokenSource } from './infrastructure/auth/token-source.js';
import { verifyPassword } from './infrastructure/auth/scrypt-password.js';
import { createAnalysisRepository } from './infrastructure/db/analysis-repository.js';
import { MockProvider } from './infrastructure/llm/mock.js';
import { createAnalysisRunner } from './modules/analysis/service.js';
import { createProfileService } from './modules/profile/service.js';
import { createHealthProbe } from './infrastructure/db/health-probe.js';
import { runMigrations } from './infrastructure/db/migrate.js';
import { createOpportunityRepository } from './infrastructure/db/opportunity-repository.js';
import { createProfileRepository } from './infrastructure/db/profile-repository.js';
import { createSignalRepository } from './infrastructure/db/signal-repository.js';
import { createSessionRepository } from './infrastructure/db/session-repository.js';
import { noSourcesYet } from './infrastructure/sources/source-status.js';
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
  const runner = createAnalysisRunner({
    repository: createAnalysisRepository(db),
    provider: config.llmProvider === 'mock' ? new MockProvider() : undefined,
    profile: { get: () => profileService.get().profile },
    clock,
    dailyLimit: config.analysisDailyLimit,
    maxAgeDays: config.prefilterMaxAgeDays,
    onError: (error) =>
      logger.error(`analysis drain failed: ${error instanceof Error ? error.message : 'error'}`),
  });
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
    signals: { repository: createSignalRepository(db), clock },
    onSignalCreated: () => runner.kick(),
    opportunities: { repository: createOpportunityRepository(db), sourceStatus: noSourcesYet },
    ...(existsSync(WEB_DIST_DIR) ? { webDistDir: WEB_DIST_DIR } : {}),
    logger: createLoggerOptions(config),
  });

  logger = app.log;
  const ANALYSIS_INTERVAL_MS = 10 * 60_000;
  // D-4: work held back by the daily limit resumes on a later tick; S-12 replaces this timer.
  const timer = setInterval(() => runner.kick(), ANALYSIS_INTERVAL_MS);
  timer.unref();

  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    await runner.idle().catch(() => undefined);
    await app.close();
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
