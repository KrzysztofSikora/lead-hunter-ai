import {
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisServiceStatus,
  OpportunityAnalysis,
  ScoreBreakdown,
  type BusinessStatus,
  type PrefilterRule,
} from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';
import { startOfWarsawDay } from '../shared/warsaw-day.js';
import { scoreAnalysis } from '../scoring/score.js';
import { guardAnalysis } from './output-guard.js';
import { prefilter } from './prefilter.js';
import type {
  AnalysisInput,
  AnalysisRepository,
  CompletedAnalysis,
  LlmProvider,
  ProfileReader,
  WaitingOpportunity,
} from './ports.js';

export interface AnalysisDeps {
  repository: AnalysisRepository;
  /** Absent when `LLM_PROVIDER` is unset: the pre-filter still runs, nothing is analysed. */
  provider: LlmProvider | undefined;
  profile: ProfileReader;
  clock: Clock;
  /** Analyses per Europe/Warsaw day (D-9). */
  dailyLimit: number;
  maxAgeDays: number;
  /** Receives drain failures; must not log source text. */
  onError: (error: unknown) => void;
}

export interface AnalysisRunner {
  /** Pre-filters and analyses what waits. A call during a drain makes it run once more. */
  drain(): Promise<void>;
  /** Fire and forget: errors go to `onError`. */
  kick(): void;
  /** D-11: what the UI and the brief need to say how much analysis is done and waiting. */
  status(): AnalysisServiceStatus;
  /** Resolves when no drain is in flight. */
  idle(): Promise<void>;
}

/** D-5: a missing text waits for verification; every other rule is a rejection. */
const moveFor = (rule: PrefilterRule | null): BusinessStatus | null => {
  if (rule === null) return null;
  return rule === 'no_text' ? 'NEEDS_VERIFICATION' : 'REJECTED';
};

const REASON_MAX = 300;
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

  async function analyseOne(row: WaitingOpportunity, active: LlmProvider): Promise<void> {
    const at = clock.now().getTime();
    const meta = {
      opportunityId: row.id,
      provider: active.name,
      model: active.model,
      promptVersion: active.promptVersion,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      at,
    };
    const fail = (error: string) => repository.saveFailed({ ...meta, error });

    try {
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
        fail(`provider_error: ${reasonOf(error)}`);
        return;
      }

      const parsed = OpportunityAnalysis.safeParse(provided.output);
      if (!parsed.success) {
        const paths = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(root)'))];
        fail(`invalid_output: ${paths.join(', ')}`);
        return;
      }

      const guarded = guardAnalysis(parsed.data, row.text);
      const result = guarded.result;
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
        usage: provided.usage,
        columns,
      });
    } catch (error) {
      // After the provider answered: a failed save must not leave the row at the head of the queue.
      fail(`internal_error: ${reasonOf(error)}`);
    }
  }

  async function drainOnce(): Promise<void> {
    runPrefilter();
    if (!provider) return;
    while (repository.countSince(startOfWarsawDay(clock.now()).getTime()) < deps.dailyLimit) {
      const [next] = repository.nextWaiting(1);
      if (!next) return;
      await analyseOne(next, provider);
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

  return {
    drain,
    kick() {
      drain().catch(deps.onError);
    },
    status() {
      const analysedToday = repository.countSince(startOfWarsawDay(clock.now()).getTime());
      return {
        configured: provider !== undefined,
        provider: provider?.name ?? null,
        demo: provider?.demo ?? false,
        dailyLimit: deps.dailyLimit,
        analysedToday,
        waiting: repository.waitingCount(),
        limitReached: analysedToday >= deps.dailyLimit,
      };
    },
    idle: () => inFlight ?? Promise.resolve(),
  };
}
