import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { RunnerState } from '../../modules/analysis/ports.js';
import { appMeta } from './schema.js';

const KEY = 'analysis_paused';

/** D-4 (S-20): the paused flag lives in `app_meta`, so a restart does not resume what the operator stopped. */
export function createRunnerState(db: BetterSQLite3Database): RunnerState {
  return {
    isPaused() {
      return db.select().from(appMeta).where(eq(appMeta.key, KEY)).get()?.value === '1';
    },
    setPaused(paused) {
      if (paused) {
        db.insert(appMeta)
          .values({ key: KEY, value: '1' })
          .onConflictDoUpdate({ target: appMeta.key, set: { value: '1' } })
          .run();
      } else {
        db.delete(appMeta).where(eq(appMeta.key, KEY)).run();
      }
    },
  };
}
