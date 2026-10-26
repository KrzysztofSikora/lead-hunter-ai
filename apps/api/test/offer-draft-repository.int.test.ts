import { describe, expect, it } from 'vitest';
import { createOfferDraftRepository } from '../src/infrastructure/db/offer-draft-repository.js';
import { opportunities, rawSignals } from '../src/infrastructure/db/schema.js';
import type { NewOfferDraft } from '../src/modules/offers/ports.js';
import { openTestDb } from './helpers/app.js';

const draft = (opportunityId: number, over: Partial<NewOfferDraft> = {}): NewOfferDraft => ({
  opportunityId,
  status: 'DRAFT',
  language: 'pl',
  subject: 'DEMO',
  messageMarkdown: 'DEMO',
  proposalMarkdown: 'DEMO',
  contentJson: null,
  guardNotesJson: null,
  provider: 'mock',
  model: 'mock',
  promptVersion: 'offer-1',
  schemaVersion: 1,
  analysed: true,
  error: null,
  inputTokens: null,
  outputTokens: null,
  costMicroUsd: 0,
  ...over,
});

function setup() {
  const { db } = openTestDb();
  const raw = db
    .insert(rawSignals)
    .values({
      sourceType: 'MANUAL_IMPORT',
      title: 'DEMO',
      snippet: 'DEMO',
      fetchedAt: 1,
      availability: 'UNKNOWN',
    })
    .returning({ id: rawSignals.id })
    .get();
  const opp = db
    .insert(opportunities)
    .values({
      primarySignalId: raw.id,
      businessStatus: 'NEW',
      analysisStatus: 'PENDING',
      createdAt: 1,
      updatedAt: 1,
    })
    .returning({ id: opportunities.id })
    .get();
  return { repo: createOfferDraftRepository(db), id: opp.id };
}

describe('offer draft repository (S-07 D-1)', () => {
  it('the newest non-failed row is current, failed ones are never current', () => {
    const { repo, id } = setup();
    repo.insert(draft(id, { subject: 'first' }), 100);
    const second = repo.insert(draft(id, { subject: 'second' }), 200);
    repo.insert(draft(id, { status: 'FAILED', error: 'not_json' }), 300);

    expect(repo.current(id)?.id).toBe(second);
    expect(repo.countSince(0)).toBe(3);
    expect(repo.countSince(250)).toBe(1);
  });

  it('updates only while the status is still the expected one', () => {
    const { repo, id } = setup();
    const row = repo.insert(draft(id), 100);

    expect(repo.update(row, 'DRAFT', { status: 'REVIEWED', subject: 'edited' }, 200)).toBe(true);
    expect(repo.update(row, 'DRAFT', { status: 'REVIEWED' }, 300)).toBe(false);
    expect(repo.get(row)).toMatchObject({
      status: 'REVIEWED',
      subject: 'edited',
      updatedAt: 200,
      statusChangedAt: 200,
    });

    expect(repo.update(row, 'REVIEWED', { messageMarkdown: 'text' }, 400)).toBe(true);
    expect(repo.get(row)).toMatchObject({ updatedAt: 400, statusChangedAt: 200 });
  });
});
