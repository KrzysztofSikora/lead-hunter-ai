import { describe, expect, it } from 'vitest';
import { OfferDraftContent, type OpportunityDetail } from '@lead-hunter/contracts';
import { createOfferDraftRepository } from '../src/infrastructure/db/offer-draft-repository.js';
import { MockProvider } from '../src/infrastructure/llm/mock.js';
import { ProviderError } from '../src/modules/analysis/ports.js';
import type { OfferDrafter, OfferInput } from '../src/modules/offers/ports.js';
import { activityEvents, offerDrafts } from '../src/infrastructure/db/schema.js';
import { buildTestApp, FakeClock, loginAsOperator, openTestDb } from './helpers/app.js';

const POST =
  'DEMO: Szukamy programisty TypeScript do narzędzia wewnętrznego, zapłacimy za wykonanie. Budżet 6000-9000 PLN, kontakt przez portal.';

/** A drafter that asks the mock for a draft and lets the test change it. */
function fakeDrafter(
  change: (draft: Record<string, unknown>) => void = () => undefined,
  over: Partial<Pick<OfferDrafter, 'paid' | 'name'>> = {},
): OfferDrafter {
  const mock = new MockProvider();
  return {
    name: over.name ?? 'mock',
    paid: over.paid ?? false,
    model: 'fake',
    offerPromptVersion: 'offer-1',
    demo: true,
    async draftOffer(input: OfferInput) {
      const provided = await mock.draftOffer(input);
      change(provided.output as Record<string, unknown>);
      return provided;
    },
  };
}

async function setup(options: Parameters<typeof buildTestApp>[0] = {}) {
  const clock = (options.clock as FakeClock | undefined) ?? new FakeClock();
  const built = await buildTestApp({ clock, env: { LLM_PROVIDER: 'mock' }, ...options });
  const cookie = await loginAsOperator(built.app);
  const headers = { cookie };
  const importText = async (text = POST) => {
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/signals/import',
      headers,
      payload: { text },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ opportunityId: number }>().opportunityId;
  };
  const generate = (id: number) =>
    built.app.inject({ method: 'POST', url: `/api/opportunities/${id}/offer-drafts`, headers });
  const detail = async (id: number) =>
    (
      await built.app.inject({ method: 'GET', url: `/api/opportunities/${id}`, headers })
    ).json<OpportunityDetail>();
  const db = () => openTestDb(built.dir).db;
  return { ...built, clock, cookie, importText, generate, detail, db };
}

describe('generating an offer draft (FR-13 AC1)', () => {
  it('stores a DRAFT with every section and moves the opportunity to OFFER_DRAFTED', async () => {
    const t = await setup();
    const id = await t.importText();
    await t.runner.drain();

    const res = await t.generate(id);
    expect(res.statusCode).toBe(201);
    const view = res.json<OpportunityDetail>();
    const draft = view.offerDraft!;
    expect(draft).toMatchObject({ status: 'DRAFT', demo: true, analysed: true, language: 'pl' });
    expect(draft.subject).toContain('DEMO / MOCK');
    expect(draft.message).not.toBe('');
    expect(draft.proposal).not.toBe('');
    const content = OfferDraftContent.parse(draft.content);
    expect(content.problem).not.toBe('');
    expect(content.valueProposition).not.toBe('');
    expect(content.mvpScope.length).toBeGreaterThan(0);
    expect(content.timeline.assumptions.length).toBeGreaterThan(0);
    expect(content.pricing.assumptions.length).toBeGreaterThan(0);
    expect(content.questions.length).toBeGreaterThanOrEqual(3);
    expect(content.questions.length).toBeLessThanOrEqual(6);
    expect(view.offerDraftHistory).toEqual([]);

    expect(view.businessStatus).toBe('OFFER_DRAFTED');
    const moves = t
      .db()
      .select()
      .from(activityEvents)
      .all()
      .filter((e) => e.toStatus === 'OFFER_DRAFTED');
    expect(moves).toMatchObject([{ actor: 'operator', opportunityId: id }]);
  });

  it('drafts from source and profile alone when there is no analysis (D-14)', async () => {
    const t = await setup();
    const id = await t.importText();

    const res = await t.generate(id);
    expect(res.statusCode).toBe(201);
    expect(res.json<OpportunityDetail>().offerDraft).toMatchObject({ analysed: false });
  });

  it('answers 404 for an unknown opportunity', async () => {
    const t = await setup();
    expect((await t.generate(999)).statusCode).toBe(404);
  });

  it('never creates a draft while analysing (FR-13 AC5)', async () => {
    const t = await setup();
    const id = await t.importText();
    await t.runner.drain();

    expect((await t.detail(id)).offerDraft).toBeNull();
    expect(t.db().select().from(offerDrafts).all()).toEqual([]);
  });

  it('keeps the earlier draft readable when a new one is made', async () => {
    const t = await setup();
    const id = await t.importText();
    const first = (await t.generate(id)).json<OpportunityDetail>().offerDraft!;
    const second = (await t.generate(id)).json<OpportunityDetail>();

    expect(second.offerDraft!.id).toBeGreaterThan(first.id);
    expect(second.offerDraftHistory).toMatchObject([
      { id: first.id, subject: first.subject, message: first.message, proposal: first.proposal },
    ]);
  });
});

