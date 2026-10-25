import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getGlobalDispatcher, type MockAgent } from 'undici';
import { beforeEach, describe, expect, it } from 'vitest';
import { analyses, opportunities } from '../src/infrastructure/db/schema.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/llm/${name}`, import.meta.url)), 'utf8');

const agent = getGlobalDispatcher() as MockAgent;
const JSON_HEADERS = { 'content-type': 'application/json' };
const MESSAGES = '/v1/messages';

let sequence = 0;
let ORIGIN = '';
let outbound = 0;

beforeEach(() => {
  sequence += 1;
  ORIGIN = `https://retry-${sequence}.anthropic.test`;
  outbound = 0;
});

/** The next `times` requests get `body`; with no count it answers every later request. */
function reply(status: number, body: string, times?: number): void {
  const interceptor = agent
    .get(ORIGIN)
    .intercept({ path: MESSAGES, method: 'POST' })
    .reply(() => {
      outbound += 1;
      return { statusCode: status, data: body, responseOptions: { headers: JSON_HEADERS } };
    });
  if (times === undefined) interceptor.persist();
  else interceptor.times(times);
}

const valid = () => read('anthropic-valid.json');

async function setup(env: Record<string, string> = {}) {
  const built = await buildTestApp({
    clock: new FakeClock(),
    env: {
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'sk-DEMO-KEY',
      LLM_BASE_URL: ORIGIN,
      LLM_MONTHLY_BUDGET_USD: '10',
      ...env,
    },
  });
  const cookie = await loginAsOperator(built.app);
  const importText = async (text: string) =>
    (
      await built.app.inject({
        method: 'POST',
        url: '/api/signals/import',
        headers: { cookie },
        payload: { text },
      })
    ).json<{ opportunityId: number }>().opportunityId;
  const request = (id: number | string, payload?: unknown, withCookie = true) =>
    built.app.inject({
      method: 'POST',
      url: `/api/opportunities/${id}/analysis`,
      ...(withCookie ? { headers: { cookie } } : {}),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const db = () => openTestDb(built.dir).db;
  const status = (id: number) =>
    db()
      .select()
      .from(opportunities)
      .all()
      .find((o) => o.id === id)!.analysisStatus;
  return { ...built, importText, request, db, status };
}

describe('POST /api/opportunities/:id/analysis (D-10, FR-08 AC2)', () => {
  it('retries a FAILED analysis: 202, drain, COMPLETE', async () => {
    reply(200, read('anthropic-not-json.json'), 1);
    reply(200, valid());
    const t = await setup();
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    await t.runner.drain();
    expect(t.status(id)).toBe('FAILED');

    const res = await t.request(id, {});
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ result: 'queued', force: false });
    await t.runner.idle();
    expect(t.status(id)).toBe('COMPLETE');
    expect(outbound).toBe(2);
  });

  it('without force a COMPLETE one is reused, with force the provider is called again', async () => {
    reply(200, valid());
    const t = await setup();
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    await t.runner.drain();
    expect(outbound).toBe(1);

    expect((await t.request(id)).statusCode).toBe(202);
    await t.runner.idle();
    expect(outbound).toBe(1);
    const reused = t.db().select().from(analyses).all();
    expect(reused).toHaveLength(2);
    expect(reused[1]!.reusedFromAnalysisId).toBe(reused[0]!.id);

    const forced = await t.request(id, { force: true });
    expect(forced.json()).toEqual({ result: 'queued', force: true });
    await t.runner.idle();
    expect(outbound).toBe(2);
    expect(t.status(id)).toBe('COMPLETE');
  });

  it('refuses an opportunity the pre-filter skipped', async () => {
    reply(200, valid());
    const t = await setup();
    const id = await t.importText(read('synthetic-seeking-work.txt'));
    await t.runner.drain();
    expect(t.status(id)).toBe('SKIPPED');
    const res = await t.request(id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'prefiltered' });
    expect(outbound).toBe(0);
  });

  it('answers 404 for an unknown id', async () => {
    const t = await setup();
    const res = await t.request(9999);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('answers 409 when no provider is configured', async () => {
    const t = await setup({ LLM_PROVIDER: '' });
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    const res = await t.request(id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not_configured' });
  });

  it('rejects an unknown body field with 400', async () => {
    const t = await setup();
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    const res = await t.request(id, { force: true, extra: 1 });
    expect(res.statusCode).toBe(400);
  });

  it('requires a session', async () => {
    const t = await setup();
    const id = await t.importText(read('synthetic-direct-pl.txt'));
    expect((await t.request(id, {}, false)).statusCode).toBe(401);
  });
});
