import {
  ActivityMetadata,
  OFFER_SCHEMA_VERSION,
  OfferDraftContent,
  OpportunityAnalysis,
  checkMove,
  nextDraftStatus,
  upgradeStoredAnalysis,
  type BusinessStatus,
  type OfferDraftConflict,
  type OfferDraftPatch,
  type OfferDraftRefused,
  type OpportunityDetail,
} from '@lead-hunter/contracts';
import type { ModelPrice } from '@lead-hunter/config';
import { budgetGate, costMicroUsd } from '../analysis/budget.js';
import { ProviderError, type ProfileReader, type ProviderOutput } from '../analysis/ports.js';
import type { ActivityRepository } from '../opportunities/ports.js';
import type { Clock } from '../shared/clock.js';
import { startOfWarsawDay, startOfWarsawMonth } from '../shared/warsaw-day.js';
import { guardOfferDraft } from './output-guard.js';
import type {
  OfferDraftRepository,
  OfferDrafter,
  OfferInput,
  OfferSource,
  OfferSourceReader,
} from './ports.js';

export interface OfferDeps {
  repository: OfferDraftRepository;
  sources: OfferSourceReader;
  /** Absent when `LLM_PROVIDER` is unset (FR-08 AC5). */
  drafter: OfferDrafter | undefined;
  profile: ProfileReader;
  activity: ActivityRepository;
  /** Month-to-date spend over analyses and drafts (S-07 D-8). */
  spentSince(at: number): { microUsd: number; unknownCount: number };
  /** The opportunity as the card shows it. */
  detail(id: number): OpportunityDetail | undefined;
  clock: Clock;
  /** Drafts per Europe/Warsaw day (FR-09 AC3, D-7). */
  dailyLimit: number;
  budget?: { monthlyCapMicroUsd: number | null; price: ModelPrice | null };
  /** Values an answer must not contain, i.e. the API key. */
  secrets?: string[];
}

export type GenerateResult =
  | { result: 'ok'; detail: OpportunityDetail }
  | { result: 'not_found' }
  | { result: 'refused'; code: OfferDraftRefused['error'] }
  | { result: 'failed'; reason: string };

export type ActResult =
  | { result: 'ok'; detail: OpportunityDetail }
  | { result: 'not_found' }
  | { result: 'conflict'; code: OfferDraftConflict['error'] };

export interface OfferService {
  generate(opportunityId: number): Promise<GenerateResult>;
  /** An operator action on the current draft (FR-13 AC3). Nothing is sent anywhere. */
  act(draftId: number, patch: OfferDraftPatch): ActResult;
}

const REASON_MAX = 120;

/** The stored fields the offer prompt may use (D-10); anything but a finished analysis is null. */
function analysisOf(source: OfferSource): OfferInput['analysis'] {
  if (!source.analysis) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(source.analysis.resultJson);
  } catch {
    return null;
  }
  const parsed = OpportunityAnalysis.safeParse(
    upgradeStoredAnalysis(stored, source.analysis.schemaVersion),
  );
  if (!parsed.success || parsed.data.verdict !== 'ANALYSED') return null;
  const a = parsed.data;
  return {
    category: a.category,
    problem: a.problem,
    mvpScope: a.mvpScope,
    exclusions: a.exclusions,
    estimatedHours: a.estimatedHours,
    proposedPrice: a.proposedPrice,
    pricingAssumptions: a.pricingAssumptions,
    requiredClarifications: a.requiredClarifications,
  };
}

