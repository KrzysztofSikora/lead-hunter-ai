import { describe, expect, it } from 'vitest';
import { buildTestApp, FakeClock, loginAsOperator } from './helpers/app.js';

const POST = 'DEMO: Szukamy kogoś do zbudowania sklepu internetowego.';

async function setup() {
  const clock = new FakeClock();
  const built = await buildTestApp({ clock, env: { LLM_PROVIDER: 'mock' } });
  const cookie = await loginAsOperator(built.app);
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
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

describe('follow-up (FR-14 AC4, storage and API)', () => {
  async function contacted() {
    const t = await setup();
    const id = await t.importText(POST);
    const move = (payload: object) => t.call('POST', `/api/opportunities/${id}/status`, payload);
    const followUp = (payload: object) =>
      t.call('PUT', `/api/opportunities/${id}/follow-up`, payload);
    return { ...t, id, move, followUp };
  }

  it('sets a follow-up on a contacted row, records an event and clears it on request', async () => {
    const t = await contacted();
    await t.move({ status: 'CONTACTED' });
    const set = await t.followUp({ on: '2026-01-05' });
    expect(set.statusCode).toBe(200);
    expect(set.json().followUpOn).toBe('2026-01-05');
    expect(set.json().businessStatus).toBe('CONTACTED');
    expect(set.json().activity[0]).toMatchObject({ type: 'FOLLOW_UP', followUpOn: '2026-01-05' });

    const cleared = await t.followUp({ on: null });
    expect(cleared.json().followUpOn).toBeNull();
    expect(cleared.json().activity[0]).toMatchObject({ type: 'FOLLOW_UP', followUpOn: null });
  });

  it('accepts today, refuses a past day (400) and a row that is not in contact (409)', async () => {
    const t = await contacted();
    await t.move({ status: 'SAVED' });
    const early = await t.followUp({ on: '2026-01-05' });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toEqual({ error: 'transition_not_allowed' });

    await t.move({ status: 'CONTACTED' });
    expect((await t.followUp({ on: '2026-01-01' })).statusCode).toBe(200);
    const past = await t.followUp({ on: '2025-12-31' });
    expect(past.statusCode).toBe(400);
    expect(past.json().fields[0].path).toBe('on');
    expect((await t.followUp({ on: '2026-02-30' })).statusCode).toBe(400);
    expect(
      (await t.call('PUT', '/api/opportunities/9999/follow-up', { on: null })).statusCode,
    ).toBe(404);
  });

  it('clears the follow-up on every move out of the contact stages', async () => {
    const t = await contacted();
    await t.move({ status: 'CONTACTED' });
    await t.followUp({ on: '2026-01-05' });
    const back = await t.move({ status: 'SAVED', note: 'czekamy' });
    expect(back.json().followUpOn).toBeNull();
    expect((await t.followUp({ on: null })).statusCode).toBe(409);

    await t.move({ status: 'CONTACTED' });
    await t.followUp({ on: '2026-01-06' });
    const lost = await t.move({ status: 'LOST' });
    expect(lost.json().followUpOn).toBeNull();

    await t.move({ status: 'CONTACTED', note: 'wraca' });
    await t.followUp({ on: '2026-01-07' });
    const aside = await t.move({ status: 'NEEDS_VERIFICATION' });
    expect(aside.json().followUpOn).toBeNull();
  });
});

describe('payments (FR-15 AC1)', () => {
  it('records a payment on a contacted row without touching the status; WON adds none', async () => {
    const t = await setup();
    const id = await t.importText(POST);
    const move = (payload: object) => t.call('POST', `/api/opportunities/${id}/status`, payload);
    await move({ status: 'CONTACTED' });

    t.clock.advance(1000);
    const paid = await t.call('POST', `/api/opportunities/${id}/payments`, {
      amountMinor: 150_000,
      currency: 'PLN',
      paidOn: '2026-01-01',
      note: 'zaliczka',
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().businessStatus).toBe('CONTACTED');
    expect(paid.json().payments).toEqual([
      expect.objectContaining({
        amountMinor: 150_000,
        currency: 'PLN',
        paidOn: '2026-01-01',
        note: 'zaliczka',
      }),
    ]);
    expect(paid.json().activity.map((e: { type: string }) => e.type)).not.toContain('PAYMENT');

    const won = await move({
      status: 'WON',
      contract: { valueMinor: 450_000, currency: 'PLN' },
    });
    expect(won.json().payments).toHaveLength(1);

    await t.call('POST', `/api/opportunities/${id}/payments`, {
      amountMinor: 5_000,
      currency: 'EUR',
      paidOn: '2025-12-20',
    });
    const detail = (await t.call('GET', `/api/opportunities/${id}`)).json();
    expect(detail.businessStatus).toBe('WON');
    expect(
      detail.payments.map((p: { currency: string; paidOn: string }) => [p.currency, p.paidOn]),
    ).toEqual([
      ['PLN', '2026-01-01'],
      ['EUR', '2025-12-20'],
    ]);
  });

  it('accepts a payment in any status, including NEW', async () => {
    const t = await setup();
    const id = await t.importText(POST);
    const res = await t.call('POST', `/api/opportunities/${id}/payments`, {
      amountMinor: 1,
      currency: 'USD',
      paidOn: '2026-01-01',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().payments[0].note).toBeNull();
  });

  it('refuses a zero or fractional amount, an unknown currency, a future date and a missing row', async () => {
    const t = await setup();
    const id = await t.importText(POST);
    const pay = (payload: object, to = id) =>
      t.call('POST', `/api/opportunities/${to}/payments`, payload);
    const ok = { amountMinor: 100, currency: 'PLN', paidOn: '2026-01-01' };
    expect((await pay({ ...ok, amountMinor: 0 })).statusCode).toBe(400);
    expect((await pay({ ...ok, amountMinor: 1.5 })).statusCode).toBe(400);
    expect((await pay({ ...ok, currency: 'GBP' })).statusCode).toBe(400);
    const future = await pay({ ...ok, paidOn: '2026-01-02' });
    expect(future.statusCode).toBe(400);
    expect(future.json().fields[0].path).toBe('paidOn');
    expect((await pay(ok, 9999)).statusCode).toBe(404);
    expect((await t.call('GET', `/api/opportunities/${id}`)).json().payments).toEqual([]);
  });
});

describe('pipeline summary (FR-15 AC2, FR-14 AC4)', () => {
  it('counts contacted, won and paid separately and sums per currency', async () => {
    const t = await setup();
    const a = await t.importText('DEMO: Potrzebujemy strony wizytówki dla pracowni.');
    const b = await t.importText('DEMO: Szukamy kogoś do integracji z systemem magazynowym.');
    const c = await t.importText('DEMO: Zlecenie na prosty skrypt do raportów.');
    const move = (id: number, payload: object) =>
      t.call('POST', `/api/opportunities/${id}/status`, payload);
    const pay = (id: number, amountMinor: number, currency: string) =>
      t.call('POST', `/api/opportunities/${id}/payments`, {
        amountMinor,
        currency,
        paidOn: '2026-01-01',
      });

    await move(a, { status: 'SAVED' });
    await move(a, { status: 'CONTACTED' });
    await pay(a, 10_000, 'PLN');
    await move(b, { status: 'SAVED' });
    await move(b, { status: 'CONTACTED' });
    await move(b, { status: 'WON' });
    await move(c, { status: 'SAVED' });
    await pay(c, 5_000, 'EUR');
    await pay(c, 2_000, 'EUR');

    const res = await t.call('GET', '/api/pipeline');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals).toEqual({
      contacted: 2,
      won: 1,
      paid: 2,
      paidSums: [
        { currency: 'EUR', totalMinor: 7_000, count: 2 },
        { currency: 'PLN', totalMinor: 10_000, count: 1 },
      ],
    });

    const stage = (status: string) =>
      body.stages.find((s: { status: string }) => s.status === status);
    expect(stage('CONTACTED')).toMatchObject({ count: 1 });
    expect(stage('CONTACTED').items[0]).toMatchObject({
      id: a,
      paid: [{ currency: 'PLN', totalMinor: 10_000 }],
    });
    expect(stage('WON').items[0]).toMatchObject({ id: b, paid: [] });
    expect(stage('SAVED').items[0]).toMatchObject({
      id: c,
      paid: [{ currency: 'EUR', totalMinor: 7_000 }],
    });
    expect(body.otherCounts).toContainEqual({ status: 'NEW', count: 0 });
  });

  it('counts a row that reached a later contact stage from an off-path status as contacted', async () => {
    const t = await setup();
    const id = await t.importText(POST);
    const move = (payload: object) => t.call('POST', `/api/opportunities/${id}/status`, payload);
    await move({ status: 'NEEDS_VERIFICATION' });
    await move({ status: 'MEETING' });
    const { totals } = (await t.call('GET', '/api/pipeline')).json();
    expect(totals).toMatchObject({ contacted: 1, won: 0, paid: 0, paidSums: [] });
  });

  it('lists only follow-ups due today or overdue, overdue first, in contact stages', async () => {
    const t = await setup();
    const today = await t.importText('DEMO: Prośba o wycenę sklepu na WooCommerce.');
    const tomorrow = await t.importText('DEMO: Poszukujemy developera do panelu klienta.');
    const early = await t.importText('DEMO: Chcemy zautomatyzować fakturowanie.');
    for (const id of [today, tomorrow, early]) {
      await t.call('POST', `/api/opportunities/${id}/status`, { status: 'CONTACTED' });
    }
    const followUp = (id: number, on: string) =>
      t.call('PUT', `/api/opportunities/${id}/follow-up`, { on });
    await followUp(today, '2026-01-02');
    await followUp(tomorrow, '2026-01-03');
    await followUp(early, '2026-01-01');

    t.clock.advance(24 * 3_600_000); // 2026-01-02 in Warsaw
    const body = (await t.call('GET', '/api/pipeline')).json();
    expect(body.followUpsDue.map((i: { id: number }) => i.id)).toEqual([early, today]);
    expect(body.followUpsDue[0]).toMatchObject({ followUpOn: '2026-01-01' });

    // Cleared by leaving the contact stages: no longer due.
    await t.call('POST', `/api/opportunities/${today}/status`, { status: 'LOST' });
    const after = (await t.call('GET', '/api/pipeline')).json();
    expect(after.followUpsDue.map((i: { id: number }) => i.id)).toEqual([early]);
  });

  it('is empty on an empty database and needs a session', async () => {
    const t = await setup();
    const body = (await t.call('GET', '/api/pipeline')).json();
    expect(body.followUpsDue).toEqual([]);
    expect(body.totals).toEqual({ contacted: 0, won: 0, paid: 0, paidSums: [] });
    expect(body.stages.map((s: { status: string }) => s.status)).toEqual([
      'SAVED',
      'OFFER_DRAFTED',
      'CONTACTED',
      'REPLIED',
      'MEETING',
      'WON',
      'LOST',
    ]);
    expect((await t.app.inject({ method: 'GET', url: '/api/pipeline' })).statusCode).toBe(401);
  });
});
