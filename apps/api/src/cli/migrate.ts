import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../infrastructure/db/client.js';
import { runMigrations } from '../infrastructure/db/migrate.js';
import { createHealthProbe } from '../infrastructure/db/health-probe.js';
import { loadConfigOrExit } from './config.js';

const config = loadConfigOrExit();
mkdirSync(config.dataDir, { recursive: true });
const { sqlite, db } = openDb(join(config.dataDir, 'lead-hunter.db'));
try {
  runMigrations(db);
  const { migrations } = createHealthProbe(sqlite).check();
  process.stdout.write(`Migracje zastosowane: ${migrations}\n`);
} finally {
  sqlite.close();
}
