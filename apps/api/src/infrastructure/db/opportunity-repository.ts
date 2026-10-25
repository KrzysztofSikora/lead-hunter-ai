import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  like,
  lt,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  ActivityRow,
  AnalysisAttemptRow,
  EvidenceRow,
  OpportunityRepository,
  OpportunityRow,
} from '../../modules/opportunities/ports.js';
import {
  activityEvents,
  analyses,
  opportunities,
  opportunityEvidence,
  rawSignals,
} from './schema.js';

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
  prefilterRule: opportunities.prefilterRule,
  prefilterMatches: opportunities.prefilterMatches,
  prefilterAt: opportunities.prefilterAt,
  language: opportunities.language,
  analysisProvider: opportunities.analysisProvider,
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
        // D-13: a row is excluded only when its value is known and fails; unknown passes.
        filter.notOlderThan !== undefined
          ? gte(
              sql`coalesce(${rawSignals.publishedAt}, ${rawSignals.fetchedAt})`,
              filter.notOlderThan,
            )
          : undefined,
        filter.minAmount !== undefined && filter.currency !== undefined
          ? or(
              isNull(opportunities.amountMaxMinor),
              ne(opportunities.amountCurrency, filter.currency),
              gte(opportunities.amountMaxMinor, filter.minAmount),
            )
          : undefined,
        filter.language
          ? or(isNull(opportunities.language), eq(opportunities.language, filter.language))
          : undefined,
        filter.workMode
          ? or(isNull(opportunities.workMode), eq(opportunities.workMode, filter.workMode))
          : undefined,
        filter.country
          ? or(
              isNull(opportunities.countries),
              like(opportunities.countries, `%,${filter.country},%`),
            )
          : undefined,
        filter.excludeIndustries && filter.excludeIndustries.length > 0
          ? or(
              isNull(opportunities.industry),
              notInArray(
                sql`lower(${opportunities.industry})`,
                filter.excludeIndustries.map((industry) => industry.toLowerCase()),
              ),
            )
          : undefined,
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
      const latestAnalysis = db
        .select({
          status: analyses.status,
          provider: analyses.provider,
          model: analyses.model,
          promptVersion: analyses.promptVersion,
          schemaVersion: analyses.schemaVersion,
          resultJson: analyses.resultJson,
          breakdownJson: analyses.breakdownJson,
          guardNotesJson: analyses.guardNotesJson,
          error: analyses.error,
          inputTokens: analyses.inputTokens,
          outputTokens: analyses.outputTokens,
          costMicroUsd: analyses.costMicroUsd,
          reusedFromAnalysisId: analyses.reusedFromAnalysisId,
          createdAt: analyses.createdAt,
        })
        .from(analyses)
        .where(eq(analyses.opportunityId, id))
        .orderBy(desc(analyses.id))
        .limit(1)
        .get() as AnalysisAttemptRow | undefined;
      const activity = db
        .select({
          id: activityEvents.id,
          type: activityEvents.type,
          actor: activityEvents.actor,
          fromStatus: activityEvents.fromStatus,
          toStatus: activityEvents.toStatus,
          reason: activityEvents.reason,
          note: activityEvents.note,
          metadataJson: activityEvents.metadataJson,
          occurredAt: activityEvents.occurredAt,
        })
        .from(activityEvents)
        .where(eq(activityEvents.opportunityId, id))
        .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.id))
        .all() as ActivityRow[];
      return { row, evidence, latestAnalysis, activity };
    },
  };
}
