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
});
