import type {
  OpportunityDetail,
  OpportunityList,
  OpportunityListQuery,
  OpportunitySummary,
} from '@lead-hunter/contracts';
import type {
  EvidenceRow,
  OpportunityRepository,
  OpportunityRow,
  SourceStatusReader,
} from './ports.js';

export interface OpportunityDeps {
  repository: OpportunityRepository;
  sourceStatus: SourceStatusReader;
}

export interface OpportunityService {
  list(query: OpportunityListQuery): OpportunityList;
  get(id: number): OpportunityDetail | undefined;
}

const EXCERPT_CHARS = 280;

const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));

function sourceFacts(row: OpportunityRow) {
  return {
    type: row.sourceType,
    url: row.sourceUrl,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    publishedAt: isoOrNull(row.publishedAt),
    fetchedAt: iso(row.fetchedAt),
    availability: row.availability,
    lastVerifiedAt: isoOrNull(row.lastVerifiedAt),
  };
}

/** D-8: null while every analysis column is empty (before S-04). */
function analysisOf(row: OpportunityRow): OpportunitySummary['analysis'] {
  const { category, evidenceLevel, score, confidence } = row;
  if (category === null && evidenceLevel === null && score === null && confidence === null) {
    return null;
  }
  return { category, evidenceLevel, score, confidence };
}

function base(row: OpportunityRow) {
  return {
    id: row.id,
    businessStatus: row.businessStatus,
    analysisStatus: row.analysisStatus,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    analysis: analysisOf(row),
  };
}

const toSummary = (row: OpportunityRow): OpportunitySummary => ({
  ...base(row),
  source: {
    ...sourceFacts(row),
    excerpt: Array.from(row.snippet).slice(0, EXCERPT_CHARS).join(''),
  },
});

const toEvidence = (row: EvidenceRow): OpportunityDetail['evidence'][number] => ({
  id: row.id,
  type: row.evidenceType,
  sourceFact: row.sourceFact,
  url: row.sourceUrl,
  extractedAt: iso(row.extractedAt),
});

export function createOpportunityService({
  repository,
  sourceStatus,
}: OpportunityDeps): OpportunityService {
  return {
    list({ from, to, ...rest }) {
      const { rows, total } = repository.list({
        ...rest,
        ...(from !== undefined ? { from: Date.parse(from) } : {}),
        ...(to !== undefined ? { to: Date.parse(to) } : {}),
      });
      return {
        items: rows.map(toSummary),
        page: rest.page,
        pageSize: rest.pageSize,
        total,
        sources: sourceStatus.summary(),
      };
    },
    get(id) {
      const found = repository.get(id);
      if (!found) return undefined;
      return {
        ...base(found.row),
        source: { ...sourceFacts(found.row), snippet: found.row.snippet },
        evidence: found.evidence.map(toEvidence),
      };
    },
  };
}
