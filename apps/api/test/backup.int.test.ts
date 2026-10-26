import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/infrastructure/db/client.js';
import { runMigrations } from '../src/infrastructure/db/migrate.js';
import {
  backupFileName,
  createSqliteBackupStore,
} from '../src/infrastructure/backup/sqlite-backup.js';
import { createDataService } from '../src/modules/data/service.js';
import { createDataRepository } from '../src/infrastructure/db/data-repository.js';

let root: string;
let opened: ReturnType<typeof openDb>;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lh-backup-'));
  opened = openDb(join(root, 'lead-hunter.db'));
  runMigrations(opened.db);
  dir = join(root, 'backups');
});
afterEach(() => {
  opened.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);
const insertMeta = (sqlite: Database.Database, n: number) =>
  sqlite.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run(`k${n}`, 'DEMO');

describe('createSqliteBackupStore', () => {
  it('names the copy by its UTC time', () => {
    expect(backupFileName(at('2026-10-26T01:30:05.123Z'))).toBe('lead-hunter-20261026T013005Z.db');
  });

  it('writes a verified, self-contained copy with every row committed before it started', async () => {
    for (let n = 0; n < 50; n++) insertMeta(opened.sqlite, n);
    const store = createSqliteBackupStore(opened.sqlite, dir);
    const { file, bytes } = await store.write(at('2026-10-26T01:30:00Z'));
    expect(bytes).toBeGreaterThan(0);
    expect(readdirSync(dir)).toEqual(['lead-hunter-20261026T013000Z.db']);

    const copy = new Database(file, { readonly: true });
    expect(copy.pragma('quick_check', { simple: true })).toBe('ok');
    expect(copy.pragma('journal_mode', { simple: true })).toBe('delete');
    expect(copy.prepare('SELECT count(*) AS n FROM app_meta').get()).toEqual({ n: 50 });
    copy.close();
  });

  it('copies a database another connection keeps writing to (bounded writer, plan-review #1)', async () => {
    for (let n = 0; n < 20; n++) insertMeta(opened.sqlite, n);
    const writer = new Database(join(root, 'lead-hunter.db'));
    writer.pragma('busy_timeout = 5000');
    const store = createSqliteBackupStore(opened.sqlite, dir);
    const pending = store.write(at('2026-10-26T01:30:00Z'));
    for (let n = 100; n < 150; n++) insertMeta(writer, n);
    writer.close();
    const { file } = await pending;

    const copy = new Database(file, { readonly: true });
    expect(copy.pragma('quick_check', { simple: true })).toBe('ok');
    const { n } = copy.prepare('SELECT count(*) AS n FROM app_meta').get() as { n: number };
    // Everything committed before write() started is there; later commits may or may not be.
    expect(n).toBeGreaterThanOrEqual(20);
    expect(n).toBeLessThanOrEqual(70);
    copy.close();
  });

  it('refuses to overwrite a copy of the same second and leaves it alone', async () => {
    const store = createSqliteBackupStore(opened.sqlite, dir);
    const first = await store.write(at('2026-10-26T01:30:00Z'));
    await expect(store.write(at('2026-10-26T01:30:00.500Z'))).rejects.toThrow('już istnieje');
    expect(readdirSync(dir)).toEqual([first.file.split('/').pop()]);
  });

  it('leaves no .partial behind when the copy cannot be written', async () => {
    writeFileSync(join(root, 'not-a-dir'), 'x');
    const store = createSqliteBackupStore(opened.sqlite, join(root, 'not-a-dir', 'sub'));
    await expect(store.write(at('2026-10-26T01:30:00Z'))).rejects.toThrow();
    expect(readdirSync(root).filter((n) => n.includes('partial'))).toEqual([]);
  });

  it('keeps the newest N named copies and touches nothing else', () => {
    mkdirSync(join(dir, '2026-10-01-0830'), { recursive: true });
    writeFileSync(join(dir, '2026-10-01-0830', 'lead-hunter.db'), 'cold copy');
    writeFileSync(join(dir, 'notes.txt'), 'mine');
    writeFileSync(join(dir, 'lead-hunter-20260101T000000Z.db.bak'), 'mine too');
    for (let day = 1; day <= 16; day++) {
      const name = `lead-hunter-202610${String(day).padStart(2, '0')}T013000Z.db`;
      writeFileSync(join(dir, name), 'x');
    }
    const stale = join(dir, 'lead-hunter-20260901T013000Z.db.partial');
    const fresh = join(dir, 'lead-hunter-20261020T013000Z.db.partial');
    writeFileSync(stale, 'x');
    writeFileSync(fresh, 'x');
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(stale, old, old);

    const removed = createSqliteBackupStore(opened.sqlite, dir).prune(14);

    expect(removed.map((p) => p.split('/').pop())).toEqual([
      'lead-hunter-20261002T013000Z.db',
      'lead-hunter-20261001T013000Z.db',
    ]);
    const left = readdirSync(dir).sort();
    expect(left.filter((n) => /^lead-hunter-\d{8}T\d{6}Z\.db$/.test(n))).toHaveLength(14);
    expect(left).toContain('2026-10-01-0830');
    expect(left).toContain('notes.txt');
    expect(left).toContain('lead-hunter-20260101T000000Z.db.bak');
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});

describe('DataService.runDaily', () => {
  const logs: string[] = [];
  const build = (store = createSqliteBackupStore(opened.sqlite, dir)) =>
    createDataService({
      repository: createDataRepository(opened.db),
      clock: { now: () => at('2026-10-26T01:30:00Z') },
      backups: store,
      backupKeep: 14,
      logger: { info: (m) => logs.push(`info ${m}`), error: (m) => logs.push(`error ${m}`) },
    });
  beforeEach(() => (logs.length = 0));

  it('logs the file, its size and the removed copies', async () => {
    await build().runDaily();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(
      /^info backup: .*lead-hunter-20261026T013000Z\.db \(\d+ B\), removed 0 old copies$/,
    );
  });

  it('never rejects: a failing store is logged', async () => {
    const throwing = {
      write: () => Promise.reject(new Error('disk full')),
      prune: () => {
        throw new Error('unused');
      },
    };
    await expect(build(throwing).runDaily()).resolves.toBeUndefined();
    expect(logs).toEqual(['error backup failed: disk full']);
  });

  it('a failing rotation is logged and the written copy still counts', async () => {
    const real = createSqliteBackupStore(opened.sqlite, dir);
    const store = {
      write: real.write,
      prune: () => {
        throw new Error('EACCES');
      },
    };
    const result = await build(store).backup();
    expect(result.removed).toEqual([]);
    expect(logs).toEqual(['error backup rotation failed: EACCES']);
    expect(existsSync(result.file)).toBe(true);
  });
});
