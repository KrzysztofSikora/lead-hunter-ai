import { describe, expect, it } from 'vitest';
import { buildTestApp, FakeClock, loginAsOperator } from './helpers/app.js';

const POST = 'DEMO: Szukamy kogoś do zbudowania sklepu internetowego.';

async function setup() {
  const clock = new FakeClock();
  const built = await buildTestApp({ clock, env: { LLM_PROVIDER: 'mock' } });
  const cookie = await loginAsOperator(built.app);
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const importText = async (text: string): Promise<number> =>
    (await call('POST', '/api/signals/import', { text })).json().opportunityId as number;
  return { ...built, clock, call, importText };
}

describe('pipeline status moves (FR-14 AC1–AC3)', () => {
  it('walks NEW → SAVED → CONTACTED → WON, recording skipped stages and the contract', async () => {
    const t = await setup();
    const id = await t.importText(POST);
    await t.runner.drain();
    const move = (payload: object) => t.call('POST', `/api/opportunities/${id}/status`, payload);
    const before = (await t.call('GET', `/api/opportunities/${id}`)).json();

    t.clock.advance(1000);
    expect((await move({ status: 'SAVED' })).statusCode).toBe(200);
    t.clock.advance(1000);
    const contacted = await move({ status: 'CONTACTED', note: 'napisałem mail' });
    expect(contacted.statusCode).toBe(200);
    expect(contacted.json().businessStatus).toBe('CONTACTED');
    expect(contacted.json().analysisStatus).toBe(before.analysisStatus);

    t.clock.advance(1000);
    const contract = {
      valueMinor: 450_000,
      currency: 'PLN',
      expectedStartOn: '2026-02-01',
      expectedEndOn: '2026-03-01',
    };
    const won = await move({ status: 'WON', contract });
    expect(won.statusCode).toBe(200);
    expect(won.json().analysisStatus).toBe(before.analysisStatus);

    const detail = won.json();
    expect(detail.businessStatus).toBe('WON');
    expect(detail.activity.map((e: { toStatus: string }) => e.toStatus).slice(0, 3)).toEqual([
      'WON',
      'CONTACTED',
      'SAVED',
    ]);
    expect(detail.activity[0]).toMatchObject({ contract, skipped: [] });
    expect(detail.activity[1]).toMatchObject({
      fromStatus: 'SAVED',
      toStatus: 'CONTACTED',
      note: 'napisałem mail',
      skipped: ['OFFER_DRAFTED'],
      contract: null,
    });
    // Leaving the status the analysis left (NEEDS_VERIFICATION for the mock) is a forward move.
    expect(detail.activity[2]).toMatchObject({ fromStatus: before.businessStatus, skipped: [] });
  });

  it('records QUALIFIED as skipped when the operator saves a NEW row', async () => {
    const t = await setup();
    const id = await t.importText(POST);
    const saved = await t.call('POST', `/api/opportunities/${id}/status`, { status: 'SAVED' });
    expect(saved.json().activity[0]).toMatchObject({ fromStatus: 'NEW', skipped: ['QUALIFIED'] });
  });

  it('refuses WON before contact and moves back only with a note', async () => {
    const t = await setup();
    const id = await t.importText(POST);
    const move = (payload: object) => t.call('POST', `/api/opportunities/${id}/status`, payload);
    await move({ status: 'SAVED' });

    const early = await move({ status: 'WON' });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toEqual({ error: 'transition_not_allowed' });
    expect((await move({ status: 'NEW' })).statusCode).toBe(400);

    await move({ status: 'CONTACTED' });
    const noNote = await move({ status: 'SAVED' });
    expect(noNote.statusCode).toBe(409);
    expect(noNote.json()).toEqual({ error: 'note_required' });
    let detail = (await t.call('GET', `/api/opportunities/${id}`)).json();
    expect(detail.businessStatus).toBe('CONTACTED');

    const withNote = await move({ status: 'SAVED', note: 'klient poprosił o czas' });
    expect(withNote.statusCode).toBe(200);
    detail = withNote.json();
    expect(detail.businessStatus).toBe('SAVED');
    expect(detail.activity[0]).toMatchObject({ note: 'klient poprosił o czas', skipped: [] });
  });

  it('reopens a rejected opportunity with a note and still needs a reason to reject', async () => {
    const t = await setup();
    const id = await t.importText(POST);
    const move = (payload: object) => t.call('POST', `/api/opportunities/${id}/status`, payload);
    expect((await move({ status: 'REJECTED' })).statusCode).toBe(400);
    await move({ status: 'REJECTED', reason: 'NO_BUDGET' });
    expect((await move({ status: 'SAVED' })).json()).toEqual({ error: 'note_required' });
    expect((await move({ status: 'SAVED', note: 'jednak wraca' })).statusCode).toBe(200);
  });
});
