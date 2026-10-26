import {
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisActivity,
  type AnalysisReasonCode,
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
import { createActivityTracker } from './activity.js';
import { guardAnalysis } from './output-guard.js';
import { prefilter } from './prefilter.js';
import { MAX_ATTEMPTS, nextDelay } from './retry-policy.js';
import type {
  AnalysisInput,
  AnalysisRepository,
  CompletedAnalysis,
  FailedAnalysis,
  HostMetrics,
  LlmProvider,
  ProfileReader,
  RunnerState,
  WaitingOpportunity,
} from './ports.js';
import { ProviderError } from './ports.js';

/** Waits `ms`; an aborted `signal` ends the wait early (it resolves, the caller checks the signal). */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

const realSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });

/** D-2 (S-20): the activity history is bounded by count and age. */
const HISTORY_MAX_ENTRIES = 100;
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const QUEUE_PREVIEW = 20;

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
  /** Backoff between attempts (D-1); tests inject one they can hold open. */
  sleep?: Sleep;
  /** Whether the operator paused the queue; absent means it is never paused across restarts. */
  runnerState?: RunnerState;
  /** Temperature and load for the activity view; absent means "niedostępne". */
  hostMetrics?: HostMetrics;
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
  /** FR-34: what the queue is doing now, what waits and what finished lately. */
  activity(): Promise<AnalysisActivity>;
  /**
   * FR-34 AC3: aborts the app's own request and pending retries, and pauses the queue until
   * `resume()`. `cancelled` is false when no request was in flight (D-5).
   */
  cancel(): { cancelled: boolean };
  /** Clears the pause and runs the queue. */
  resume(): void;
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

/** D-8: the one place a stored or shown failure becomes a code from the closed set. */
function providerReason(error: unknown): AnalysisReasonCode {
  if (error instanceof SyntaxError) return 'invalid_json';
  if (!(error instanceof ProviderError)) return 'provider_unavailable';
  switch (error.kind) {
    case 'unavailable':
      return 'provider_unavailable';
    case 'not_json':
      return 'invalid_json';
    default:
      return error.kind;
  }
}

const reasonOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, REASON_MAX);

