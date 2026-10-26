import { PASSWORD_HASH_PATTERN } from '@lead-hunter/config';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/infrastructure/db/client.js';
import { jobLocks } from '../src/infrastructure/db/schema.js';
import { verifyPassword } from '../src/infrastructure/auth/scrypt-password.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'lh-cli-'));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

function run(entry: string, env: Record<string, string>, input?: string) {
  return spawnSync(process.execPath, ['--conditions=source', '--import', 'tsx', entry], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    ...(input === undefined ? {} : { input }),
    env: { PATH: process.env['PATH'] ?? '', DATA_DIR: dataDir, ...env },
  });
}

describe('command-line entry points', () => {
  it('discover reports that no sources are configured', () => {
    const r = run('src/cli/discover.ts', {});
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('brak skonfigurowanych źródeł');
  });

  it('discover prints "przebieg w toku" and exits 1 while another process holds the lock (D-14)', () => {
    expect(run('src/cli/migrate.ts', {}).status).toBe(0);
    const { sqlite, db } = openDb(join(dataDir, 'lead-hunter.db'));
    // The test process itself: alive, on this host, with a fresh heartbeat.
    db.insert(jobLocks)
      .values({
        name: 'discovery',
        ownerHost: hostname(),
        ownerPid: process.pid,
        ownerToken: 'test-token',
        acquiredAt: Date.now(),
        heartbeatAt: Date.now(),
      })
      .run();
    sqlite.close();

    const r = run('src/cli/discover.ts', {});
    expect(r.status).toBe(1);
    expect(r.stdout.trim()).toBe('przebieg w toku');
  });

  it('db:migrate creates the database file', () => {
    const r = run('src/cli/migrate.ts', {});
    expect(r.status).toBe(0);
    expect(existsSync(join(dataDir, 'lead-hunter.db'))).toBe(true);
  });

  it('backup prints the file it wrote and rotates', () => {
    expect(run('src/cli/migrate.ts', {}).status).toBe(0);
    const r = run('src/cli/backup.ts', {});
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/lead-hunter-\d{8}T\d{6}Z\.db \(\d+ B\)\n$/);
    expect(readdirSync(join(dataDir, 'backups'))).toHaveLength(1);
  });

  it('backup exits 1 with a message when the directory cannot be created', () => {
    writeFileSync(join(dataDir, 'blocker'), 'x');
    const r = run('src/cli/backup.ts', { BACKUP_DIR: join(dataDir, 'blocker', 'sub') });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('kopia zapasowa nie powiodła się');
  });

  it('backup exits 1 and creates nothing when there is no database', () => {
    const r = run('src/cli/backup.ts', {});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('brak bazy');
    expect(existsSync(join(dataDir, 'lead-hunter.db'))).toBe(false);
  });

  it('the server refuses an invalid PORT and names it', () => {
    const r = run('src/server.ts', { PORT: 'abc' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('PORT');
  });

  it('the server refuses 0.0.0.0 without a password hash (FR-23 AC4)', () => {
    const r = run('src/server.ts', { HOST: '0.0.0.0' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('OPERATOR_PASSWORD_HASH');
  });

  it('auth:hash prints one hash line for a piped password and does not touch the config', async () => {
    const r = run('src/cli/auth-hash.ts', { PORT: 'abc' }, 'a long enough password\n');
    expect(r.status).toBe(0);
    const lines = r.stdout.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(PASSWORD_HASH_PATTERN);
    expect(await verifyPassword('a long enough password', lines[0] ?? '')).toBe(true);
  });

  it('auth:hash refuses a password shorter than 12 characters', () => {
    const r = run('src/cli/auth-hash.ts', {}, 'short\n');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('12');
  });
});
