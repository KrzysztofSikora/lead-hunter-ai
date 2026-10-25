import { fileURLToPath } from 'node:url';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

// `src/infrastructure/db` and `dist/infrastructure/db` are both three levels below the package.
const DEFAULT_FOLDER = fileURLToPath(new URL('../../../migrations', import.meta.url));

export function runMigrations(db: BetterSQLite3Database, folder = DEFAULT_FOLDER): void {
  migrate(db, { migrationsFolder: folder });
}
