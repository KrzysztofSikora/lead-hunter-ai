import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type Config } from '@lead-hunter/config';
import type { FastifyInstance } from 'fastify';
import { afterEach } from 'vitest';
import { buildApp, type AppDeps } from '../../src/app.js';
import { hashPassword, verifyPassword } from '../../src/infrastructure/auth/scrypt-password.js';
import { createSessionRepository } from '../../src/infrastructure/db/session-repository.js';
import { randomTokenSource } from '../../src/infrastructure/auth/token-source.js';
import type { Clock } from '../../src/modules/auth/ports.js';
import { openDb, type OpenDb } from '../../src/infrastructure/db/client.js';
import { createHealthProbe } from '../../src/infrastructure/db/health-probe.js';
import { runMigrations } from '../../src/infrastructure/db/migrate.js';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lh-test-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A file-backed, migrated database in a temp dir, closed after the test. */
export function openTestDb(): OpenDb & { dir: string; file: string } {
  const dir = tempDir();
  const file = join(dir, 'lead-hunter.db');
  const opened = openDb(file);
  cleanups.push(() => void opened.sqlite.close());
  runMigrations(opened.db);
  return { ...opened, dir, file };
}

export const TEST_PASSWORD = 'correct horse battery staple';
const TEST_PARAMS = { ln: 10, r: 8, p: 1 };
let testHash: Promise<string> | undefined;

/** A cheap hash of TEST_PASSWORD, computed once per test file. */
const getTestHash = (): Promise<string> => (testHash ??= hashPassword(TEST_PASSWORD, TEST_PARAMS));

export class FakeClock implements Clock {
  constructor(private current = new Date('2026-01-01T12:00:00Z')) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export async function buildTestApp(
  options: {
    env?: Record<string, string>;
    overrides?: Partial<AppDeps>;
    clock?: Clock;
    /** Run without a configured password hash (D-2). */
    noPassword?: boolean;
  } = {},
): Promise<{ app: FastifyInstance; config: Config; dir: string }> {
  const { dir, sqlite, db } = openTestDb();
  const config = loadConfig({ DATA_DIR: dir, ...options.env });
  const hash = await getTestHash();
  const app = await buildApp({
    config,
    healthProbe: createHealthProbe(sqlite),
    version: 'test',
    auth: {
      sessions: createSessionRepository(db),
      ...(options.noPassword ? {} : { verifier: { verify: (pw) => verifyPassword(pw, hash) } }),
      clock: options.clock ?? { now: () => new Date() },
      tokens: randomTokenSource,
    },
    ...options.overrides,
  });
  cleanups.push(() => app.close());
  return { app, config, dir };
}

/** Logs in with TEST_PASSWORD and returns the value for a `cookie` request header. */
export async function loginAsOperator(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: TEST_PASSWORD },
  });
  if (res.statusCode !== 204) throw new Error(`login failed: ${res.statusCode}`);
  const cookie = res.cookies[0];
  if (!cookie) throw new Error('no session cookie');
  return `${cookie.name}=${cookie.value}`;
}
