import { and, asc, count, desc, eq, gte, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  EvidenceRow,
  OpportunityRepository,
  OpportunityRow,
} from '../../modules/opportunities/ports.js';
import { opportunities, opportunityEvidence, rawSignals } from './schema.js';

const columns = {
  id: opportunities.id,
  businessStatus: opportunities.businessStatus,
  analysisStatus: opportunities.analysisStatus,
  category: opportunities.category,
  evidenceLevel: opportunities.evidenceLevel,
  score: opportunities.score,
  confidence: opportunities.confidence,
  createdAt: opportunities.createdAt,
  updatedAt: opportunities.updatedAt,
  sourceType: rawSignals.sourceType,
  sourceUrl: rawSignals.sourceUrl,
  canonicalUrl: rawSignals.canonicalUrl,
  title: rawSignals.title,
  snippet: rawSignals.snippet,
  publishedAt: rawSignals.publishedAt,
  fetchedAt: rawSignals.fetchedAt,
  availability: rawSignals.availability,
  lastVerifiedAt: rawSignals.lastVerifiedAt,
};

export function createOpportunityRepository(db: BetterSQLite3Database): OpportunityRepository {
  // The columns hold the contract's enums; only this repository writes them.
  const joined = () =>
    db
      .select(columns)
      .from(opportunities)
      .innerJoin(rawSignals, eq(opportunities.primarySignalId, rawSignals.id));

  return {
    list(filter) {
      const conditions: (SQL | undefined)[] = [
        filter.minScore !== undefined
          ? and(isNotNull(opportunities.score), gte(opportunities.score, filter.minScore))
          : undefined,
        filter.category ? eq(opportunities.category, filter.category) : undefined,
        filter.sourceType ? eq(rawSignals.sourceType, filter.sourceType) : undefined,
        filter.status ? eq(opportunities.businessStatus, filter.status) : undefined,
        filter.from !== undefined ? gte(opportunities.createdAt, filter.from) : undefined,
        filter.to !== undefined ? lt(opportunities.createdAt, filter.to) : undefined,
      ];
      const where = and(...conditions);

      const order =
        filter.sort === 'score'
          ? [
              // Unscored last, then highest score, then newest.
              asc(sql`${opportunities.score} IS NULL`),
              desc(opportunities.score),
              desc(opportunities.createdAt),
              desc(opportunities.id),
            ]
          : [desc(opportunities.createdAt), desc(opportunities.id)];

      const rows = joined()
        .where(where)
        .orderBy(...order)
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize)
        .all() as OpportunityRow[];

      const total =
        db
          .select({ value: count() })
          .from(opportunities)
          .innerJoin(rawSignals, eq(opportunities.primarySignalId, rawSignals.id))
          .where(where)
          .get()?.value ?? 0;

      return { rows, total };
    },
    get(id) {
      const row = joined().where(eq(opportunities.id, id)).get() as OpportunityRow | undefined;
      if (!row) return undefined;
      const evidence = db
        .select({
          id: opportunityEvidence.id,
          evidenceType: opportunityEvidence.evidenceType,
          sourceFact: opportunityEvidence.sourceFact,
          sourceUrl: opportunityEvidence.sourceUrl,
          extractedAt: opportunityEvidence.extractedAt,
        })
        .from(opportunityEvidence)
        .where(eq(opportunityEvidence.opportunityId, id))
        .orderBy(asc(opportunityEvidence.id))
        .all() as EvidenceRow[];
      return { row, evidence };
    },
  };
}
