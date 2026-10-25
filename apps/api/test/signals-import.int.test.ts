import { count } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  opportunities,
  opportunityEvidence,
  rawSignals,
  signalIdentities,
} from '../src/infrastructure/db/schema.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const POST = 'Szukam wykonawcy aplikacji React\nBudżet do ustalenia.';
const URL_A = 'https://example.com/job/1';
const URL_B = 'https://example.org/oferta/2';

async function setup(env?: Record<string, string>) {
  const clock = new FakeClock();
  const built = await buildTestApp({ clock, ...(env ? { env } : {}) });
  const cookie = await loginAsOperator(built.app);
  const post = (payload: unknown) =>
    built.app.inject({
      method: 'POST',
      url: '/api/signals/import',
      headers: { cookie },
      payload: payload as object,
    });
  const rows = () => {
    const { db } = openTestDb(built.dir);
    return {
      signals: db.select().from(rawSignals).all(),
      opps: db.select().from(opportunities).all(),
      evidence: db.select().from(opportunityEvidence).all(),
      identities: db.select().from(signalIdentities).all(),
    };
  };
  return { ...built, clock, cookie, post, rows };
}

describe('manual import (FR-02, FR-06)', () => {
  it('stores text only as manual_text without any URL (FR-02 AC1, AC3)', async () => {
    const { post, rows, clock } = await setup();
    const res = await post({ text: POST });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ result: 'created', opportunityId: 1, signalId: 1 });
    expect(res.body).not.toMatch(/https?:/);

    const { signals, opps } = rows();
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      sourceType: 'manual_text',
      sourceUrl: null,
      canonicalUrl: null,
      snippet: POST,
      title: 'Szukam wykonawcy aplikacji React',
      publishedAt: null,
      fetchedAt: clock.now().getTime(),
      availability: 'NOT_CHECKED',
      lastVerifiedAt: null,
    });
    expect(opps[0]).toMatchObject({
      businessStatus: 'NEW',
      analysisStatus: 'PENDING',
      score: null,
    });
  });

  it('recognises a URL variant as a duplicate and keeps the pasted URL (FR-02 AC2, FR-06 AC1)', async () => {
    const { post, rows } = await setup();
    const pasted = 'https://example.com/job/1/?utm_source=x#top';
    expect((await post({ text: POST, url: pasted })).statusCode).toBe(201);
    expect(rows().signals[0]).toMatchObject({
      sourceType: 'manual_url',
      sourceUrl: pasted,
      canonicalUrl: URL_A,
    });

    const again = await post({ url: 'HTTPS://Example.com:443/job/1' });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({
      result: 'duplicate',
      opportunityId: 1,
      matchedBy: 'canonical_url',
      evidenceAdded: false,
    });
    const { signals, opps, evidence } = rows();
    expect([signals.length, opps.length, evidence.length]).toEqual([1, 1, 1]);
  });

  it('recognises the same text without a URL by content hash', async () => {
    const { post, rows } = await setup();
    await post({ text: POST });
    const again = await post({ text: `  ${POST.toUpperCase().replace('\n', '\r\n')} ` });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ result: 'duplicate', matchedBy: 'content_hash' });
    expect(rows().opps).toHaveLength(1);
  });

  it('adds REPEAT_IMPORT evidence only for something new (D-1)', async () => {
    const { post, rows } = await setup();
    await post({ text: POST, url: URL_A });
    const second = await post({ text: 'Inna treść tego samego ogłoszenia', url: URL_A });
    expect(second.json()).toMatchObject({ result: 'duplicate', evidenceAdded: true });
    const repeat = await post({ text: 'Inna treść tego samego ogłoszenia', url: URL_A });
    expect(repeat.json()).toMatchObject({ result: 'duplicate', evidenceAdded: false });

    const { evidence, signals } = rows();
    expect(evidence.map((e) => e.evidenceType)).toEqual(['IMPORT', 'REPEAT_IMPORT']);
    expect(evidence[1]).toMatchObject({
      sourceFact: 'Inna treść tego samego ogłoszenia',
      rawSignalId: signals[0]?.id,
      sourceUrl: URL_A,
    });
    expect(signals).toHaveLength(1);
  });

  it('recognises a URL or text first seen in a duplicate (D-14)', async () => {
    const { post, rows } = await setup();
    expect((await post({ text: POST, url: URL_A })).statusCode).toBe(201);
    expect((await post({ text: POST, url: URL_B })).json()).toMatchObject({
      matchedBy: 'content_hash',
      evidenceAdded: true,
    });
    expect((await post({ url: URL_B })).json()).toMatchObject({
      opportunityId: 1,
      matchedBy: 'canonical_url',
      evidenceAdded: false,
    });

    expect((await post({ text: 'Druga treść', url: URL_A })).json()).toMatchObject({
      evidenceAdded: true,
    });
    expect((await post({ text: 'Druga treść' })).json()).toMatchObject({
      opportunityId: 1,
      matchedBy: 'content_hash',
      evidenceAdded: false,
    });
    expect([rows().signals.length, rows().opps.length]).toEqual([1, 1]);
  });

  it('lets the URL win when URL and text belong to different opportunities (D-14)', async () => {
    const { post, rows } = await setup();
    expect((await post({ text: 'T1', url: URL_A })).json()).toMatchObject({ opportunityId: 1 });
    expect((await post({ text: 'T2' })).json()).toMatchObject({ opportunityId: 2 });

    expect((await post({ text: 'T2', url: URL_A })).json()).toMatchObject({
      result: 'duplicate',
      opportunityId: 1,
      matchedBy: 'canonical_url',
    });
    expect((await post({ text: 'T2' })).json()).toMatchObject({ opportunityId: 2 });
    expect(rows().opps).toHaveLength(2);
  });

  it('never merges URL imports with blank text (D-2)', async () => {
    const { post, rows } = await setup();
    expect((await post({ text: '  ', url: URL_A })).statusCode).toBe(201);
    expect((await post({ text: '  ', url: URL_B })).statusCode).toBe(201);
    const { signals, opps } = rows();
    expect(opps).toHaveLength(2);
    expect(signals.map((s) => s.contentHash)).toEqual([null, null]);
    expect(signals.map((s) => [s.snippet, s.title])).toEqual([
      ['', URL_A],
      ['', URL_B],
    ]);
  });

  it('keeps similar titles with different URLs and texts apart (FR-06 AC2)', async () => {
    const { post, rows } = await setup();
    await post({ text: 'Szukam wykonawcy aplikacji React\nWarszawa, 3 miesiące', url: URL_A });
    await post({ text: 'Szukam wykonawcy aplikacji React\nZdalnie, stała współpraca', url: URL_B });
    expect(rows().opps).toHaveLength(2);
  });

  const invalid: [string, unknown, string][] = [
    ['empty body', {}, 'text'],
    ['whitespace text', { text: '   ' }, 'text'],
    ['text over the limit', { text: 'x'.repeat(1001) }, 'text'],
    ['non-http URL', { url: 'ftp://example.com/x' }, 'url'],
    ['unparsable URL', { url: 'nie-adres' }, 'url'],
    ['URL with user info', { text: POST, url: 'https://u:p@example.com/x' }, 'url'],
    ['unknown field', { text: POST, extra: 1 }, 'extra'],
  ];
  it.each(invalid)(
    'answers 400 and stores nothing for %s (FR-02 AC4)',
    async (_n, payload, path) => {
      const { post, db } = await withDb();
      const res = await post(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'validation_failed' });
      expect(res.json().fields.map((f: { path: string }) => f.path)).toContain(path);
      expect(db.select({ n: count() }).from(rawSignals).get()?.n).toBe(0);
      expect(db.select({ n: count() }).from(opportunities).get()?.n).toBe(0);
    },
  );

  it('flags user info with code custom', async () => {
    const { post } = await setup();
    const res = await post({ url: 'https://u:p@example.com/x' });
    expect(res.json().fields).toEqual([
      { path: 'url', code: 'custom', message: 'adres URL nie może zawierać loginu ani hasła' },
    ]);
  });

  it('requires a session', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/signals/import',
      payload: { text: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('recognises a duplicate after a restart', async () => {
    const { app, post, dir } = await setup();
    await post({ url: URL_A });
    await app.close();

    const restarted = await buildTestApp({ dir });
    const cookie = await loginAsOperator(restarted.app);
    const res = await restarted.app.inject({
      method: 'POST',
      url: '/api/signals/import',
      headers: { cookie },
      payload: { url: `${URL_A}/` },
    });
    expect(res.json()).toMatchObject({ result: 'duplicate', opportunityId: 1 });
  });
});

async function withDb() {
  const built = await setup({ IMPORT_MAX_TEXT_CHARS: '1000' });
  return { ...built, db: openTestDb(built.dir).db };
}
