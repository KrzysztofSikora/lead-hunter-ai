import { join, resolve } from 'node:path';
import { loadConfigOrExit } from './config.js';
import { openDb } from '../infrastructure/db/client.js';
import { runMigrations } from '../infrastructure/db/migrate.js';
import { createHttpClient } from '../infrastructure/sources/http/client.js';
import { createSourceRuntime } from '../infrastructure/sources/compose.js';
import { VERSION } from '../version.js';

/** D-16: run every enabled source once, through the same service and claim as the web app. */
async function main(): Promise<number> {
  const config = loadConfigOrExit();
  const { sqlite, db } = openDb(join(resolve(config.dataDir), 'lead-hunter.db'));
  try {
    runMigrations(db);
    const { service } = createSourceRuntime({
      db,
      config,
      http: createHttpClient({
        userAgent: `LeadHunterAI/${VERSION} (+https://github.com/KrzysztofSikora/lead-hunter-ai)`,
        maxBytes: config.fetchMaxBytes,
      }),
      clock: { now: () => new Date() },
      logger: { info: () => undefined, warn: () => undefined },
    });
    const results = await service.runEnabled();
    if (results.length === 0) {
      process.stdout.write('brak skonfigurowanych źródeł\n');
      return 0;
    }
    let failed = false;
    for (const { name, outcome } of results) {
      if (outcome.kind !== 'done') {
        const why =
          outcome.kind === 'too_soon'
            ? `pominięte, następna próba po ${outcome.nextAllowedAt}`
            : `pominięte (${outcome.kind})`;
        process.stdout.write(`${name}: ${why}\n`);
        continue;
      }
      const { result } = outcome;
      if (result.status === 'failed') {
        failed = true;
        const status = result.error?.httpStatus === undefined ? '' : ` ${result.error.httpStatus}`;
        process.stdout.write(`${name}: błąd ${result.error?.reason ?? 'internal'}${status}\n`);
      } else {
        process.stdout.write(
          `${name}: nowe ${result.new}, duplikaty ${result.duplicates}, pominięte ${result.failed}\n`,
        );
      }
    }
    return failed ? 1 : 0;
  } finally {
    sqlite.close();
  }
}

process.exitCode = await main();
