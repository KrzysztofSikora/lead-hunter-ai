import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/infrastructure/db/client.js';
import { runMigrations } from '../src/infrastructure/db/migrate.js';
import { appMeta } from '../src/infrastructure/db/schema.js';
import { openTestDb } from './helpers/app.js';

const tables = (sqlite: ReturnType<typeof openTestDb>['sqlite']): string[] =>
  (
    sqlite.prepare("select name from sqlite_master where type = 'table'").all() as {
      name: string;
    }[]
  )
    .map((r) => r.name)
    .sort();

describe('database and migrations (TR-20)', () => {
  it('creates app_meta and the migration journal on a fresh file', () => {
    const { sqlite } = openTestDb();
    expect(tables(sqlite)).toEqual(expect.arrayContaining(['__drizzle_migrations', 'app_meta']));
  });

  it('is a no-op to migrate twice', () => {
    const { sqlite, db } = openTestDb();
    const count = () =>
      (sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number }).n;
    const before = count();
    runMigrations(db);
    expect(count()).toBe(before);
  });

  it('keeps data across close and reopen', () => {
    const { sqlite, db, file } = openTestDb();
    db.insert(appMeta).values({ key: 'k', value: 'v' }).run();
    sqlite.close();
    const reopened = openDb(file);
    const rows = reopened.db.select().from(appMeta).all();
    expect(rows).toEqual([{ key: 'k', value: 'v' }]);
    expect(reopened.db.get(sql`pragma foreign_keys`)).toEqual({ foreign_keys: 1 });
    reopened.sqlite.close();
  });

  it('upgrades 0007 data to 0008 and keeps the new columns empty (S-12)', () => {
    const real = fileURLToPath(new URL('../migrations', import.meta.url));
    const old = mkdtempSync(join(tmpdir(), 'lh-mig-'));
    try {
      cpSync(real, old, { recursive: true });
      const journalFile = join(old, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as {
        entries: { tag: string }[];
      };
      journal.entries = journal.entries.filter((entry) => !entry.tag.startsWith('0008'));
      writeFileSync(journalFile, JSON.stringify(journal));

      const dir = mkdtempSync(join(tmpdir(), 'lh-db-'));
      const { sqlite, db } = openDb(join(dir, 'lead-hunter.db'));
      runMigrations(db, old);
      sqlite.exec(
        "insert into job_runs (job_type, status, started_at) values ('source_run', 'ok', 1000)",
      );
      sqlite.exec(
        "insert into raw_signals (source_type, title, snippet, fetched_at, availability) values ('rss', 'DEMO', 'DEMO', 1000, 'NOT_CHECKED')",
      );

      runMigrations(db);
      expect(
        sqlite.prepare('select trigger, parent_run_id, scheduled_for, skipped from job_runs').all(),
      ).toEqual([{ trigger: null, parent_run_id: null, scheduled_for: null, skipped: 0 }]);
      expect(sqlite.prepare('select job_run_id from raw_signals').all()).toEqual([
        { job_run_id: null },
      ]);
      expect(tables(sqlite)).toContain('job_locks');
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    } finally {
      rmSync(old, { recursive: true, force: true });
    }
  });
});
