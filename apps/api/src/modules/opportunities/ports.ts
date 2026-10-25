import type {
  Availability,
  AnalysisStatus,
  BusinessStatus,
  Category,
  Confidence,
  EvidenceLevel,
  OpportunityListQuery,
  SourceType,
  SourcesStatus,
} from '@lead-hunter/contracts';

/** An opportunity joined with its primary signal. Times are UTC epoch ms. */
export interface OpportunityRow {
  id: number;
  businessStatus: BusinessStatus;
  analysisStatus: AnalysisStatus;
  category: Category | null;
  evidenceLevel: EvidenceLevel | null;
  score: number | null;
  confidence: Confidence | null;
  createdAt: number;
  updatedAt: number;
  sourceType: SourceType;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  title: string;
  snippet: string;
  publishedAt: number | null;
  fetchedAt: number;
  availability: Availability;
  lastVerifiedAt: number | null;
}

export interface EvidenceRow {
  id: number;
  evidenceType: 'IMPORT' | 'REPEAT_IMPORT';
  sourceFact: string;
  sourceUrl: string | null;
  extractedAt: number;
}

export interface OpportunityFilter extends Omit<OpportunityListQuery, 'from' | 'to'> {
  /** Inclusive, epoch ms. */
  from?: number;
  /** Exclusive, epoch ms. */
  to?: number;
}

export interface OpportunityRepository {
  list(filter: OpportunityFilter): { rows: OpportunityRow[]; total: number };
  get(id: number): { row: OpportunityRow; evidence: EvidenceRow[] } | undefined;
}

/** D-10: replaced by job-run data in S-10/S-12. */
export interface SourceStatusReader {
  summary(): SourcesStatus;
}
