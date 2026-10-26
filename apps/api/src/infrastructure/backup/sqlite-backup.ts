import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BackupStore } from '../../modules/data/ports.js';

const COPY = /^lead-hunter-\d{8}T\d{6}Z\.db$/;
const PARTIAL = /^lead-hunter-\d{8}T\d{6}Z\.db\.partial$/;
/** A `.partial` this young may belong to a backup still running in another process. */
const PARTIAL_MIN_AGE_MS = 10 * 60_000;
/** One step for the whole copy: another connection writing between steps would restart it. */
const ALL_PAGES = 1 << 30;

export function backupFileName(at: Date): string {
  const stamp = at.toISOString().replace(/[-:]|\.\d{3}/g, '');
  return `lead-hunter-${stamp}.db`;
}

/** S-15 D-6: online copy, checked, then renamed; only matching names are ever rotated away. */
export function createSqliteBackupStore(sqlite: Database.Database, dir: string): BackupStore {
  return {
    async write(at) {
      mkdirSync(dir, { recursive: true });
      const target = join(dir, backupFileName(at));
      if (existsSync(target)) throw new Error(`kopia ${target} już istnieje`);
      const partial = `${target}.partial`;
      try {
        await sqlite.backup(partial, { progress: () => ALL_PAGES });
        // A self-contained single file: no -wal/-shm to move along when restoring.
        const copy = new Database(partial);
        try {
          copy.pragma('journal_mode = DELETE');
          const verdict = copy.pragma('quick_check', { simple: true });
          if (verdict !== 'ok') throw new Error(`quick_check: ${String(verdict)}`);
        } finally {
          copy.close();
        }
        renameSync(partial, target);
        return { file: target, bytes: statSync(target).size };
      } catch (error) {
        rmSync(partial, { force: true });
        rmSync(`${partial}-wal`, { force: true });
        rmSync(`${partial}-shm`, { force: true });
        throw error;
      }
    },

    prune(keep) {
      const names = readdirSync(dir);
      const now = Date.now();
      for (const name of names.filter((n) => PARTIAL.test(n))) {
        const path = join(dir, name);
        if (now - statSync(path).mtimeMs > PARTIAL_MIN_AGE_MS) rmSync(path, { force: true });
      }
      const removed = names
        .filter((n) => COPY.test(n))
        .sort()
        .reverse()
        .slice(keep);
      for (const name of removed) rmSync(join(dir, name), { force: true });
      return removed.map((name) => join(dir, name));
    },
  };
}
