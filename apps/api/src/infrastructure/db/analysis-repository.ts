import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  AnalysisRepository,
  PendingOpportunity,
  WaitingOpportunity,
} from '../../modules/analysis/ports.js';
import { analyses, opportunities, rawSignals } from './schema.js';

const selection = {
  id: opportunities.id,
  title: rawSignals.title,
  text: rawSignals.snippet,
  url: rawSignals.sourceUrl,
  sourceType: rawSignals.sourceType,
  businessStatus: opportunities.businessStatus,
  force: sql<number>`${opportunities.analysisForce} <> 0`.mapWith(Boolean),
  publishedAt: rawSignals.publishedAt,
};

/** Passed the pre-filter and still waiting for an analysis. */
const waiting = and(
  eq(opportunities.analysisStatus, 'PENDING'),
  isNotNull(opportunities.prefilterAt),
  isNull(opportunities.prefilterRule),
);

/** Moves the business status only while it is still `NEW` (D-17). */
const moveFromNew = (status: string | null) =>
  sql`CASE WHEN ${opportunities.businessStatus} = 'NEW' AND ${status} IS NOT NULL THEN ${status} ELSE ${opportunities.businessStatus} END`;

export function createAnalysisRepository(db: BetterSQLite3Database): AnalysisRepository {
  const joined = () =>
    db
      .select(selection)
      .from(opportunities)
      .innerJoin(rawSignals, eq(opportunities.primarySignalId, rawSignals.id));

  return {
    pendingWithoutPrefilter() {
      return joined()
        .where(and(eq(opportunities.analysisStatus, 'PENDING'), isNull(opportunities.prefilterAt)))
        .orderBy(asc(opportunities.id))
        .all() as PendingOpportunity[];
    },
    savePrefilter(id, result, at, moveTo) {
      db.update(opportunities)
        .set({
          prefilterRule: result.rule,
          prefilterMatches: result.matches,
          prefilterAt: at,
          language: result.language,
          ...(result.rule !== null
            ? { analysisStatus: 'SKIPPED', businessStatus: moveFromNew(moveTo), updatedAt: at }
            : {}),
        })
        .where(eq(opportunities.id, id))
        .run();
    },
    nextWaiting(limit) {
      return joined()
        .where(waiting)
        .orderBy(
          desc(opportunities.prefilterMatches),
          asc(opportunities.createdAt),
          asc(opportunities.id),
        )
        .limit(limit)
        .all() as WaitingOpportunity[];
    },
    countSince(at) {
      return (
        db
          .select({ value: count() })
          .from(analyses)
          .where(and(gte(analyses.createdAt, at), isNull(analyses.reusedFromAnalysisId)))
          .get()?.value ?? 0
      );
    },
    spentSince(at) {
      const row = db
        .select({
          microUsd: sql<number>`COALESCE(SUM(${analyses.costMicroUsd}), 0)`,
          unknownCount: sql<number>`COALESCE(SUM(CASE WHEN ${analyses.status} = 'COMPLETE' AND ${analyses.costMicroUsd} IS NULL AND ${analyses.provider} <> 'mock' AND ${analyses.reusedFromAnalysisId} IS NULL THEN 1 ELSE 0 END), 0)`,
        })
        .from(analyses)
        .where(gte(analyses.createdAt, at))
        .get();
      return { microUsd: row?.microUsd ?? 0, unknownCount: row?.unknownCount ?? 0 };
    },
    findReusable(opportunityId, promptVersion, schemaVersion) {
      const own = db
        .select({ hash: rawSignals.contentHash })
        .from(opportunities)
        .innerJoin(rawSignals, eq(opportunities.primarySignalId, rawSignals.id))
        .where(eq(opportunities.id, opportunityId))
        .get();
      if (!own?.hash) return undefined;
      const hit = db
        .select({
          id: analyses.id,
          provider: analyses.provider,
          model: analyses.model,
          promptVersion: analyses.promptVersion,
          schemaVersion: analyses.schemaVersion,
          resultJson: analyses.resultJson,
          inputTokens: analyses.inputTokens,
          outputTokens: analyses.outputTokens,
        })
        .from(analyses)
        .innerJoin(opportunities, eq(analyses.opportunityId, opportunities.id))
        .innerJoin(rawSignals, eq(opportunities.primarySignalId, rawSignals.id))
        .where(
          and(
            eq(rawSignals.contentHash, own.hash),
            eq(analyses.status, 'COMPLETE'),
            isNull(analyses.reusedFromAnalysisId),
            isNotNull(analyses.resultJson),
            eq(analyses.promptVersion, promptVersion),
            eq(analyses.schemaVersion, schemaVersion),
          ),
        )
        .orderBy(desc(analyses.id))
        .limit(1)
        .get();
      if (!hit || hit.resultJson === null) return undefined;
      return {
        id: hit.id,
        provider: hit.provider,
        model: hit.model,
        promptVersion: hit.promptVersion,
        schemaVersion: hit.schemaVersion,
        resultJson: hit.resultJson,
        usage: { inputTokens: hit.inputTokens, outputTokens: hit.outputTokens },
      };
    },
    requeue(id, force, at) {
      return (
        db
          .update(opportunities)
          .set({ analysisStatus: 'PENDING', analysisForce: force ? 1 : 0, updatedAt: at })
          .where(
            and(
              eq(opportunities.id, id),
              inArray(opportunities.analysisStatus, ['PENDING', 'FAILED', 'COMPLETE']),
              isNull(opportunities.prefilterRule),
            ),
          )
          .run().changes > 0
      );
    },
    waitingCount() {
      return db.select({ value: count() }).from(opportunities).where(waiting).get()?.value ?? 0;
    },
    saveComplete(analysis) {
      db.transaction((tx) => {
        tx.insert(analyses)
          .values({
            opportunityId: analysis.opportunityId,
            status: 'COMPLETE',
            provider: analysis.provider,
            model: analysis.model,
            promptVersion: analysis.promptVersion,
            schemaVersion: analysis.schemaVersion,
            resultJson: analysis.resultJson,
            breakdownJson: analysis.breakdown ? JSON.stringify(analysis.breakdown) : null,
            guardNotesJson: JSON.stringify(analysis.guardNotes),
            inputTokens: analysis.usage.inputTokens,
            outputTokens: analysis.usage.outputTokens,
            costMicroUsd: analysis.costMicroUsd,
            reusedFromAnalysisId: analysis.reusedFromAnalysisId,
            createdAt: analysis.at,
          })
          .run();
        const { columns } = analysis;
        tx.update(opportunities)
          .set({
            analysisStatus: 'COMPLETE',
            analysisForce: 0,
            analysisProvider: analysis.provider,
            category: columns.category,
            evidenceLevel: columns.evidenceLevel,
            score: columns.score,
            confidence: columns.confidence,
            industry: columns.industry,
            workMode: columns.workMode,
            countries: columns.countries,
            amountMaxMinor: columns.amountMaxMinor,
            amountCurrency: columns.amountCurrency,
            businessStatus: moveFromNew(columns.businessStatus),
            updatedAt: analysis.at,
          })
          .where(eq(opportunities.id, analysis.opportunityId))
          .run();
      });
    },
    saveFailed(analysis) {
      db.transaction((tx) => {
        tx.insert(analyses)
          .values({
            opportunityId: analysis.opportunityId,
            status: 'FAILED',
            provider: analysis.provider,
            model: analysis.model,
            promptVersion: analysis.promptVersion,
            schemaVersion: analysis.schemaVersion,
            error: analysis.error,
            inputTokens: analysis.usage?.inputTokens ?? null,
            outputTokens: analysis.usage?.outputTokens ?? null,
            costMicroUsd: analysis.costMicroUsd ?? null,
            createdAt: analysis.at,
          })
          .run();
        tx.update(opportunities)
          .set({
            analysisStatus: 'FAILED',
            analysisForce: 0,
            analysisProvider: analysis.provider,
            updatedAt: analysis.at,
          })
          .where(eq(opportunities.id, analysis.opportunityId))
          .run();
      });
    },
  };
}
