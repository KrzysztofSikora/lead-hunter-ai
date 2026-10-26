import type {
  AnalysisStatus,
  BusinessStatus,
  OperatorProfile,
  PrefilterRule,
  ScoreBreakdown,
  SourceType,
} from '@lead-hunter/contracts';

/**
 * What a provider receives: data only, never configuration, keys or other opportunities (TR-02).
 * The source text is untrusted content, not an instruction (PRD §6.4).
 */
export interface AnalysisInput {
  schemaVersion: number;
  source: { title: string; text: string; url: string | null; sourceType: SourceType };
  profile: Pick<
    OperatorProfile,
    | 'skills'
    | 'serviceTypes'
    | 'preferredTechnologies'
    | 'excludedTechnologies'
    | 'languages'
    | 'rateRanges'
  >;
}

export interface ProviderOutput {
  /** Unvalidated: the runner parses it with the shared schema. */
  output: unknown;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

/** Why a provider call failed; the runner stores only the kind, never an SDK message (D-9). */
export type ProviderErrorKind =
  | 'auth'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'bad_request'
  | 'refusal'
  | 'truncated'
  | 'empty'
  | 'not_json'
  /** The app's own abort (FR-34 AC3); never produced by a provider. */
  | 'cancelled';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly status?: number,
    /** Set when the provider answered and billed the call before the answer was rejected. */
    readonly usage?: ProviderOutput['usage'],
    /** The provider's `Retry-After`, bounded; the runner decides whether to wait that long. */
    readonly retryAfterMs?: number,
  ) {
    super(status === undefined ? kind : `${kind} ${status}`);
    this.name = 'ProviderError';
  }
}

export interface LlmProvider {
  readonly name: 'mock' | 'anthropic' | 'openai-compatible';
  /** A paid provider needs a monthly cap before it may run (FR-09 AC1). */
  readonly paid: boolean;
  readonly model: string;
  readonly promptVersion: string;
  /** True for results that are rules, not AI analysis; every view labels them DEMO / MOCK. */
  readonly demo: boolean;
  /** The per-request limit in ms the view compares elapsed time with; 0 means no limit. */
  readonly timeoutMs: number;
  /** An aborted `signal` ends the request and rejects with a `cancelled` `ProviderError`. */
  analyzeOpportunity(
    input: AnalysisInput,
    options?: { signal?: AbortSignal },
  ): Promise<ProviderOutput>;
}

/** One reading of the host; a value that could not be read is `null`, never 0. */
export interface HostSnapshot {
  temperatureC: number | null;
  load1: number | null;
  cpuCount: number | null;
  measuredAt: Date;
}

/** FR-34 AC3, D-4: whether the operator stopped the queue; it survives a restart. */
export interface RunnerState {
  isPaused(): boolean;
  setPaused(paused: boolean): void;
}

export interface HostMetrics {
  read(): Promise<HostSnapshot>;
}

export interface ProfileReader {
  get(): OperatorProfile;
}

export interface WaitingOpportunity {
  id: number;
  title: string;
  text: string;
  url: string | null;
  sourceType: SourceType;
  /** S-18 D-2: stored tender facts (JSON), parsed by the runner before the guard. */
  tenderJson: string | null;
  /** S-19 D-2: stored bounty facts (JSON), parsed by the runner before the guard. */
  bountyJson: string | null;
  businessStatus: BusinessStatus;
  /** D-10: the operator asked for a new provider call, so no stored result may be reused. */
  force: boolean;
}

export interface PendingOpportunity extends WaitingOpportunity {
  publishedAt: number | null;
}

export interface PrefilterResult {
  rule: PrefilterRule | null;
  matches: number;
  language: 'pl' | 'en' | null;
}

export interface CompletedAnalysis {
  opportunityId: number;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: number;
  resultJson: string;
  breakdown: ScoreBreakdown | null;
  guardNotes: string[];
  usage: ProviderOutput['usage'];
  /** Micro-USD; 0 for an unpaid provider, null when usage or price is unknown (D-2, D-14). */
  costMicroUsd: number | null;
  /** The analysis whose result this row copies instead of calling a provider (D-4). */
  reusedFromAnalysisId: number | null;
  /** Columns copied onto the opportunity so list filters stay plain SQL (D-8). */
  columns: {
    category: string | null;
    evidenceLevel: string | null;
    score: number | null;
    confidence: string | null;
    industry: string | null;
    workMode: string | null;
    countries: string | null;
    amountMaxMinor: number | null;
    amountCurrency: string | null;
    /** Applied only while the opportunity is still `NEW` (D-17). */
    businessStatus: BusinessStatus | null;
  };
  at: number;
}

export interface FailedAnalysis {
  opportunityId: number;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: number;
  error: string;
  /** Present when the provider answered but the answer was rejected: the call still cost. */
  usage?: ProviderOutput['usage'];
  costMicroUsd?: number | null;
  at: number;
}

/** A stored result that may answer a new opportunity with the same content (D-4). */
export interface ReusableAnalysis {
  id: number;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: number;
  resultJson: string;
  usage: ProviderOutput['usage'];
}

export interface Spent {
  microUsd: number;
  /** Completed real-provider answers whose cost is unknown (FR-09 AC4). */
  unknownCount: number;
}

/** Each write is one transaction (Phase 3 implements it). */
export interface AnalysisRepository {
  pendingWithoutPrefilter(): PendingOpportunity[];
  /**
   * With a rule the opportunity becomes `SKIPPED`; `moveTo` is the business status it takes, applied
   * only while it is still `NEW` (D-5, D-17).
   */
  savePrefilter(
    id: number,
    result: PrefilterResult,
    at: number,
    moveTo: BusinessStatus | null,
  ): void;
  /** Passed the pre-filter, still `PENDING`, best matches first (FR-07 AC3). */
  nextWaiting(limit: number): WaitingOpportunity[];
  /** Provider attempts since `at`; a reused row costs no provider call and is not counted. */
  countSince(at: number): number;
  /** Month-to-date spend over the rows created since `at` (D-5, D-14). */
  spentSince(at: number): Spent;
  /**
   * The newest completed, non-reused analysis of an opportunity with the same primary-signal
   * content hash and the given versions; a null hash never matches (D-4).
   */
  findReusable(
    opportunityId: number,
    promptVersion: string,
    schemaVersion: number,
  ): ReusableAnalysis | undefined;
  /** Puts an analysed, failed or waiting opportunity back in the queue (D-10); false if it cannot. */
  requeue(id: number, force: boolean, at: number): boolean;
  /** Tells a missing opportunity from one the pre-filter skipped when `requeue` says no. */
  exists(id: number): boolean;
  waitingCount(): number;
  /** The head of the queue without the source text (the activity view polls it). */
  waitingPreview(limit: number): { id: number; title: string }[];
  saveComplete(analysis: CompletedAnalysis): void;
  saveFailed(analysis: FailedAnalysis): void;
  /** D-12: `FAILED` back to `PENDING`; the failed attempt stays as history. One UPDATE. */
  retryFailed(id: number, at: number): 'reset' | 'not_failed' | 'not_found';
}

export type { AnalysisStatus };
