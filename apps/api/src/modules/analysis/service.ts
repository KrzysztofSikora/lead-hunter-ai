import {
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisServiceStatus,
  OpportunityAnalysis,
  ScoreBreakdown,
  type BusinessStatus,
  type PrefilterRule,
} from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';
import type { ModelPrice } from '@lead-hunter/config';
import { startOfWarsawDay, startOfWarsawMonth } from '../shared/warsaw-day.js';
import { scoreAnalysis } from '../scoring/score.js';
import { budgetGate, costMicroUsd, type BudgetBlock } from './budget.js';
import { guardAnalysis } from './output-guard.js';
import { prefilter } from './prefilter.js';
import type {
  AnalysisInput,
  AnalysisRepository,
  CompletedAnalysis,
  FailedAnalysis,
  LlmProvider,
  ProfileReader,
  WaitingOpportunity,
} from './ports.js';
import { ProviderError } from './ports.js';

export interface AnalysisDeps {
  repository: AnalysisRepository;
  /** Absent when `LLM_PROVIDER` is unset: the pre-filter still runs, nothing is analysed. */
  provider: LlmProvider | undefined;
  profile: ProfileReader;
  clock: Clock;
  /** Analyses per Europe/Warsaw day (D-9). */
  dailyLimit: number;
  maxAgeDays: number;
  /** D-3, D-5: the monthly cap and the active model's price; both absent for a free provider. */
  budget?: { monthlyCapMicroUsd: number | null; price: ModelPrice | null };
  /** Values an answer must not contain, i.e. the API key (D-9). */
  secrets?: string[];
  /** Receives drain failures; must not log source text. */
  onError: (error: unknown) => void;
}

export interface AnalysisRunner {
  /** Pre-filters and analyses what waits. A call during a drain makes it run once more. */
  drain(): Promise<void>;
  /** Fire and forget: errors go to `onError`. */
  kick(): void;
  /** D-12: puts a `FAILED` analysis back in the queue and kicks the drain. */
  retry(id: number): 'reset' | 'not_failed' | 'not_found';
  /** D-11: what the UI and the brief need to say how much analysis is done and waiting. */
  status(): AnalysisServiceStatus;
  /** D-10: puts one opportunity back in the queue and kicks the runner. */
  requeue(id: number, force: boolean): 'queued' | 'prefiltered' | 'not_configured' | 'not_found';
  /** Resolves when no drain is in flight. */
  idle(): Promise<void>;
}

/** D-5: a missing text waits for verification; every other rule is a rejection. */
const moveFor = (rule: PrefilterRule | null): BusinessStatus | null => {
  if (rule === null) return null;
  return rule === 'no_text' ? 'NEEDS_VERIFICATION' : 'REJECTED';
};

const REASON_MAX = 300;

/** D-9: after these the whole provider is unusable for now, so the drain stops instead of failing the queue. */
const PROVIDER_WIDE: ReadonlySet<ProviderError['kind']> = new Set([
  'auth',
  'rate_limited',
  'unavailable',
  'timeout',
]);

type Outcome = 'continue' | 'stop';

const reasonOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, REASON_MAX);

