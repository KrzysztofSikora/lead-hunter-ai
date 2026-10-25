import type { BusinessStatus, Category, EvidenceLevel, SourceError } from '@lead-hunter/contracts';

/** A scored, open, completed opportunity. Times are UTC epoch ms. */
export interface DigestCandidateRow {
  id: number;
  title: string;
  category: Category;
  evidenceLevel: EvidenceLevel;
  score: number;
  businessStatus: BusinessStatus;
  createdAt: number;
  provider: string | null;
  /** From the latest stored analysis; null when it is missing or does not validate. */
  buyer: string | null;
  nextAction: string | null;
}

export interface DigestRepository {
  /** Enabled sources only (D-11); `errors` newest first. */
  sourceHealth(): { ok: number; error: number; notChecked: number; errors: SourceError[] };
  countSignalsSince(since: number): number;
  /** Main-section rows (not weak) created since `since` with `score >= minScore` (D-4, D-8). */
  countMainScoredSince(since: number, minScore: number): number;
  /** Open, completed, scored rows created since `since`, best score first, at most `limit`. */
  candidates(since: number, limit: number): DigestCandidateRow[];
  /** Analyses stored since `since`; a token sum is null when no row reported tokens. */
  llmUsageSince(since: number): {
    analyses: number;
    inputTokens: number | null;
    outputTokens: number | null;
  };
}
