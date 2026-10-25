import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type Config } from '@lead-hunter/config';
import type { FastifyInstance } from 'fastify';
import { afterEach } from 'vitest';
import { buildApp, type AppDeps } from '../../src/app.js';
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

export async function buildTestApp(
  options: { env?: Record<string, string>; overrides?: Partial<AppDeps> } = {},
): Promise<{ app: FastifyInstance; config: Config; dir: string }> {
  const { dir, sqlite } = openTestDb();
  const config = loadConfig({ DATA_DIR: dir, ...options.env });
  const app = await buildApp({
    config,
    healthProbe: createHealthProbe(sqlite),
    version: 'test',
    ...options.overrides,
  });
  cleanups.push(() => app.close());
  return { app, config, dir };
}