describe('the draft output guard (FR-13 AC2)', () => {
  it('removes addresses the source and the profile do not contain and keeps the ones they do', async () => {
    const own = 'https://example.test/oferta';
    const t = await setup({
      drafter: fakeDrafter((draft) => {
        const message = draft.message as { body: string };
        message.body = `Zob. https://portfolio.invented.test/prace, pisz na sekret@invented.test lub ${own}.`;
        (draft.proposal as { body: string }).body = 'Szczegóły: www.invented.test/b2b';
      }),
    });
    const id = await t.importText(`${POST} Szczegóły: ${own}`);

    const view = (await t.generate(id)).json<OpportunityDetail>();
    const draft = view.offerDraft!;
    expect(draft.message).not.toContain('invented.test');
    expect(draft.message).toContain(own);
    expect(draft.proposal).not.toContain('invented.test');
    expect(draft.guardNotes).toHaveLength(3);
    expect(draft.guardNotes.join('\n')).toContain('portfolio.invented.test');
    expect(draft.content?.message.body).toBe(draft.message);
  });
});

describe('refusals and failures (FR-09 AC2-AC3)', () => {
  it('refuses the sixth draft of a Warsaw day, then allows it the next day', async () => {
    const t = await setup();
    const id = await t.importText();
    for (let i = 0; i < 5; i += 1) expect((await t.generate(id)).statusCode).toBe(201);

    const refused = await t.generate(id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'daily_limit' });
    expect(t.db().select().from(offerDrafts).all()).toHaveLength(5);

    t.clock.advance(24 * 3_600_000);
    expect((await t.generate(id)).statusCode).toBe(201);
  });

  it('refuses a second draft while one is being made (D-20)', async () => {
    const t = await setup();
    const first = await t.importText();
    const second = await t.importText(`${POST} Drugie zlecenie.`);

    const [a, b] = await Promise.all([t.generate(first), t.generate(second)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.statusCode === 409)!.json()).toEqual({ error: 'in_progress' });
    expect(t.db().select().from(offerDrafts).all()).toHaveLength(1);
  });

  it('refuses without a configured provider', async () => {
    const t = await setup({ env: {}, drafter: null });
    const id = await t.importText();
    const res = await t.generate(id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not_configured' });
  });

  it('refuses a paid drafter at the monthly cap, counting analyses and drafts (D-8)', async () => {
    const t = await setup({
      env: {
        LLM_PROVIDER: 'anthropic',
        LLM_API_KEY: 'sk-test-key',
        LLM_MONTHLY_BUDGET_USD: '0.01',
      },
      drafter: fakeDrafter(undefined, { paid: true, name: 'anthropic' }),
    });
    const id = await t.importText();
    createOfferDraftRepository(t.db()).insert(
      {
        opportunityId: id,
        status: 'FAILED',
        language: 'pl',
        subject: '',
        messageMarkdown: '',
        proposalMarkdown: '',
        contentJson: null,
        guardNotesJson: null,
        provider: 'anthropic',
        model: 'fake',
        promptVersion: 'offer-1',
        schemaVersion: 1,
        analysed: false,
        error: 'invalid_output: not_json',
        inputTokens: 10,
        outputTokens: 10,
        costMicroUsd: 10_000,
      },
      t.clock.now().getTime(),
    );

    const res = await t.generate(id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'budget_reached' });
  });

  it('stores a billed failure with its cost and leaves the opportunity as it was (D-9)', async () => {
    const t = await setup({
      drafter: {
        ...fakeDrafter(),
        async draftOffer() {
          throw new ProviderError('not_json', undefined, { inputTokens: 100, outputTokens: 50 });
        },
      },
    });
    const id = await t.importText();

    const res = await t.generate(id);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'provider_failed', reason: 'invalid_output: not_json' });
    const [row] = t.db().select().from(offerDrafts).all();
    expect(row).toMatchObject({
      status: 'FAILED',
      error: 'invalid_output: not_json',
      inputTokens: 100,
      outputTokens: 50,
      costMicroUsd: 0,
    });
    const view = await t.detail(id);
    expect(view.offerDraft).toBeNull();
    expect(view.businessStatus).toBe('NEW');
  });

  it('stores an answer that breaks the contract as a failure without echoing it', async () => {
    const t = await setup({
      drafter: fakeDrafter((draft) => {
        draft.questions = ['jedno pytanie'];
      }),
    });
    const id = await t.importText();

    const res = await t.generate(id);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'provider_failed', reason: 'invalid_output: questions' });
    expect(t.db().select().from(offerDrafts).all()).toMatchObject([{ status: 'FAILED' }]);
  });
});
