import { join, resolve } from 'node:path';
import { loadConfigOrExit } from './config.js';
import { openDb } from '../infrastructure/db/client.js';
import { runMigrations } from '../infrastructure/db/migrate.js';
import { createSqliteBackupStore } from '../infrastructure/backup/sqlite-backup.js';
import { createDataRepository } from '../infrastructure/db/data-repository.js';
import { createDataService } from '../modules/data/service.js';

/** FR-22 AC1 (S-15 D-12): one verified copy into BACKUP_DIR, then the rotation. */
async function main(): Promise<number> {
  const config = loadConfigOrExit();
  const { sqlite, db } = openDb(join(resolve(config.dataDir), 'lead-hunter.db'));
  try {
    runMigrations(db);
    const service = createDataService({
      repository: createDataRepository(db),
      clock: { now: () => new Date() },
      backups: createSqliteBackupStore(sqlite, config.backupDir),
      backupKeep: config.backupKeep,
    });
    const result = await service.backup();
    process.stdout.write(`${result.file} (${result.bytes} B)\n`);
    for (const file of result.removed) process.stdout.write(`usunięto starą kopię ${file}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `kopia zapasowa nie powiodła się: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    sqlite.close();
  }
}

process.exitCode = await main();
