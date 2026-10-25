import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfigOrExit } from './cli/config.js';
import { openDb } from './infrastructure/db/client.js';
import { createHealthProbe } from './infrastructure/db/health-probe.js';
import { runMigrations } from './infrastructure/db/migrate.js';
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

  const app = await buildApp({
    config,
    healthProbe: createHealthProbe(sqlite),
    version: VERSION,
    ...(existsSync(WEB_DIST_DIR) ? { webDistDir: WEB_DIST_DIR } : {}),
    logger: createLoggerOptions(config),
  });

  const shutdown = async (): Promise<void> => {
    await app.close();
    sqlite.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  fail(`Start serwera nie powiódł się: ${error instanceof Error ? error.message : String(error)}`);
});
