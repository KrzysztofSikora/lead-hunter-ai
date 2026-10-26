import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { DataExport } from '@lead-hunter/contracts';
import { EXPORT_COLUMNS, WITHHELD_TABLES } from '../src/infrastructure/db/data-repository.js';
import * as schema from '../src/infrastructure/db/schema.js';
import { sources } from '../src/infrastructure/db/schema.js';
import { EXAMPLE_PROFILE } from '../src/modules/profile/example.js';
import {
  buildTestApp,
  FakeClock,
  loginAsOperator,
  openTestDb,
  TEST_PASSWORD,
} from './helpers/app.js';

const POST =
  'DEMO: Szukamy programisty TypeScript do narzędzia wewnętrznego, zapłacimy za wykonanie. Budżet 6000-9000 PLN, kontakt przez portal.';
const URL_A = 'https://example.com/ogloszenie/1';
const CANARY = 'sk-LEAK-CANARY';

async function setup(clock = new FakeClock(new Date('2026-10-25T23:30:00Z'))) {
  const built = await buildTestApp({
    clock,
    env: { LLM_PROVIDER: 'mock', LLM_API_KEY: CANARY },
  });
  const cookie = await loginAsOperator(built.app);
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  return { ...built, cookie, call };
}

describe('GET /api/export (FR-21 AC2)', () => {
  it('exports every table with ISO times, integer money and no source secrets', async () => {
    const t = await setup();
    const profile = { ...EXAMPLE_PROFILE, skills: ['DEMO eksport'] };
    expect((await t.call('PUT', '/api/profile', profile)).statusCode).toBe(200);
    const imported = await t.call('POST', '/api/signals/import', { text: POST, url: URL_A });
    const id = imported.json<{ opportunityId: number }>().opportunityId;
    await t.call('POST', '/api/signals/import', {
      text: 'Inna treść tego samego ogłoszenia',
      url: URL_A,
    });
    await t.runner.drain();
    await t.call('POST', `/api/opportunities/${id}/status`, { status: 'SAVED' });
    expect(
      (await t.call('POST', `/api/opportunities/${id}/notes`, { text: 'DEMO notatka' })).statusCode,
    ).toBe(200);
    await t.call('POST', `/api/opportunities/${id}/payments`, {
      amountMinor: 123_456,
      currency: 'PLN',
      paidOn: '2026-01-01',
    });
    expect((await t.call('POST', `/api/opportunities/${id}/offer-drafts`)).statusCode).toBe(201);
    const { db } = openTestDb(t.dir);
    db.insert(sources)
      .values({
        type: 'RSS',
        name: 'DEMO feed',
        configJson: '{"url":"https://example.com/feed.xml"}',
        configKey: 'https://example.com/feed.xml',
        cursorJson: '{"seen":["cursor-canary"]}',
        lastErrorReason: 'error-canary',
        lastErrorStatus: 500,
        lastErrorAt: 5,
        nextAllowedAt: 6,
        createdAt: Date.UTC(2026, 0, 1),
        updatedAt: Date.UTC(2026, 0, 2),
      })
      .run();

    const res = await t.call('GET', '/api/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="lead-hunter-export-2026-10-26.json"',
    );
    const body = DataExport.parse(res.json());
    expect(body).toMatchObject({
      format: 'lead-hunter-export',
      version: 1,
      exportedAt: '2026-10-25T23:30:00.000Z',
    });
    expect(body.profile).toMatchObject({ isExample: false, data: { skills: ['DEMO eksport'] } });
    expect(body.signals).toHaveLength(1);
    expect(body.opportunities).toHaveLength(1);
    expect(body.opportunities[0]).toMatchObject({ id, businessStatus: 'OFFER_DRAFTED' });
    expect(body.evidence).toHaveLength(2);
    expect(body.analyses.length).toBeGreaterThan(0);
    expect(body.analyses[0]).toMatchObject({ opportunityId: id });
    expect(typeof (body.analyses[0] as { result: unknown }).result).toBe('object');
    expect(body.offerDrafts).toHaveLength(1);
    expect(body.events.map((e) => (e as { type: string }).type)).toEqual(
      expect.arrayContaining(['STATUS_CHANGE', 'NOTE']),
    );
    expect(body.payments).toEqual([
      expect.objectContaining({ amountMinor: 123_456, currency: 'PLN', opportunityId: id }),
    ]);
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect((body.opportunities[0] as { createdAt: string }).createdAt).toMatch(iso);
    expect((body.payments[0] as { paidAt: string }).paidAt).toMatch(iso);
    expect(body.sources).toHaveLength(1);
    const source = body.sources[0] as Record<string, unknown>;
    expect(source).toMatchObject({
      name: 'DEMO feed',
      config: { url: 'https://example.com/feed.xml' },
    });
    for (const key of [
      'cursorJson',
      'cursor',
      'lastErrorReason',
      'lastErrorStatus',
      'lastErrorAt',
      'nextAllowedAt',
    ]) {
      expect(source, key).not.toHaveProperty(key);
    }
    expect(res.body).not.toContain('cursor-canary');
    expect(res.body).not.toContain('error-canary');
  });

  it('contains no secret (TR-12)', async () => {
    const t = await setup();
    await t.call('POST', '/api/signals/import', { text: POST });
    const res = await t.call('GET', '/api/export');
    const cookieValue = t.cookie.split('=')[1] as string;
    for (const secret of [CANARY, TEST_PASSWORD, cookieValue, 'scrypt']) {
      expect(res.body, secret).not.toContain(secret);
    }
  });

  it('exports an empty instance as empty lists', async () => {
    const t = await setup();
    const body = DataExport.parse((await t.call('GET', '/api/export')).json());
    expect(body.opportunities).toEqual([]);
    expect(body.payments).toEqual([]);
  });

  it('needs a session', async () => {
    const t = await setup();
    expect((await t.app.inject({ method: 'GET', url: '/api/export' })).statusCode).toBe(401);
  });
});

describe('export column allowlist (D-8, TR-12)', () => {
  const tables = (Object.values(schema) as unknown[]).filter((value): value is SQLiteTable =>
    is(value, SQLiteTable),
  );

  it('classifies every table and every column, so a new column fails until someone decides', () => {
    const known = new Set([...Object.keys(EXPORT_COLUMNS), ...WITHHELD_TABLES]);
    expect(tables.map(getTableName).filter((name) => !known.has(name))).toEqual([]);
    for (const table of tables) {
      const spec = EXPORT_COLUMNS[getTableName(table)];
      if (!spec) continue;
      const columns = Object.keys(getTableColumns(table)).sort();
      expect([...spec.exported, ...spec.withheld].sort(), getTableName(table)).toEqual(columns);
      expect(spec.exported.filter((key) => spec.withheld.includes(key))).toEqual([]);
    }
    expect(
      [...known].filter((name) => !tables.some((table) => getTableName(table) === name)),
    ).toEqual([]);
  });
});
