import { OperatorProfile } from '@lead-hunter/contracts';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/infrastructure/db/client.js';
import { createProfileRepository } from '../src/infrastructure/db/profile-repository.js';
import { EXAMPLE_PROFILE } from '../src/modules/profile/example.js';
import { buildTestApp, loginAsOperator } from './helpers/app.js';

const edited = (): OperatorProfile => ({
  ...EXAMPLE_PROFILE,
  skills: ['Rust', 'embedded'],
  weeklyHours: 32,
  minimumJobValue: { amountMinor: 200_000, currency: 'PLN' },
  rateRanges: [{ unit: 'HOUR', currency: 'EUR', minMinor: 4_000, maxMinor: 8_000 }],
});

async function setup() {
  const built = await buildTestApp();
  const cookie = await loginAsOperator(built.app);
  const get = async (app = built.app, headers = { cookie }) =>
    app.inject({ method: 'GET', url: '/api/profile', headers });
  const put = async (payload: unknown, app = built.app, headers = { cookie }) =>
    app.inject({ method: 'PUT', url: '/api/profile', headers, payload: payload as object });
  return { ...built, cookie, get, put };
}

describe('operator profile (FR-01)', () => {
  it('seeds the example on a fresh database and a save replaces it (AC1)', async () => {
    const { get, put } = await setup();
    const first = await get();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ profile: EXAMPLE_PROFILE, example: true });

    const saved = await put(edited());
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ profile: edited(), example: false });
    expect((await get()).json()).toMatchObject({ profile: edited(), example: false });
  });

  it('keeps a saved profile after a restart and does not re-seed (AC2)', async () => {
    const { app, put, dir } = await setup();
    expect((await put(edited())).statusCode).toBe(200);
    await app.close();

    const { app: restarted } = await buildTestApp({ dir });
    const cookie2 = await loginAsOperator(restarted);
    const res = await restarted.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { cookie: cookie2 },
    });
    expect(res.json()).toMatchObject({ profile: edited(), example: false });
  });

  const cases: [string, (p: OperatorProfile) => unknown, string][] = [
    ['unknown top-level field', (p) => ({ ...p, extra: 1 }), 'extra'],
    [
      'unknown nested field',
      (p) => ({ ...p, effortSplit: { ...p.effortSplit, extra: 1 } }),
      'effortSplit.extra',
    ],
    [
      'negative amount',
      (p) => ({ ...p, minimumJobValue: { amountMinor: -1, currency: 'PLN' } }),
      'minimumJobValue.amountMinor',
    ],
    [
      'negative rate bound',
      (p) => ({
        ...p,
        rateRanges: [{ unit: 'HOUR', currency: 'PLN', minMinor: -5, maxMinor: 10 }],
      }),
      'rateRanges.0.minMinor',
    ],
    [
      'rate max below min',
      (p) => ({
        ...p,
        rateRanges: [{ unit: 'HOUR', currency: 'PLN', minMinor: 10, maxMinor: 5 }],
      }),
      'rateRanges.0.maxMinor',
    ],
    [
      'effort split not summing to 100',
      (p) => ({ ...p, effortSplit: { directRevenuePercent: 70, productHypothesisPercent: 20 } }),
      'effortSplit',
    ],
  ];

  it.each(cases)('rejects %s and stores nothing (AC3)', async (_name, mutate, path) => {
    const { get, put } = await setup();
    const before = (await get()).json();
    const res = await put(mutate(edited()));
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; fields: { path: string }[] }>();
    expect(body.error).toBe('validation_failed');
    expect(body.fields.map((f) => f.path)).toContain(path);
    expect((await get()).json()).toEqual(before);
  });

  it('shows the same field-level 400 on another route (FR-25 AC1)', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'validation_failed',
      fields: [{ path: 'password', code: 'invalid_type' }],
    });
  });

  it('answers 500 for an unreadable stored profile until a valid PUT fixes it', async () => {
    const { get, put, dir } = await setup();
    const { db, sqlite } = openDb(`${dir}/lead-hunter.db`);
    createProfileRepository(db).upsert({
      data: { nonsense: true },
      isExample: false,
      updatedAt: 0,
      schemaVersion: 1,
    });
    sqlite.close();
    expect((await get()).statusCode).toBe(500);
    expect((await put(edited())).statusCode).toBe(200);
    expect((await get()).statusCode).toBe(200);
  });

  it('keeps the example free of names, rates and amounts (AC4)', () => {
    expect(OperatorProfile.parse(EXAMPLE_PROFILE)).toEqual(EXAMPLE_PROFILE);
    expect(EXAMPLE_PROFILE.rateRanges).toEqual([]);
    expect(EXAMPLE_PROFILE.minimumJobValue).toBeNull();
    expect(EXAMPLE_PROFILE.monthlyRevenueGoal).toBeNull();
    expect(EXAMPLE_PROFILE.experience).toBe('');
  });
});