export function createAnalysisRunner(deps: AnalysisDeps): AnalysisRunner {
  const { repository, provider, clock } = deps;
  const sleep = deps.sleep ?? realSleep;
  let pausedInMemory = false;
  const runnerState: RunnerState = deps.runnerState ?? {
    isPaused: () => pausedInMemory,
    setPaused: (paused) => {
      pausedInMemory = paused;
    },
  };
  /** The call in flight, while `cancel()` may still stop it (not once the provider answered). */
  let cancellable: AbortController | undefined;
  const tracker = createActivityTracker({
    clock,
    maxEntries: HISTORY_MAX_ENTRIES,
    maxAgeMs: HISTORY_MAX_AGE_MS,
  });

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
    const fail = (
      error: string,
      code: AnalysisReasonCode,
      paid?: Pick<FailedAnalysis, 'usage' | 'costMicroUsd'>,
    ) => {
      repository.saveFailed({ ...meta, error, ...paid });
      tracker.finish('failed', code);
    };
    const entry = {
      opportunityId: row.id,
      title: row.title,
      provider: active.name,
      model: active.model,
    };

    try {
      if (!row.force && tryReuse(row, active, at)) {
        tracker.recordReused(entry);
        return 'continue';
      }

      if (blockedNow(active, spentThisMonth().microUsd) !== null) return 'stop';
      tracker.start({ ...entry, maxAttempts: MAX_ATTEMPTS });

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

      const controller = new AbortController();
      cancellable = controller;
      // D-3: the operator's cancel is stored as a failed analysis with the code `cancelled`.
      const cancelledOut = (): Outcome => {
        repository.saveFailed({ ...meta, error: 'cancelled' });
        tracker.finish('cancelled', 'cancelled');
        return 'stop';
      };
      let provided;
      for (let attempt = 1; ; attempt += 1) {
        tracker.attempt(attempt);
        try {
          provided = await active.analyzeOpportunity(input, { signal: controller.signal });
          if (controller.signal.aborted) return cancelledOut();
          break;
        } catch (error) {
          // An abort can surface as any error, so the signal decides, not the error class.
          if (controller.signal.aborted) return cancelledOut();
          const delay = error instanceof ProviderError ? nextDelay(attempt, error) : 'give_up';
          if (delay !== 'give_up') {
            tracker.backoff(new Date(clock.now().getTime() + delay), providerReason(error));
            await sleep(delay, controller.signal);
            if (controller.signal.aborted) return cancelledOut();
            continue;
          }
          // A JSON.parse SyntaxError quotes the model's text, so it is stored as a code, not a message.
          const notJson =
            error instanceof SyntaxError ||
            (error instanceof ProviderError && error.kind === 'not_json');
          // A refusal, truncation or non-JSON answer was billed: its usage counts against the cap (R2).
          const usage = error instanceof ProviderError ? error.usage : undefined;
          fail(
            notJson ? 'invalid_output: not_json' : `provider_error: ${reasonOf(error)}`,
            providerReason(error),
            usage && {
              usage,
              costMicroUsd: active.paid ? costMicroUsd(usage, deps.budget?.price ?? null) : 0,
            },
          );
          return error instanceof ProviderError && PROVIDER_WIDE.has(error.kind)
            ? 'stop'
            : 'continue';
        }
      }

      cancellable = undefined;
      // The call is billed from here on, so a rejected answer is stored with its cost too.
      const cost = active.paid ? costMicroUsd(provided.usage, deps.budget?.price ?? null) : 0;
      const billed = { usage: provided.usage, costMicroUsd: cost };

      const echoed = JSON.stringify(provided.output) ?? '';
      if ((deps.secrets ?? []).some((secret) => secret !== '' && echoed.includes(secret))) {
        fail('invalid_output: secret_echo', 'output_rejected', billed);
        return 'continue';
      }

      const parsed = OpportunityAnalysis.safeParse(provided.output);
      if (!parsed.success) {
        const paths = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))];
        fail(`invalid_output: ${paths.join(', ')}`, 'schema_validation', billed);
        return 'continue';
      }

      tracker.saving();
      const rejected = complete(
        row,
        { ...meta, usage: provided.usage, costMicroUsd: cost, reusedFromAnalysisId: null },
        parsed.data,
      );
      if (rejected) fail(rejected, 'output_rejected', billed);
      else tracker.finish('complete', null);
      return 'continue';
    } catch (error) {
      // After the provider answered: a failed save must not leave the row at the head of the queue.
      fail(`internal_error: ${reasonOf(error)}`, 'internal_error');
      return 'continue';
    } finally {
      cancellable = undefined;
    }
  }

  async function drainOnce(): Promise<void> {
    runPrefilter();
    if (!provider) return;
    // Checked per item: a cancel that lands between two items must not start the next call.
    while (
      !runnerState.isPaused() &&
      repository.countSince(startOfWarsawDay(clock.now()).getTime()) < deps.dailyLimit
    ) {
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
        paused: runnerState.isPaused(),
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
    async activity() {
      const now = clock.now();
      const host = (await deps.hostMetrics?.read()) ?? {
        temperatureC: null,
        load1: null,
        cpuCount: null,
        measuredAt: now,
      };
      const active = tracker.active();
      return {
        now: now.toISOString(),
        paused: runnerState.isPaused(),
        active,
        // The entry in flight is still `PENDING` until its result is saved, but it is not queued.
        queued: {
          total: Math.max(0, repository.waitingCount() - (active ? 1 : 0)),
          items: repository
            .waitingPreview(QUEUE_PREVIEW + 1)
            .filter((item) => item.id !== active?.opportunityId)
            .slice(0, QUEUE_PREVIEW)
            .map((item) => ({ opportunityId: item.id, title: item.title.slice(0, 120) })),
        },
        history: tracker.history(),
        timeoutMs: provider?.timeoutMs ?? 0,
        backendMayContinue: provider?.name === 'openai-compatible',
        host: { ...host, measuredAt: host.measuredAt.toISOString() },
      };
    },
    cancel() {
      runnerState.setPaused(true);
      const running = cancellable;
      cancellable = undefined;
      running?.abort();
      return { cancelled: running !== undefined };
    },
    resume() {
      runnerState.setPaused(false);
      kickDrain();
    },
    idle: () => inFlight ?? Promise.resolve(),
  };
}
