import { describe, expect, it } from 'vitest';
import { HealthResponse } from './health.js';

const valid = {
  status: 'ok',
  version: '0.0.0',
  uptimeSeconds: 3,
  db: { status: 'ok', migrations: 1 },
};

describe('HealthResponse', () => {
  it('accepts the documented shape', () => {
    expect(HealthResponse.safeParse(valid).success).toBe(true);
  });

  it('rejects extra top-level keys so config values cannot leak in', () => {
    expect(HealthResponse.safeParse({ ...valid, dataDir: '/data' }).success).toBe(false);
  });

  it('rejects extra keys inside db', () => {
    expect(HealthResponse.safeParse({ ...valid, db: { ...valid.db, error: 'boom' } }).success).toBe(
      false,
    );
  });

  it('rejects an unknown status', () => {
    expect(HealthResponse.safeParse({ ...valid, status: 'fine' }).success).toBe(false);
  });
});
