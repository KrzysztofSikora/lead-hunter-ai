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

export interface LlmProvider {
  readonly name: 'mock';
  readonly model: string;
  readonly promptVersion: string;
  /** True for results that are rules, not AI analysis; every view labels them DEMO / MOCK. */
  readonly demo: boolean;
  analyzeOpportunity(input: AnalysisInput): Promise<ProviderOutput>;
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
  businessStatus: BusinessStatus;
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
  at: number;
}

/** Each write is one transaction (Phase 3 implements it). */
export interface AnalysisRepository {
  pendingWithoutPrefilter(): PendingOpportunity[];
  savePrefilter(id: number, result: PrefilterResult, at: number): void;
  /** Passed the pre-filter, still `PENDING`, best matches first (FR-07 AC3). */
  nextWaiting(limit: number): WaitingOpportunity[];
  countSince(at: number): number;
  waitingCount(): number;
  saveComplete(analysis: CompletedAnalysis): void;
  saveFailed(analysis: FailedAnalysis): void;
}

export type { AnalysisStatus };
