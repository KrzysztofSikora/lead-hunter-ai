import { and, asc, count, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  AnalysisRepository,
  PendingOpportunity,
  WaitingOpportunity,
} from '../../modules/analysis/ports.js';
import { activityEvents, analyses, opportunities, rawSignals } from './schema.js';

const selection = {
  id: opportunities.id,
  title: rawSignals.title,
  text: rawSignals.snippet,
  url: rawSignals.sourceUrl,
  sourceType: rawSignals.sourceType,
  businessStatus: opportunities.businessStatus,
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

type Tx = Parameters<Parameters<BetterSQLite3Database['transaction']>[0]>[0];

/** The status before an update; the system event is written only when it was `NEW` (D-8). */
const statusOf = (tx: Tx, id: number): string | undefined =>
  tx
    .select({ status: opportunities.businessStatus })
    .from(opportunities)
    .where(eq(opportunities.id, id))
    .get()?.status;

function recordSystemMove(
  tx: Tx,
  id: number,
  before: string | undefined,
  to: string | null,
  cause: object,
  at: number,
): void {
  if (before !== 'NEW' || to === null) return;
  tx.insert(activityEvents)
    .values({
      opportunityId: id,
      type: 'STATUS_CHANGE',
      actor: 'system',
      fromStatus: before,
      toStatus: to,
      metadataJson: JSON.stringify(cause),
      occurredAt: at,
    })
    .run();
}

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
      db.transaction((tx) => {
        const before = statusOf(tx, id);
        tx.update(opportunities)
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
        if (result.rule !== null) {
          recordSystemMove(tx, id, before, moveTo, { kind: 'prefilter', rule: result.rule }, at);
        }
      });
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
        db.select({ value: count() }).from(analyses).where(gte(analyses.createdAt, at)).get()
          ?.value ?? 0
      );
    },
    waitingCount() {
      return db.select({ value: count() }).from(opportunities).where(waiting).get()?.value ?? 0;
    },
    saveComplete(analysis) {
      db.transaction((tx) => {
        const before = statusOf(tx, analysis.opportunityId);
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
            createdAt: analysis.at,
          })
          .run();
        const { columns } = analysis;
        tx.update(opportunities)
          .set({
            analysisStatus: 'COMPLETE',
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
        recordSystemMove(
          tx,
          analysis.opportunityId,
          before,
          columns.businessStatus,
          { kind: 'insufficient_data' },
          analysis.at,
        );
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
            createdAt: analysis.at,
          })
          .run();
        tx.update(opportunities)
          .set({
            analysisStatus: 'FAILED',
            analysisProvider: analysis.provider,
            updatedAt: analysis.at,
          })
          .where(eq(opportunities.id, analysis.opportunityId))
          .run();
      });
    },
  };
}
