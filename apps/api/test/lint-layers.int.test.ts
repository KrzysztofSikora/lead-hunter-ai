import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const eslint = new ESLint({ cwd: root });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${root}${filePath}` });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

describe('layer rules (TR-23)', () => {
  it('rejects a module importing infrastructure', async () => {
    const ids = await ruleIds(
      "import { openDb } from '../../infrastructure/db/client.js';\nexport const x = openDb;\n",
      'apps/api/src/modules/leads/service.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('rejects a module importing a database driver', async () => {
    const ids = await ruleIds(
      "import Database from 'better-sqlite3';\nexport const x = Database;\n",
      'apps/api/src/modules/leads/service.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('rejects a domain file importing fastify', async () => {
    const ids = await ruleIds(
      "import Fastify from 'fastify';\nexport const x = Fastify;\n",
      'apps/api/src/modules/leads/service.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('rejects app.ts importing infrastructure', async () => {
    const ids = await ruleIds(
      "import { openDb } from './infrastructure/db/client.js';\nexport const x = openDb;\n",
      'apps/api/src/app.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('rejects a web file importing the api package', async () => {
    const ids = await ruleIds(
      "import { buildApp } from '@lead-hunter/api';\nexport const x = buildApp;\n",
      'apps/web/src/App.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('rejects a package importing an app', async () => {
    const ids = await ruleIds(
      "import { buildApp } from '@lead-hunter/api';\nexport const x = buildApp;\n",
      'packages/config/src/index.ts',
    );
    expect(ids).toContain('no-restricted-imports');
  });

  it('allows routes.ts to import fastify', async () => {
    const ids = await ruleIds(
      "import type { FastifyInstance } from 'fastify';\nexport const x = (a: FastifyInstance) => a;\n",
      'apps/api/src/modules/leads/routes.ts',
    );
    expect(ids).not.toContain('no-restricted-imports');
  });

  it('allows server.ts to import infrastructure', async () => {
    const ids = await ruleIds(
      "import { openDb } from './infrastructure/db/client.js';\nexport const x = openDb;\n",
      'apps/api/src/server.ts',
    );
    expect(ids).not.toContain('no-restricted-imports');
  });
});
