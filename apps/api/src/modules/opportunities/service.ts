import {
  OpportunityAnalysis,
  ScoreBreakdown,
  upgradeStoredAnalysis,
  type OpportunityDetail,
  type OpportunityList,
  type OpportunityListQuery,
  type OpportunitySummary,
} from '@lead-hunter/contracts';
import type { Clock } from '../shared/clock.js';
import type {
  AnalysisAttemptRow,
  EvidenceRow,
  OpportunityRepository,
  OpportunityRow,
  SourceStatusReader,
} from './ports.js';

export interface OpportunityDeps {
  repository: OpportunityRepository;
  sourceStatus: SourceStatusReader;
  clock: Clock;
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

/** Only the mock produces DEMO / MOCK results in this item (D-12). */
const isDemo = (provider: string | null): boolean => provider === 'mock';

/**
 * D-8: null while every analysis column is empty and nothing was analysed. A completed
 * INSUFFICIENT_DATA result has empty columns too, but still carries its provider (and DEMO label).
 */
function analysisOf(row: OpportunityRow): OpportunitySummary['analysis'] {
  const { category, evidenceLevel, score, confidence } = row;
  const analysed = row.analysisStatus === 'COMPLETE' && row.analysisProvider !== null;
  if (
    !analysed &&
    category === null &&
    evidenceLevel === null &&
    score === null &&
    confidence === null
  ) {
    return null;
  }
  return { category, evidenceLevel, score, confidence, demo: isDemo(row.analysisProvider) };
}

function base(row: OpportunityRow) {
  return {
    id: row.id,
    businessStatus: row.businessStatus,
    analysisStatus: row.analysisStatus,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    analysis: analysisOf(row),
    prefilter:
      row.prefilterAt === null
        ? null
        : { rule: row.prefilterRule, matches: row.prefilterMatches ?? 0, language: row.language },
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

/** Stored JSON was written by this service's own schema; a row that no longer parses reads as absent. */
function parseStored<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  json: string | null,
  upgrade: (value: unknown) => unknown = (value) => value,
): T | null {
  if (json === null) return null;
  try {
    const parsed = schema.safeParse(upgrade(JSON.parse(json)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toLatestAnalysis(row: AnalysisAttemptRow): OpportunityDetail['latestAnalysis'] {
  return {
    status: row.status,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    schemaVersion: row.schemaVersion,
    demo: isDemo(row.provider),
    createdAt: iso(row.createdAt),
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    result: parseStored(OpportunityAnalysis, row.resultJson, (value) =>
      upgradeStoredAnalysis(value, row.schemaVersion),
    ),
    breakdown: parseStored(ScoreBreakdown, row.breakdownJson),
    guardNotes: row.guardNotesJson === null ? [] : parseNotes(row.guardNotesJson),
    error: row.error,
  };
}

function parseNotes(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

const DAY_MS = 86_400_000;

export function createOpportunityService({
  repository,
  sourceStatus,
  clock,
}: OpportunityDeps): OpportunityService {
  return {
    list({ from, to, maxAgeDays, ...rest }) {
      const { rows, total } = repository.list({
        ...rest,
        ...(maxAgeDays !== undefined
          ? { notOlderThan: clock.now().getTime() - maxAgeDays * DAY_MS }
          : {}),
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
        latestAnalysis: found.latestAnalysis ? toLatestAnalysis(found.latestAnalysis) : null,
      };
    },
  };
}
