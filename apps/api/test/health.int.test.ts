import { HealthResponse } from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers/app.js';

describe('GET /api/health (FR-20 AC5)', () => {
  it('answers with exactly the contract keys and applied migrations', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['db', 'status', 'uptimeSeconds', 'version']);
    expect(Object.keys(body.db).sort()).toEqual(['migrations', 'status']);
    expect(HealthResponse.parse(body).db.migrations).toBeGreaterThanOrEqual(1);
    expect(body.status).toBe('ok');
  });

  it('exposes no config values or secrets', async () => {
    const { app, dir } = await buildTestApp({
      env: {
        OPERATOR_PASSWORD_HASH: `scrypt:15:8:3:LEAK-CANARY${'A'.repeat(11)}:${'B'.repeat(43)}`,
        HOST: '0.0.0.0',
      },
    });
    const text = (await app.inject('/api/health')).body;
    expect(text).not.toContain('LEAK-CANARY');
    expect(text).not.toContain(dir);
    expect(text).not.toContain('0.0.0.0');
  });

  it('answers 503 degraded, without error text, when the probe fails', async () => {
    const { app } = await buildTestApp({
      overrides: { healthProbe: { check: () => ({ ok: false, migrations: 0 }) } },
    });
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', db: { status: 'error' } });
  });

  it('answers unknown /api routes with a JSON 404', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});
