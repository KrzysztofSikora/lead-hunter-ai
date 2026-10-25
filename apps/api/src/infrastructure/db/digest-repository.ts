import {
  OpportunityAnalysis,
  upgradeStoredAnalysis,
  WEAK_CATEGORIES,
  WEAK_EVIDENCE,
  type BusinessStatus,
  type Category,
  type EvidenceLevel,
  type SourceFailureReason,
} from '@lead-hunter/contracts';
import { and, count, desc, eq, gte, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DigestCandidateRow, DigestRepository } from '../../modules/digest/ports.js';
import { analyses, opportunities, rawSignals, sources } from './schema.js';

/** S-13 D-3: statuses of rows that still wait for a decision. */
const OPEN_STATUSES: BusinessStatus[] = ['NEW', 'QUALIFIED', 'SAVED', 'OFFER_DRAFTED'];

export function createDigestRepository(db: BetterSQLite3Database): DigestRepository {
  /** Not weak (D-4): neither a weak category nor a weak evidence level. */
  const mainSection = and(
    isNotNull(opportunities.score),
    notInArray(opportunities.category, [...WEAK_CATEGORIES]),
    notInArray(opportunities.evidenceLevel, [...WEAK_EVIDENCE]),
  );

  return {
    sourceHealth() {
      const rows = db
        .select({
          id: sources.id,
          name: sources.name,
          lastAttemptAt: sources.lastAttemptAt,
          reason: sources.lastErrorReason,
          status: sources.lastErrorStatus,
          errorAt: sources.lastErrorAt,
        })
        .from(sources)
        .where(eq(sources.enabled, true))
        .orderBy(desc(sources.lastErrorAt))
        .all();
      const errors = rows.flatMap((row) =>
        row.reason === null || row.errorAt === null
          ? []
          : [
              {
                sourceId: row.id,
                source: row.name,
                reason: row.reason as SourceFailureReason,
                ...(row.status === null ? {} : { httpStatus: row.status }),
                at: new Date(row.errorAt).toISOString(),
              },
            ],
      );
      const notChecked = rows.filter((row) => row.lastAttemptAt === null).length;
      return {
        ok: rows.length - notChecked - errors.length,
        error: errors.length,
        notChecked,
        errors,
      };
    },
    countSignalsSince(since) {
      return (
        db.select({ n: count() }).from(rawSignals).where(gte(rawSignals.fetchedAt, since)).get()
          ?.n ?? 0
      );
    },
    countMainScoredSince(since, minScore) {
      return (
        db
          .select({ n: count() })
          .from(opportunities)
          .where(
            and(
              gte(opportunities.createdAt, since),
              gte(opportunities.score, minScore),
              mainSection,
            ),
          )
          .get()?.n ?? 0
      );
    },
    candidates(since, limit) {
      const rows = db
        .select({
          id: opportunities.id,
          title: rawSignals.title,
          category: opportunities.category,
          evidenceLevel: opportunities.evidenceLevel,
          score: opportunities.score,
          businessStatus: opportunities.businessStatus,
          createdAt: opportunities.createdAt,
          provider: opportunities.analysisProvider,
        })
        .from(opportunities)
        .innerJoin(rawSignals, eq(opportunities.primarySignalId, rawSignals.id))
        .where(
          and(
            inArray(opportunities.businessStatus, OPEN_STATUSES),
            eq(opportunities.analysisStatus, 'COMPLETE'),
            gte(opportunities.createdAt, since),
            // A completed analysis with insufficient data has none of these (plan-review 1).
            isNotNull(opportunities.score),
            isNotNull(opportunities.category),
            isNotNull(opportunities.evidenceLevel),
          ),
        )
        .orderBy(desc(opportunities.score), desc(opportunities.id))
        .limit(limit)
        .all();
      if (rows.length === 0) return [];

      const latest = new Map<number, { resultJson: string | null; schemaVersion: number }>();
      for (const analysis of db
        .select({
          opportunityId: analyses.opportunityId,
          resultJson: analyses.resultJson,
          schemaVersion: analyses.schemaVersion,
        })
        .from(analyses)
        .where(
          inArray(
            analyses.opportunityId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(analyses.id)
        .all()) {
        latest.set(analysis.opportunityId, analysis);
      }

      return rows.map((row): DigestCandidateRow => {
        const stored = latest.get(row.id);
        let buyer: string | null = null;
        let nextAction: string | null = null;
        if (stored?.resultJson) {
          try {
            const parsed = OpportunityAnalysis.safeParse(
              upgradeStoredAnalysis(JSON.parse(stored.resultJson), stored.schemaVersion),
            );
            if (parsed.success && parsed.data.verdict === 'ANALYSED') {
              buyer = parsed.data.buyerOrAudience;
              nextAction = parsed.data.nextAction;
            }
          } catch {
            // unreadable JSON: the columns stay, the analysis fields are "brak"
          }
        }
        return {
          ...row,
          score: row.score as number,
          category: row.category as Category,
          evidenceLevel: row.evidenceLevel as EvidenceLevel,
          businessStatus: row.businessStatus as BusinessStatus,
          buyer,
          nextAction,
        };
      });
    },
    llmUsageSince(since) {
      const row = db
        .select({
          n: count(),
          input: sql<number | null>`sum(${analyses.inputTokens})`,
          output: sql<number | null>`sum(${analyses.outputTokens})`,
        })
        .from(analyses)
        .where(gte(analyses.createdAt, since))
        .get();
      return {
        analyses: row?.n ?? 0,
        inputTokens: row?.input ?? null,
        outputTokens: row?.output ?? null,
      };
    },
  };
}
