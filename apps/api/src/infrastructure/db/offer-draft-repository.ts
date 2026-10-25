import { and, count, desc, eq, gte, ne } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { OfferDraftRepository, OfferDraftRow } from '../../modules/offers/ports.js';
import { offerDrafts } from './schema.js';

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
      return db
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
    history(opportunityId, limit) {
      return db
        .select()
        .from(offerDrafts)
        .where(usable(opportunityId))
        .orderBy(desc(offerDrafts.id))
        .limit(limit)
        .offset(1)
        .all()
        .map(toOfferDraftRow);
    },
    countSince(at) {
      return (
        db.select({ value: count() }).from(offerDrafts).where(gte(offerDrafts.createdAt, at)).get()
          ?.value ?? 0
      );
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
