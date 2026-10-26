import { and, count, desc, eq, gte, ne } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
  OfferDraftRepository,
  OfferDraftRow,
  OfferSource,
  OfferSourceReader,
} from '../../modules/offers/ports.js';
import { deletedCountSince } from './analysis-repository.js';
import { analyses, deletedUsage, offerDrafts, opportunities, rawSignals } from './schema.js';

type Stored = typeof offerDrafts.$inferSelect;

export const toOfferDraftRow = (row: Stored): OfferDraftRow => ({
  ...row,
  status: row.status as OfferDraftRow['status'],
  analysed: row.analysed !== 0,
});

export function createOfferDraftRepository(db: BetterSQLite3Database): OfferDraftRepository {
  const usable = (opportunityId: number) =>
    and(eq(offerDrafts.opportunityId, opportunityId), ne(offerDrafts.status, 'FAILED'));

  return {
    insert(draft, at) {
      return db.transaction((tx) => {
        const owner = tx
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(eq(opportunities.id, draft.opportunityId))
          .get();
        // S-15 D-2: deleted during the provider call; the billed answer still counts.
        if (!owner) {
          tx.insert(deletedUsage)
            .values({
              kind: 'offer_draft',
              createdAt: at,
              costMicroUsd: draft.costMicroUsd,
              counted: 1,
              unknownCost:
                draft.status !== 'FAILED' &&
                draft.costMicroUsd === null &&
                draft.provider !== 'mock'
                  ? 1
                  : 0,
            })
            .run();
          return null;
        }
        return tx
          .insert(offerDrafts)
          .values({
            ...draft,
            analysed: draft.analysed ? 1 : 0,
            createdAt: at,
            updatedAt: at,
            statusChangedAt: at,
          })
          .returning({ id: offerDrafts.id })
          .get().id;
      });
    },
    get(id) {
      const row = db.select().from(offerDrafts).where(eq(offerDrafts.id, id)).get();
      return row ? toOfferDraftRow(row) : undefined;
    },
    current(opportunityId) {
      const row = db
        .select()
        .from(offerDrafts)
        .where(usable(opportunityId))
        .orderBy(desc(offerDrafts.id))
        .limit(1)
        .get();
      return row ? toOfferDraftRow(row) : undefined;
    },
    countSince(at) {
      const stored =
        db.select({ value: count() }).from(offerDrafts).where(gte(offerDrafts.createdAt, at)).get()
          ?.value ?? 0;
      return stored + deletedCountSince(db, 'offer_draft', at);
    },
    update(id, expected, changes, at) {
      const moved = changes.status !== undefined && changes.status !== expected;
      const result = db
        .update(offerDrafts)
        .set({
          ...changes,
          updatedAt: at,
          ...(moved ? { statusChangedAt: at } : {}),
        })
        .where(and(eq(offerDrafts.id, id), eq(offerDrafts.status, expected)))
        .run();
      return result.changes > 0;
    },
  };
}

/** What the offer prompt is built from: the source text and the newest completed analysis. */
export function createOfferSourceReader(db: BetterSQLite3Database): OfferSourceReader {
  return {
    source(opportunityId) {
      const row = db
        .select({
          title: rawSignals.title,
          text: rawSignals.snippet,
          sourceType: rawSignals.sourceType,
          language: opportunities.language,
        })
        .from(opportunities)
        .innerJoin(rawSignals, eq(opportunities.primarySignalId, rawSignals.id))
        .where(eq(opportunities.id, opportunityId))
        .get();
      if (!row) return undefined;
      const analysis = db
        .select({ resultJson: analyses.resultJson, schemaVersion: analyses.schemaVersion })
        .from(analyses)
        .where(and(eq(analyses.opportunityId, opportunityId), eq(analyses.status, 'COMPLETE')))
        .orderBy(desc(analyses.id))
        .limit(1)
        .get();
      return {
        ...row,
        sourceType: row.sourceType as OfferSource['sourceType'],
        language: row.language as OfferSource['language'],
        analysis: analysis?.resultJson
          ? { resultJson: analysis.resultJson, schemaVersion: analysis.schemaVersion }
          : null,
      };
    },
  };
}
