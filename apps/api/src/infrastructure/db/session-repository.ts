import { eq, lt } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SessionRepository } from '../../modules/auth/ports.js';
import { sessions } from './schema.js';

export function createSessionRepository(db: BetterSQLite3Database): SessionRepository {
  return {
    create(row) {
      db.insert(sessions).values(row).run();
    },
    find(tokenHash) {
      return db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).get();
    },
    touch(tokenHash, at) {
      db.update(sessions).set({ lastSeenAt: at }).where(eq(sessions.tokenHash, tokenHash)).run();
    },
    delete(tokenHash) {
      db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
    },
    deleteIdleSince(cutoff) {
      db.delete(sessions).where(lt(sessions.lastSeenAt, cutoff)).run();
    },
  };
}
