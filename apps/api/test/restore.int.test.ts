import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/infrastructure/db/client.js';
import { runMigrations } from '../src/infrastructure/db/migrate.js';
import { createSqliteBackupStore } from '../src/infrastructure/backup/sqlite-backup.js';

const realMigrations = fileURLToPath(new URL('../migrations', import.meta.url));
const journalTags = (folder: string): string[] =>
  (
    JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
      entries: { tag: string }[];
    }
  ).entries.map((e) => e.tag);

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lh-restore-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('restore from a backup (S-15, FR-22 AC2)', () => {
  it('brings back the data of an older schema and applies the missing migrations', async () => {
    // The instance that took the backup ran an older version: migrations 0000–0007 only.
    const old = join(root, 'old-migrations');
    cpSync(realMigrations, old, { recursive: true });
    const journalFile = join(old, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.tag < '0008');
    writeFileSync(journalFile, JSON.stringify(journal));

    mkdirSync(join(root, 'source'));
    const source = openDb(join(root, 'source', 'lead-hunter.db'));
    runMigrations(source.db, old);
    source.sqlite.exec(
      "insert into raw_signals (source_type, title, snippet, fetched_at, availability) values ('rss', 'DEMO restore', 'DEMO', 1000, 'NOT_CHECKED')",
    );
    const { file } = await createSqliteBackupStore(source.sqlite, join(root, 'backups')).write(
      new Date('2026-10-26T01:30:00Z'),
    );
    source.sqlite.close();

    // A new data directory
    // the README moves lead-hunter.db* aside, so only the copied file is present here.
    const restored = join(root, 'restored');
    mkdirSync(restored);
    copyFileSync(file, join(restored, 'lead-hunter.db'));

    const target = openDb(join(restored, 'lead-hunter.db'));
    const before = target.sqlite
      .prepare('select count(*) as n from __drizzle_migrations')
      .get() as {
      n: number;
    };
    expect(before.n).toBe(journalTags(old).length);

    runMigrations(target.db);

    const after = target.sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as {
      n: number;
    };
    expect(after.n).toBe(journalTags(realMigrations).length);
    expect(after.n).toBeGreaterThan(before.n);
    expect(target.sqlite.prepare('select title from raw_signals').all()).toEqual([
      { title: 'DEMO restore' },
    ]);
    // 0013 is the newest migration: its table exists only because the restore migrated.
    expect(journalTags(realMigrations).at(-1)).toBe('0014_small_omega_flight');
    expect(
      target.sqlite
        .prepare("select name from sqlite_master where type = 'table' and name = 'deleted_usage'")
        .all(),
    ).toHaveLength(1);
    target.sqlite.close();
  });
});