export function createOfferService(deps: OfferDeps): OfferService {
  const { repository, drafter, clock } = deps;
  /** D-5, D-20: one draft at a time keeps the daily limit and the cap race-free. */
  let inFlight = false;

  /** D-4: an operator-meaningful stage, applied only as a forward move. */
  function moveForward(id: number, to: BusinessStatus): void {
    deps.activity.changeStatus(
      id,
      to,
      (from) => {
        const check = checkMove(from, to);
        return check.allowed && check.kind === 'forward' ? check : { allowed: false };
      },
      {
        reason: null,
        note: null,
        metadata: (check) => {
          const metadata = ActivityMetadata.parse(
            check.skipped.length > 0 ? { skipped: check.skipped } : {},
          );
          return Object.keys(metadata).length === 0 ? null : JSON.stringify(metadata);
        },
        at: clock.now().getTime(),
      },
    );
  }

  async function generate(opportunityId: number): Promise<GenerateResult> {
    const source = deps.sources.source(opportunityId);
    if (!source) return { result: 'not_found' };
    if (inFlight) return { result: 'refused', code: 'in_progress' };
    if (!drafter) return { result: 'refused', code: 'not_configured' };
    const now = clock.now();
    if (repository.countSince(startOfWarsawDay(now).getTime()) >= deps.dailyLimit) {
      return { result: 'refused', code: 'daily_limit' };
    }
    const blocked = budgetGate({
      paid: drafter.paid,
      capMicroUsd: deps.budget?.monthlyCapMicroUsd ?? null,
      price: deps.budget?.price ?? null,
      spentMicroUsd: deps.spentSince(startOfWarsawMonth(now).getTime()).microUsd,
    });
    if (blocked) return { result: 'refused', code: blocked };

    inFlight = true;
    try {
      return await run(opportunityId, source, drafter);
    } finally {
      inFlight = false;
    }
  }

  async function run(
    opportunityId: number,
    source: OfferSource,
    active: OfferDrafter,
  ): Promise<GenerateResult> {
    const profile = deps.profile.get();
    const analysis = analysisOf(source);
    const input: OfferInput = {
      source: { title: source.title, text: source.text, sourceType: source.sourceType },
      analysis,
      profile: {
        skills: profile.skills,
        serviceTypes: profile.serviceTypes,
        preferredTechnologies: profile.preferredTechnologies,
        experience: profile.experience,
        languages: profile.languages,
        rateRanges: profile.rateRanges,
        billingModels: profile.billingModels,
        minimumJobValue: profile.minimumJobValue,
      },
      targetLanguage: source.language,
    };
    const stored = (
      status: 'DRAFT' | 'FAILED',
      fields: {
        content?: OfferDraftContent;
        notes?: string[];
        error?: string;
        usage?: ProviderOutput['usage'];
        cost?: number | null;
      },
    ) =>
      repository.insert(
        {
          opportunityId,
          status,
          language: fields.content?.language ?? source.language ?? profile.languages[0] ?? '',
          subject: fields.content?.message.subject ?? '',
          messageMarkdown: fields.content?.message.body ?? '',
          proposalMarkdown: fields.content?.proposal.body ?? '',
          contentJson: fields.content ? JSON.stringify(fields.content) : null,
          guardNotesJson: fields.notes ? JSON.stringify(fields.notes) : null,
          provider: active.name,
          model: active.model,
          promptVersion: active.offerPromptVersion,
          schemaVersion: OFFER_SCHEMA_VERSION,
          analysed: analysis !== null,
          error: fields.error ?? null,
          inputTokens: fields.usage?.inputTokens ?? null,
          outputTokens: fields.usage?.outputTokens ?? null,
          costMicroUsd: fields.cost ?? null,
        },
        clock.now().getTime(),
      );
    /** D-9: the reason is a code, never an SDK message or model text. */
    const fail = (
      error: string,
      billed?: { usage: ProviderOutput['usage']; cost: number | null },
    ): GenerateResult => {
      stored('FAILED', { error, ...(billed ? { usage: billed.usage, cost: billed.cost } : {}) });
      return { result: 'failed', reason: error };
    };
    const priceOf = (usage: ProviderOutput['usage']) =>
      active.paid ? costMicroUsd(usage, deps.budget?.price ?? null) : 0;

    let provided: ProviderOutput;
    try {
      provided = await active.draftOffer(input);
    } catch (error) {
      if (error instanceof SyntaxError) return fail('invalid_output: not_json');
      if (!(error instanceof ProviderError)) return fail('provider_error: unknown');
      // A refusal, truncation or non-JSON answer was billed: its usage counts against the cap.
      const billed = error.usage ? { usage: error.usage, cost: priceOf(error.usage) } : undefined;
      return fail(
        error.kind === 'not_json' ? 'invalid_output: not_json' : `provider_error: ${error.kind}`,
        billed,
      );
    }

    const billed = { usage: provided.usage, cost: priceOf(provided.usage) };
    try {
      const echoed = JSON.stringify(provided.output) ?? '';
      if ((deps.secrets ?? []).some((secret) => secret !== '' && echoed.includes(secret))) {
        return fail('invalid_output: secret_echo', billed);
      }
      const parsed = OfferDraftContent.safeParse(provided.output);
      if (!parsed.success) {
        const paths = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))];
        return fail(`invalid_output: ${paths.join(', ')}`.slice(0, REASON_MAX), billed);
      }
      // AC2: only addresses the source or the operator's experience text contain survive.
      const allowed = `${source.title}\n${source.text}\n${profile.experience}`;
      const guarded = guardOfferDraft(parsed.data, allowed);
      // The guard edits text; what is stored must still satisfy the contract (lesson).
      const checked = OfferDraftContent.safeParse(guarded.content);
      if (!checked.success) return fail('invalid_output: guard', billed);

      stored('DRAFT', {
        content: checked.data,
        notes: guarded.notes,
        usage: billed.usage,
        cost: billed.cost,
      });
    } catch {
      return fail('internal_error', billed);
    }
    // Outside the try: the call is already stored once; a failure here must not bill it twice.
    moveForward(opportunityId, 'OFFER_DRAFTED');
    const detail = deps.detail(opportunityId);
    return detail ? { result: 'ok', detail } : { result: 'not_found' };
  }

  /** D-3, D-16: one conditional UPDATE, so a stale click cannot skip a step. */
  function act(draftId: number, patch: OfferDraftPatch): ActResult {
    const draft = repository.get(draftId);
    if (!draft || draft.status === 'FAILED') return { result: 'not_found' };
    if (repository.current(draft.opportunityId)?.id !== draft.id) {
      return { result: 'conflict', code: 'not_current' };
    }
    const changed =
      patch.action === 'save' &&
      (patch.subject !== draft.subject ||
        patch.message !== draft.messageMarkdown ||
        patch.proposal !== draft.proposalMarkdown);
    const next = nextDraftStatus(draft.status, patch.action, changed);
    if (!next) return { result: 'conflict', code: 'action_not_allowed' };

    const applied = repository.update(
      draft.id,
      draft.status,
      patch.action === 'save'
        ? {
            status: next,
            subject: patch.subject,
            messageMarkdown: patch.message,
            proposalMarkdown: patch.proposal,
          }
        : { status: next },
      clock.now().getTime(),
    );
    if (!applied) return { result: 'conflict', code: 'action_not_allowed' };
    if (patch.action === 'sent') moveForward(draft.opportunityId, 'CONTACTED');
    const detail = deps.detail(draft.opportunityId);
    return detail ? { result: 'ok', detail } : { result: 'not_found' };
  }

  return { generate, act };
}
