import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export interface OpenDb {
  sqlite: Database.Database;
  db: BetterSQLite3Database;
}

export function openDb(file: string): OpenDb {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  return { sqlite, db: drizzle(sqlite) };
}
