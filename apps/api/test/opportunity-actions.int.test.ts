import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTestApp, FakeClock, loginAsOperator } from './helpers/app.js';

const MOCK = { LLM_PROVIDER: 'mock' };
const SEEKING_WORK = readFileSync(
  fileURLToPath(new URL('./fixtures/llm/synthetic-seeking-work.txt', import.meta.url)),
  'utf8',
).trim();
const INSUFFICIENT = 'DEMO: Potrzebuję strony, krótko, bez szczegółów.';

async function setup() {
  const clock = new FakeClock();
  const built = await buildTestApp({ clock, env: MOCK });
  const cookie = await loginAsOperator(built.app);
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const importText = async (text: string): Promise<number> => {
    const res = await call('POST', '/api/signals/import', { text });
    return res.json().opportunityId as number;
  };
  return { ...built, clock, call, importText };
}

describe('operator actions and history (FR-11 AC2 elements 11, 12)', () => {
  it('saves, notes and rejects with a reason, newest first', async () => {
    const t = await setup();
    const id = await t.importText('DEMO: Szukamy kogoś do zbudowania sklepu internetowego.');

    t.clock.advance(1000);
    const saved = await t.call('POST', `/api/opportunities/${id}/status`, {
      status: 'SAVED',
      note: '  warto wrócić  ',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().businessStatus).toBe('SAVED');

    t.clock.advance(1000);
    const noted = await t.call('POST', `/api/opportunities/${id}/notes`, {
      text: 'Zadzwonić w piątek',
    });
    expect(noted.statusCode).toBe(200);

    t.clock.advance(1000);
    const rejected = await t.call('POST', `/api/opportunities/${id}/status`, {
      status: 'REJECTED',
      reason: 'POOR_FIT',
    });
    expect(rejected.statusCode).toBe(200);

    const detail = (await t.call('GET', `/api/opportunities/${id}`)).json();
    expect(detail.businessStatus).toBe('REJECTED');
    expect(detail.activity).toEqual([
      expect.objectContaining({
        type: 'STATUS_CHANGE',
        actor: 'operator',
        fromStatus: 'SAVED',
        toStatus: 'REJECTED',
        reason: 'POOR_FIT',
        note: null,
        cause: null,
      }),
      expect.objectContaining({ type: 'NOTE', actor: 'operator', note: 'Zadzwonić w piątek' }),
      expect.objectContaining({
        type: 'STATUS_CHANGE',
        fromStatus: 'NEW',
        toStatus: 'SAVED',
        reason: null,
        note: 'warto wrócić',
      }),
    ]);
  });

  it('rejects invalid bodies with 400 and unknown ids with 404', async () => {
    const t = await setup();
    const id = await t.importText('DEMO: Szukamy kogoś do zbudowania sklepu internetowego.');
    const status = (payload: object, target = id) =>
      t.call('POST', `/api/opportunities/${target}/status`, payload);

    expect((await status({ status: 'REJECTED' })).statusCode).toBe(400);
    expect((await status({ status: 'REJECTED', reason: 'OTHER' })).statusCode).toBe(400);
    expect((await status({ status: 'REJECTED', reason: 'OTHER', note: '  ' })).statusCode).toBe(
      400,
    );
    expect((await status({ status: 'WON' })).statusCode).toBe(400);
    expect((await t.call('POST', `/api/opportunities/${id}/notes`, { text: ' ' })).statusCode).toBe(
      400,
    );
    expect((await status({ status: 'SAVED' }, 999)).statusCode).toBe(404);
    expect((await t.call('POST', '/api/opportunities/999/notes', { text: 'x' })).statusCode).toBe(
      404,
    );

    const other = await status({ status: 'REJECTED', reason: 'OTHER', note: 'z innego powodu' });
    expect(other.statusCode).toBe(200);
  });

  it('answers 409 and writes nothing when the move is not allowed', async () => {
    const t = await setup();
    const id = await t.importText('DEMO: Szukamy kogoś do zbudowania sklepu internetowego.');
    await t.call('POST', `/api/opportunities/${id}/status`, {
      status: 'REJECTED',
      reason: 'NO_BUDGET',
    });

    const again = await t.call('POST', `/api/opportunities/${id}/status`, { status: 'SAVED' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'transition_not_allowed' });

    const detail = (await t.call('GET', `/api/opportunities/${id}`)).json();
    expect(detail.businessStatus).toBe('REJECTED');
    expect(detail.activity).toHaveLength(1);
  });

  it('records the pre-filter rejection as a system event with its rule', async () => {
    const t = await setup();
    const id = await t.importText(SEEKING_WORK);
    await t.runner.drain();

    const detail = (await t.call('GET', `/api/opportunities/${id}`)).json();
    expect(detail.businessStatus).toBe('REJECTED');
    expect(detail.activity).toEqual([
      expect.objectContaining({
        actor: 'system',
        type: 'STATUS_CHANGE',
        fromStatus: 'NEW',
        toStatus: 'REJECTED',
        cause: { kind: 'prefilter', rule: 'seeking_work' },
      }),
    ]);
  });

  it('records an insufficient-data move, but not after the operator already moved the status', async () => {
    const t = await setup();
    const waiting = await t.importText(INSUFFICIENT);
    const saved = await t.importText(`${INSUFFICIENT} Drugie.`);
    await t.call('POST', `/api/opportunities/${saved}/status`, { status: 'SAVED' });
    await t.runner.drain();

    const moved = (await t.call('GET', `/api/opportunities/${waiting}`)).json();
    expect(moved.businessStatus).toBe('NEEDS_VERIFICATION');
    expect(moved.activity).toEqual([
      expect.objectContaining({
        actor: 'system',
        toStatus: 'NEEDS_VERIFICATION',
        cause: { kind: 'insufficient_data' },
      }),
    ]);

    const kept = (await t.call('GET', `/api/opportunities/${saved}`)).json();
    expect(kept.businessStatus).toBe('SAVED');
    expect(kept.activity.map((e: { actor: string }) => e.actor)).toEqual(['operator']);
  });
});
