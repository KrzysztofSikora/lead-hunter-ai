import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { ProfileRepository } from '../../modules/profile/ports.js';
import { operatorProfile } from './schema.js';

const ROW_ID = 1;

export function createProfileRepository(db: BetterSQLite3Database): ProfileRepository {
  return {
    get() {
      const row = db.select().from(operatorProfile).where(eq(operatorProfile.id, ROW_ID)).get();
      if (!row) return undefined;
      return {
        data: row.data,
        isExample: row.isExample,
        updatedAt: row.updatedAt,
        schemaVersion: row.schemaVersion,
      };
    },
    insertIfMissing(row) {
      db.insert(operatorProfile)
        .values({ id: ROW_ID, ...row })
        .onConflictDoNothing()
        .run();
    },
    upsert(row) {
      db.insert(operatorProfile)
        .values({ id: ROW_ID, ...row })
        .onConflictDoUpdate({ target: operatorProfile.id, set: row })
        .run();
    },
  };
}