export function createAnalysisRunner(deps: AnalysisDeps): AnalysisRunner {
  const { repository, provider, clock } = deps;

  function runPrefilter(): void {
    const pending = repository.pendingWithoutPrefilter();
    if (pending.length === 0) return;
    const profile = deps.profile.get();
    const now = clock.now();
    for (const row of pending) {
      const outcome = prefilter(
        { text: row.text, sourceType: row.sourceType, publishedAt: row.publishedAt },
        profile,
        { now, maxAgeDays: deps.maxAgeDays },
      );
      repository.savePrefilter(row.id, outcome, now.getTime(), moveFor(outcome.rule));
    }
  }

  /** Guard, score and store one parsed answer: shared by a provider call and a reused result. */
  function complete(
    row: WaitingOpportunity,
    meta: Omit<CompletedAnalysis, 'resultJson' | 'breakdown' | 'guardNotes' | 'columns'>,
    answer: OpportunityAnalysis,
  ): string | null {
    const profile = deps.profile.get();
    const guarded = guardAnalysis(answer, row.text);
    // The guard edits text; what is stored must still satisfy the contract (read side parses it).
    const checked = OpportunityAnalysis.safeParse(guarded.result);
    if (!checked.success) return 'invalid_output: guard';
    const result = checked.data;
    const columns: CompletedAnalysis['columns'] = {
      category: null,
      evidenceLevel: null,
      score: null,
      confidence: null,
      industry: null,
      workMode: null,
      countries: null,
      amountMaxMinor: null,
      amountCurrency: null,
      businessStatus: 'NEEDS_VERIFICATION',
    };
    let breakdown: CompletedAnalysis['breakdown'] = null;
    if (result.verdict === 'ANALYSED') {
      breakdown = ScoreBreakdown.parse(scoreAnalysis(result, profile));
      Object.assign(columns, {
        category: result.category,
        evidenceLevel: result.evidenceLevel,
        score: breakdown.total,
        confidence: breakdown.confidence,
        industry: result.industry,
        workMode: result.workMode === 'UNKNOWN' ? null : result.workMode,
        countries: result.countries.length > 0 ? `,${result.countries.join(',')},` : null,
        amountMaxMinor: result.sourceBudget?.maxMinor ?? null,
        amountCurrency: result.sourceBudget?.currency ?? null,
        businessStatus: null,
      });
    }
    repository.saveComplete({
      ...meta,
      resultJson: JSON.stringify(result),
      breakdown,
      guardNotes: guarded.notes,
      columns,
    });
    return null;
  }

  /** D-3, D-5: whether a provider call may start now; also what `status()` reports. */
  function blockedNow(active: LlmProvider, spentMicroUsd: number): BudgetBlock | null {
    return budgetGate({
      paid: active.paid,
      capMicroUsd: deps.budget?.monthlyCapMicroUsd ?? null,
      price: deps.budget?.price ?? null,
      spentMicroUsd,
    });
  }

  const spentThisMonth = () => repository.spentSince(startOfWarsawMonth(clock.now()).getTime());

  /** D-4: stores the earlier result again, re-guarded and re-scored; no provider call, no cost. */
  function tryReuse(row: WaitingOpportunity, active: LlmProvider, at: number): boolean {
    const earlier = repository.findReusable(row.id, active.promptVersion, ANALYSIS_SCHEMA_VERSION);
    if (!earlier) return false;
    let stored: unknown;
    try {
      stored = JSON.parse(earlier.resultJson);
    } catch {
      return false;
    }
    const parsed = OpportunityAnalysis.safeParse(stored);
    if (!parsed.success) return false;
    return (
      complete(
        row,
        {
          opportunityId: row.id,
          provider: earlier.provider,
          model: earlier.model,
          promptVersion: earlier.promptVersion,
          schemaVersion: earlier.schemaVersion,
          usage: earlier.usage,
          costMicroUsd: null,
          reusedFromAnalysisId: earlier.id,
          at,
        },
        parsed.data,
      ) === null
    );
  }

  async function analyseOne(row: WaitingOpportunity, active: LlmProvider): Promise<Outcome> {
    const at = clock.now().getTime();
    const meta = {
      opportunityId: row.id,
      provider: active.name,
      model: active.model,
      promptVersion: active.promptVersion,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      at,
    };
    const fail = (error: string, paid?: Pick<FailedAnalysis, 'usage' | 'costMicroUsd'>) =>
      repository.saveFailed({ ...meta, error, ...paid });

    try {
      if (!row.force && tryReuse(row, active, at)) return 'continue';

      if (blockedNow(active, spentThisMonth().microUsd) !== null) return 'stop';

      const profile = deps.profile.get();
      const input: AnalysisInput = {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        source: { title: row.title, text: row.text, url: row.url, sourceType: row.sourceType },
        profile: {
          skills: profile.skills,
          serviceTypes: profile.serviceTypes,
          preferredTechnologies: profile.preferredTechnologies,
          excludedTechnologies: profile.excludedTechnologies,
          languages: profile.languages,
          rateRanges: profile.rateRanges,
        },
      };

      let provided;
      try {
        provided = await active.analyzeOpportunity(input);
      } catch (error) {
        // A JSON.parse SyntaxError quotes the model's text, so it is stored as a code, not a message.
        const notJson =
          error instanceof SyntaxError ||
          (error instanceof ProviderError && error.kind === 'not_json');
        // A refusal, truncation or non-JSON answer was billed: its usage counts against the cap (R2).
        const usage = error instanceof ProviderError ? error.usage : undefined;
        fail(
          notJson ? 'invalid_output: not_json' : `provider_error: ${reasonOf(error)}`,
          usage && {
            usage,
            costMicroUsd: active.paid ? costMicroUsd(usage, deps.budget?.price ?? null) : 0,
          },
        );
        return error instanceof ProviderError && PROVIDER_WIDE.has(error.kind)
          ? 'stop'
          : 'continue';
      }

      // The call is billed from here on, so a rejected answer is stored with its cost too.
      const cost = active.paid ? costMicroUsd(provided.usage, deps.budget?.price ?? null) : 0;
      const billed = { usage: provided.usage, costMicroUsd: cost };

      const echoed = JSON.stringify(provided.output) ?? '';
      if ((deps.secrets ?? []).some((secret) => secret !== '' && echoed.includes(secret))) {
        fail('invalid_output: secret_echo', billed);
        return 'continue';
      }

      const parsed = OpportunityAnalysis.safeParse(provided.output);
      if (!parsed.success) {
        const paths = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))];
        fail(`invalid_output: ${paths.join(', ')}`, billed);
        return 'continue';
      }

      const rejected = complete(
        row,
        { ...meta, usage: provided.usage, costMicroUsd: cost, reusedFromAnalysisId: null },
        parsed.data,
      );
      if (rejected) fail(rejected, billed);
      return 'continue';
    } catch (error) {
      // After the provider answered: a failed save must not leave the row at the head of the queue.
      fail(`internal_error: ${reasonOf(error)}`);
      return 'continue';
    }
  }

  async function drainOnce(): Promise<void> {
    runPrefilter();
    if (!provider) return;
    while (repository.countSince(startOfWarsawDay(clock.now()).getTime()) < deps.dailyLimit) {
      const [next] = repository.nextWaiting(1);
      if (!next) return;
      if ((await analyseOne(next, provider)) === 'stop') return;
    }
  }

  let inFlight: Promise<void> | undefined;
  let again = false;

  const drain = (): Promise<void> => {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        do {
          again = false;
          await drainOnce();
        } while (again);
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  const kickDrain = (): void => void drain().catch(deps.onError);

  return {
    drain,
    kick: kickDrain,
    retry(id) {
      const outcome = repository.retryFailed(id, clock.now().getTime());
      if (outcome === 'reset') kickDrain();
      return outcome;
    },
    status() {
      const analysedToday = repository.countSince(startOfWarsawDay(clock.now()).getTime());
      const spent = spentThisMonth();
      return {
        configured: provider !== undefined,
        provider: provider?.name ?? null,
        model: provider?.model ?? null,
        paid: provider?.paid ?? false,
        blocked: provider ? blockedNow(provider, spent.microUsd) : null,
        budget: {
          capMicroUsd: deps.budget?.monthlyCapMicroUsd ?? null,
          spentMicroUsd: spent.microUsd,
          unknownCostCount: spent.unknownCount,
          monthStart: startOfWarsawMonth(clock.now()).toISOString(),
        },
        demo: provider?.demo ?? false,
        dailyLimit: deps.dailyLimit,
        analysedToday,
        waiting: repository.waitingCount(),
        limitReached: analysedToday >= deps.dailyLimit,
      };
    },
    requeue(id, force) {
      if (!provider) return 'not_configured';
      if (!repository.requeue(id, force, clock.now().getTime())) {
        return repository.exists(id) ? 'prefiltered' : 'not_found';
      }
      drain().catch(deps.onError);
      return 'queued';
    },
    idle: () => inFlight ?? Promise.resolve(),
  };
}
